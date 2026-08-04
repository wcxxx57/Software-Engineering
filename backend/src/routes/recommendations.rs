use axum::{extract::{Path, Query, State}, response::{IntoResponse, Response}, Json};
use chrono::Utc;
use sea_orm::{
    sea_query::OnConflict,
    ActiveModelTrait,
    ActiveValue::Set,
    ColumnTrait,
    EntityTrait,
    DbErr,
    QueryFilter,
    QueryOrder,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};

use crate::{auth::AuthUser, entities::{chat_question, code_video, curriculum_node, curriculum_template, interactive_html, knowledge_video, learning_plan_template, learning_plan_template_stage, learning_plan_template_task, plan_recommendation_draft, pretest_problem, recommendation_resource, recommendation_resource_learning, study_stage, study_subject, study_task, user}, error::{AppError, BusinessError}, response::{created, ok}, services::{asset_transaction, personalization::LearnerProfileSnapshot, study_subject::{PretestRequest, dispatch_pretest}}, state::AppState};

#[derive(Serialize)]
struct ResourceView {
    catalog_id: i32,
    id: i32,
    title: String,
    summary: String,
    reasons: Vec<String>,
    learner_count: Option<i64>,
    #[serde(skip)]
    rank_score: f64,
    #[serde(skip)]
    updated_at: chrono::DateTime<Utc>,
}
#[derive(Serialize)]
struct TaskRecommendationView { eligible: bool, knowledge_point_title: Option<String>, resources: Resources }
#[derive(Serialize)] struct Resources { knowledge_video: Vec<ResourceView>, interactive_html: Vec<ResourceView> }
#[derive(Deserialize)] pub struct FeaturedQuery { kind: String }
#[derive(Serialize)] struct FeaturedView { catalog_id: i32, id: i32, title: String, summary: String }

fn kind_from_query(value: &str) -> Option<recommendation_resource::RecommendationResourceKind> {
    match value { "knowledge-video" => Some(recommendation_resource::RecommendationResourceKind::KnowledgeVideo), "code-video" => Some(recommendation_resource::RecommendationResourceKind::CodeVideo), "interactive-html" => Some(recommendation_resource::RecommendationResourceKind::InteractiveHtml), _ => None }
}

async fn usable(state: &AppState, row: &recommendation_resource::Model) -> Result<bool, AppError> {
    match row.resource_kind {
        recommendation_resource::RecommendationResourceKind::KnowledgeVideo => Ok(knowledge_video::Entity::find_by_id(row.resource_id).one(&state.db).await?.is_some_and(|x| x.public && x.object_key.as_deref().is_some_and(|key| !key.trim().is_empty()) && x.status == knowledge_video::KnowledgeVideoStatus::Finished)),
        recommendation_resource::RecommendationResourceKind::InteractiveHtml => Ok(interactive_html::Entity::find_by_id(row.resource_id).one(&state.db).await?.is_some_and(|x| x.public && x.object_key.as_deref().is_some_and(|key| !key.trim().is_empty()) && x.status == interactive_html::InteractiveHtmlStatus::Finished)),
        recommendation_resource::RecommendationResourceKind::CodeVideo => Ok(code_video::Entity::find_by_id(row.resource_id).one(&state.db).await?.is_some_and(|x| x.public && x.object_key.as_deref().is_some_and(|key| !key.trim().is_empty()) && x.status == code_video::CodeVideoStatus::Finished)),
    }
}

fn exposed_catalog_row(row: &recommendation_resource::Model) -> bool {
    row.curriculum_node_id.is_some()
        || (row.featured
            && row.quality_status == recommendation_resource::RecommendationQualityStatus::Passed)
}

fn normalized_goal(value: &str) -> String { value.to_lowercase().chars().filter(|c| !c.is_whitespace() && !matches!(c, ',' | '.' | '，' | '。' | '、' | '!' | '！')).collect() }
fn goal_similarity(a: &str, b: &str) -> f64 { let a = normalized_goal(a); let b = normalized_goal(b); if a.is_empty() || b.is_empty() { 0.0 } else if a == b { 1.0 } else if a.contains(&b) || b.contains(&a) { 0.7 } else { let at = a.chars().collect::<std::collections::HashSet<_>>(); let bt = b.chars().collect::<std::collections::HashSet<_>>(); at.intersection(&bt).count() as f64 / at.union(&bt).count().max(1) as f64 } }
fn controlled_goal_similarity(template: Option<&curriculum_template::Model>, current: &study_subject::Model, other: &study_subject::Model) -> f64 {
    let raw = goal_similarity(&format!("{} {}", current.subject, current.target), &format!("{} {}", other.subject, other.target));
    let Some(template) = template else { return raw; };
    let aliases = template.aliases.as_array().map(|items| items.iter().filter_map(|item| item.as_str()).map(normalized_goal).filter(|item| item.len() >= 2).collect::<Vec<_>>()).unwrap_or_default();
    if aliases.is_empty() { return raw; }
    let current_text = normalized_goal(&format!("{} {}", current.subject, current.target));
    let other_text = normalized_goal(&format!("{} {}", other.subject, other.target));
    let current_tags = aliases.iter().filter(|alias| current_text.contains(alias.as_str())).collect::<std::collections::HashSet<_>>();
    let other_tags = aliases.iter().filter(|alias| other_text.contains(alias.as_str())).collect::<std::collections::HashSet<_>>();
    let alias_score = if current_tags.is_empty() || other_tags.is_empty() { 0.0 } else { current_tags.intersection(&other_tags).count() as f64 / current_tags.union(&other_tags).count().max(1) as f64 };
    raw.max(alias_score)
}
async fn mastery(db: &sea_orm::DatabaseConnection, subject_id: i32) -> Result<f64, AppError> { let items = pretest_problem::Entity::find().filter(pretest_problem::Column::StudySubjectId.eq(subject_id)).all(db).await?; if items.is_empty() { return Ok(0.0); } Ok(items.iter().filter(|p| p.chosen_answer == Some(p.answer)).count() as f64 / items.len() as f64) }
async fn similar_users_score(state: &AppState, current: &study_subject::Model, user_ids: &[i32]) -> Result<(f64, bool, bool, bool, bool), AppError> {
    let current_mastery = mastery(&state.db, current.id).await?;
    let current_progress = if current.total_stages > 0 { current.finished_stages as f64 / current.total_stages as f64 } else { 0.0 };
    let template = if let Some(template_id) = current.curriculum_template_id { curriculum_template::Entity::find_by_id(template_id).one(&state.db).await? } else { None };
    let mut best = (0.0, false, false, false, false);
    for user_id in user_ids {
        let profile = study_subject::Entity::find()
            .filter(study_subject::Column::UserId.eq(*user_id))
            .order_by_desc(study_subject::Column::CreatedAt)
            .all(&state.db)
            .await?
            .into_iter()
            .find(|s| s.curriculum_template_id == current.curriculum_template_id);
        let Some(profile) = profile else { continue; };
        let target = controlled_goal_similarity(template.as_ref(), current, &profile);
        let mastery_score = (1.0 - (current_mastery - mastery(&state.db, profile.id).await?).abs()).max(0.0);
        let progress = if profile.total_stages > 0 { profile.finished_stages as f64 / profile.total_stages as f64 } else { 0.0 };
        let progress_score = (1.0 - (current_progress - progress).abs()).max(0.0);
        let language_score = if profile.language == current.language { 1.0 } else { 0.0 };
        let score = target * 0.4 + mastery_score * 0.3 + progress_score * 0.2 + language_score * 0.1;
        if score > best.0 {
            best = (
                score,
                target >= 0.5,
                mastery_score >= 0.7,
                progress_score >= 0.7,
                language_score >= 0.5,
            );
        }
    }
    Ok(best)
}

async fn rows_for(state: &AppState, current: &study_subject::Model, node_id: i32, kind: recommendation_resource::RecommendationResourceKind) -> Result<Vec<ResourceView>, AppError> {
    let rows = recommendation_resource::Entity::find().filter(recommendation_resource::Column::CurriculumNodeId.eq(node_id)).filter(recommendation_resource::Column::ResourceKind.eq(kind)).order_by_desc(recommendation_resource::Column::UpdatedAt).all(&state.db).await?;
    let mut answer = Vec::new();
    for row in rows {
        if !usable(state, &row).await? { continue; }
        let learning = recommendation_resource_learning::Entity::find().filter(recommendation_resource_learning::Column::RecommendationResourceId.eq(row.id)).all(&state.db).await?;
        let learner_ids = learning.iter().map(|item| item.user_id).collect::<std::collections::HashSet<_>>();
        let count = learner_ids.len() as i64;
        let mut users = learner_ids.iter().copied().collect::<Vec<_>>();
        if let Some(owner) = row.creator_user_id { users.push(owner); }
        users.sort_unstable(); users.dedup();
        let (similarity, goal_match, mastery_match, progress_match, language_match) = similar_users_score(state, current, &users).await?;
        let popularity = (count as f64).ln_1p() / 8.0_f64.ln_1p();
        let rank_score = similarity * 0.7 + popularity.min(1.0) * 0.3;
        let mut reasons = vec!["与当前固定知识点匹配".to_owned()];
        if goal_match { reasons.push("学习目标相近的学习者常学习此内容".to_owned()); }
        else if mastery_match { reasons.push("与你当前掌握情况接近的学习者常学习此内容".to_owned()); }
        else if progress_match { reasons.push("与你学习进度相近的学习者常学习此内容".to_owned()); }
        else if language_match { reasons.push("使用相同学习语言的学习者常学习此内容".to_owned()); }
        if count > 0 { reasons.push(format!("已有 {count} 位学习者学习过")); }
        reasons.truncate(2);
        answer.push(ResourceView { catalog_id: row.id, id: row.resource_id, title: row.title, summary: row.summary, reasons, learner_count: if count > 0 { Some(count) } else { None }, rank_score, updated_at: row.updated_at });
    }
    answer.sort_by(|a, b| b.rank_score.total_cmp(&a.rank_score).then_with(|| b.learner_count.unwrap_or(0).cmp(&a.learner_count.unwrap_or(0))).then_with(|| b.updated_at.cmp(&a.updated_at)).then_with(|| b.catalog_id.cmp(&a.catalog_id)));
    answer.truncate(3);
    Ok(answer)
}

pub async fn task_recommendations(State(state): State<AppState>, auth: AuthUser, Path(id): Path<i32>) -> Result<impl axum::response::IntoResponse, AppError> {
    let task = study_task::Entity::find_by_id(id).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;
    let stage = study_stage::Entity::find_by_id(task.study_stage_id).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;
    let subject = study_subject::Entity::find_by_id(stage.study_subject_id).filter(study_subject::Column::UserId.eq(auth.user_id)).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;
    let Some(template_id) = subject.curriculum_template_id else { return Ok(ok(TaskRecommendationView { eligible: false, knowledge_point_title: None, resources: Resources { knowledge_video: vec![], interactive_html: vec![] } })); };
    let Some(template) = curriculum_template::Entity::find_by_id(template_id).one(&state.db).await? else { return Ok(ok(TaskRecommendationView { eligible: false, knowledge_point_title: None, resources: Resources { knowledge_video: vec![], interactive_html: vec![] } })); };
    if template.status != curriculum_template::CurriculumTemplateStatus::Published { return Ok(ok(TaskRecommendationView { eligible: false, knowledge_point_title: None, resources: Resources { knowledge_video: vec![], interactive_html: vec![] } })); }
    let Some(node_id) = task.curriculum_node_id else { return Ok(ok(TaskRecommendationView { eligible: false, knowledge_point_title: None, resources: Resources { knowledge_video: vec![], interactive_html: vec![] } })); };
    let node = crate::entities::curriculum_node::Entity::find_by_id(node_id).one(&state.db).await?.ok_or_else(|| AppError::internal("task references missing curriculum node"))?;
    if node.curriculum_template_id != template_id { return Ok(ok(TaskRecommendationView { eligible: false, knowledge_point_title: None, resources: Resources { knowledge_video: vec![], interactive_html: vec![] } })); }
    Ok(ok(TaskRecommendationView { eligible: true, knowledge_point_title: Some(node.title), resources: Resources { knowledge_video: rows_for(&state, &subject, node_id, recommendation_resource::RecommendationResourceKind::KnowledgeVideo).await?, interactive_html: rows_for(&state, &subject, node_id, recommendation_resource::RecommendationResourceKind::InteractiveHtml).await? } }))
}

pub async fn featured(State(state): State<AppState>, _auth: AuthUser, Query(query): Query<FeaturedQuery>) -> Result<impl axum::response::IntoResponse, AppError> {
    let kind = kind_from_query(&query.kind).ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;
    let rows = recommendation_resource::Entity::find()
        .filter(recommendation_resource::Column::ResourceKind.eq(kind))
        .filter(recommendation_resource::Column::Featured.eq(true))
        .filter(recommendation_resource::Column::QualityStatus.eq(recommendation_resource::RecommendationQualityStatus::Passed))
        .order_by_asc(recommendation_resource::Column::DisplayPriority)
        .order_by_asc(recommendation_resource::Column::Id)
        .all(&state.db)
        .await?;
    let mut answer = Vec::new(); for row in rows { if usable(&state, &row).await? { answer.push(FeaturedView { catalog_id: row.id, id: row.resource_id, title: row.title, summary: row.summary }); } }
    Ok(ok(answer))
}

pub async fn record_open(State(state): State<AppState>, auth: AuthUser, Path(id): Path<i32>) -> Result<impl axum::response::IntoResponse, AppError> {
    let row = recommendation_resource::Entity::find_by_id(id).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;
    if !exposed_catalog_row(&row) || !usable(&state, &row).await? {
        return Err(AppError::business(BusinessError::ContentNotFound));
    }
    let insert_result = recommendation_resource_learning::Entity::insert(recommendation_resource_learning::ActiveModel { recommendation_resource_id: Set(id), user_id: Set(auth.user_id), first_opened_at: Set(Utc::now()), ..Default::default() })
        .on_conflict(OnConflict::columns([
            recommendation_resource_learning::Column::RecommendationResourceId,
            recommendation_resource_learning::Column::UserId,
        ]).do_nothing().to_owned())
        .exec(&state.db)
        .await;
    match insert_result {
        Ok(_) | Err(DbErr::RecordNotInserted) => {}
        Err(err) => return Err(err.into()),
    }
    Ok(created(serde_json::json!({"recorded": true})))
}

#[derive(Serialize)]
struct ChatQuestionView { question: String, learner_count: i64 }
#[derive(Serialize)]
struct ChatContextView {
    course_title: String,
    stage_title: String,
    knowledge_point_title: String,
    suggested_questions: Vec<serde_json::Value>,
    popular_questions: Vec<ChatQuestionView>,
}
#[derive(Deserialize)]
pub struct ChatQuestionRequest {
    pub question: String,
    /// The Chat service may provide a canonical cluster key after semantic
    /// deduplication. When omitted, the backend falls back to normalization.
    #[serde(default)]
    pub normalized_question: Option<String>,
}

fn normalize_question(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_punctuation()
                || matches!(
                    ch,
                    '，' | '。' | '！' | '？' | '：' | '；' | '、' | '（' | '）' | '【' | '】'
                        | '“' | '”' | '‘' | '’' | '《' | '》' | '「' | '」'
                )
            {
                ' '
            } else {
                ch.to_ascii_lowercase()
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<String>()
}

fn suggested_questions(
    title: &str,
    asked: &std::collections::HashSet<String>,
) -> Vec<serde_json::Value> {
    [
        format!("{title}的核心概念是什么？"),
        format!("{title}和相近概念有什么区别？"),
        format!("学习{title}时最容易出错的地方是什么？"),
    ]
    .into_iter()
    .filter(|question| !asked.contains(&normalize_question(question)))
    .map(|question| serde_json::json!({ "question": question }))
    .collect()
}
fn similar_question(a: &str, b: &str) -> bool {
    if a == b || a.contains(b) || b.contains(a) { return true; }
    let left = a.chars().collect::<std::collections::HashSet<_>>();
    let right = b.chars().collect::<std::collections::HashSet<_>>();
    // The Chat service can provide a semantic cluster key. This fallback is
    // intentionally conservative, but should still merge common Chinese
    // rephrasings such as “怎么办” and “怎么处理” when they share the same
    // knowledge-point phrase.
    left.intersection(&right).count() as f64 / left.union(&right).count().max(1) as f64 >= 0.45
}

async fn owned_task_context(state: &AppState, auth: &AuthUser, id: i32) -> Result<(study_task::Model, study_stage::Model, study_subject::Model), AppError> {
    let task = study_task::Entity::find_by_id(id).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;
    let stage = study_stage::Entity::find_by_id(task.study_stage_id).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;
    let subject = study_subject::Entity::find_by_id(stage.study_subject_id).filter(study_subject::Column::UserId.eq(auth.user_id)).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;
    Ok((task, stage, subject))
}

pub async fn chat_context(State(state): State<AppState>, auth: AuthUser, Path(id): Path<i32>) -> Result<impl axum::response::IntoResponse, AppError> {
    let (task, stage, subject) = owned_task_context(&state, &auth, id).await?;
    let course_title = if let Some(template_id) = subject.curriculum_template_id {
        curriculum_template::Entity::find_by_id(template_id)
            .one(&state.db)
            .await?
            .map(|template| template.canonical_name)
            .unwrap_or_else(|| subject.subject.clone())
    } else {
        subject.subject.clone()
    };
    let title = if let Some(node_id) = task.curriculum_node_id { curriculum_node::Entity::find_by_id(node_id).one(&state.db).await?.map(|n| n.title).unwrap_or(task.title.clone()) } else { task.title.clone() };
    let questions = if let Some(node_id) = task.curriculum_node_id {
        chat_question::Entity::find().filter(chat_question::Column::CurriculumNodeId.eq(node_id)).all(&state.db).await?
    } else {
        chat_question::Entity::find().filter(chat_question::Column::StudyTaskId.eq(task.id)).all(&state.db).await?
    };
    let mut grouped: Vec<(String, String, std::collections::HashSet<i32>)> = Vec::new();
    let mut asked = std::collections::HashSet::new();
    for item in questions {
        asked.insert(item.normalized_question.clone());
        if let Some(entry) = grouped.iter_mut().find(|(key, _, _)| similar_question(key, &item.normalized_question)) {
            entry.2.insert(item.user_id);
        } else {
            grouped.push((item.normalized_question, item.question, std::collections::HashSet::from([item.user_id])));
        }
    }
    let mut popular_questions = grouped.into_iter().filter_map(|(_, question, users)| {
        (users.len() >= 2).then_some(ChatQuestionView { question, learner_count: users.len() as i64 })
    }).collect::<Vec<_>>();
    popular_questions.sort_by(|a, b| b.learner_count.cmp(&a.learner_count).then_with(|| a.question.cmp(&b.question)));
    popular_questions.truncate(5);
    Ok(ok(ChatContextView { course_title, stage_title: stage.title, knowledge_point_title: title.clone(), suggested_questions: suggested_questions(&title, &asked), popular_questions }))
}

pub async fn record_chat_question(State(state): State<AppState>, auth: AuthUser, Path(id): Path<i32>, Json(payload): Json<ChatQuestionRequest>) -> Result<impl axum::response::IntoResponse, AppError> {
    let (task, _, _) = owned_task_context(&state, &auth, id).await?;
    let question = payload.question.trim();
    let normalized_question = payload
        .normalized_question
        .as_deref()
        .map(normalize_question)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| normalize_question(question));
    if normalized_question.len() < 2 || normalized_question.len() > 500 { return Err(AppError::ValidationFailed); }
    chat_question::ActiveModel { study_task_id: Set(task.id), curriculum_node_id: Set(task.curriculum_node_id), user_id: Set(auth.user_id), question: Set(question.to_owned()), normalized_question: Set(normalized_question), created_at: Set(Utc::now()), ..Default::default() }.insert(&state.db).await?;
    Ok(created(serde_json::json!({"saved": true})))
}

#[derive(Serialize)]
struct RecommendedStage { title: String, task_count: i32 }
#[derive(Serialize)]
struct RecommendedPlan { id: i32, title: String, reason: String, stage_count: i32, task_count: i32, estimated_weeks: Option<i32>, stages: Vec<RecommendedStage> }

fn target_matches(template: &curriculum_template::Model, subject: &study_subject::Model) -> bool {
    let haystack = format!("{} {}", subject.subject.to_lowercase(), subject.target.to_lowercase());
    template.aliases.as_array().is_some_and(|aliases| aliases.iter().filter_map(|x| x.as_str()).any(|alias| haystack.contains(&alias.to_lowercase())))
}

async fn plan_view(state: &AppState, subject: &study_subject::Model, template: curriculum_template::Model) -> Result<RecommendedPlan, AppError> {
    let plan_template = ensure_plan_template(state, subject, &template).await?;
    let draft_kind = if subject.status == study_subject::StudySubjectStatus::Finished { plan_recommendation_draft::PlanRecommendationDraftKind::Next } else { plan_recommendation_draft::PlanRecommendationDraftKind::Initial };
    upsert_plan_draft(state, subject, &plan_template, draft_kind).await
}

async fn ensure_plan_template(state: &AppState, subject: &study_subject::Model, curriculum: &curriculum_template::Model) -> Result<learning_plan_template::Model, AppError> {
    let stage_count = subject.total_stages.max(1);
    if let Some(existing) = learning_plan_template::Entity::find()
        .filter(learning_plan_template::Column::CurriculumTemplateId.eq(curriculum.id))
        .filter(learning_plan_template::Column::StageCount.eq(stage_count))
        .filter(learning_plan_template::Column::Language.eq(subject.language.clone()))
        .filter(learning_plan_template::Column::Status.eq(learning_plan_template::LearningPlanTemplateStatus::Published))
        .order_by_desc(learning_plan_template::Column::UpdatedAt)
        .one(&state.db)
        .await?
    {
        return Ok(existing);
    }

    let nodes = curriculum_node::Entity::find()
        .filter(curriculum_node::Column::CurriculumTemplateId.eq(curriculum.id))
        .order_by_asc(curriculum_node::Column::SortOrder)
        .all(&state.db)
        .await?;
    if nodes.is_empty() {
        return Err(AppError::internal("curriculum template has no knowledge nodes"));
    }
    let now = Utc::now();
    let plan = learning_plan_template::ActiveModel {
        curriculum_template_id: Set(curriculum.id),
        title: Set(curriculum.canonical_name.clone()),
        target_tags: Set(curriculum.aliases.clone()),
        language: Set(subject.language.clone()),
        difficulty_min: Set(None),
        difficulty_max: Set(None),
        stage_count: Set(stage_count),
        estimated_weeks: Set(Some(stage_count)),
        status: Set(learning_plan_template::LearningPlanTemplateStatus::Published),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&state.db)
    .await?;
    for stage_index in 0..stage_count {
        let start = (stage_index as usize * nodes.len()) / stage_count as usize;
        let end = (((stage_index + 1) as usize * nodes.len()) / stage_count as usize).max(start + 1);
        let selected = if start < nodes.len() { &nodes[start..end.min(nodes.len())] } else { std::slice::from_ref(&nodes[0]) };
        let stage = learning_plan_template_stage::ActiveModel {
            learning_plan_template_id: Set(plan.id),
            title: Set(format!("第 {} 阶段", stage_index + 1)),
            description: Set("按照课程大纲逐步掌握本阶段知识点".to_owned()),
            sort_order: Set(stage_index),
            created_at: Set(now),
            ..Default::default()
        }
        .insert(&state.db)
        .await?;
        for (task_index, node) in selected.iter().enumerate() {
            learning_plan_template_task::ActiveModel {
                learning_plan_template_stage_id: Set(stage.id),
                curriculum_node_id: Set(node.id),
                description: Set(format!("学习{}并完成对应练习", node.title)),
                day_index: Set(stage_index + task_index as i32 + 1),
                sort_order: Set(task_index as i32),
                created_at: Set(now),
                ..Default::default()
            }
            .insert(&state.db)
            .await?;
        }
    }
    Ok(plan)
}

async fn upsert_plan_draft(state: &AppState, subject: &study_subject::Model, plan_template: &learning_plan_template::Model, kind: plan_recommendation_draft::PlanRecommendationDraftKind) -> Result<RecommendedPlan, AppError> {
    let stages = learning_plan_template_stage::Entity::find()
        .filter(learning_plan_template_stage::Column::LearningPlanTemplateId.eq(plan_template.id))
        .order_by_asc(learning_plan_template_stage::Column::SortOrder)
        .all(&state.db)
        .await?;
    let stage_ids = stages.iter().map(|stage| stage.id).collect::<Vec<_>>();
    let tasks = if stage_ids.is_empty() { Vec::new() } else { learning_plan_template_task::Entity::find().filter(learning_plan_template_task::Column::LearningPlanTemplateStageId.is_in(stage_ids)).all(&state.db).await? };
    let stage_views = stages.iter().map(|stage| RecommendedStage { title: stage.title.clone(), task_count: tasks.iter().filter(|task| task.learning_plan_template_stage_id == stage.id).count() as i32 }).collect::<Vec<_>>();
    let stage_count = plan_template.stage_count.max(1);
    let task_count = tasks.len().max(1) as i32;
    let reason = "与你的学习目标、当前基础和课程大纲衔接".to_owned();
    let payload = serde_json::json!({ "stages": stage_views });
    let now = Utc::now();
    let existing = plan_recommendation_draft::Entity::find()
        .filter(plan_recommendation_draft::Column::StudySubjectId.eq(subject.id))
        .filter(plan_recommendation_draft::Column::Kind.eq(kind))
        .filter(plan_recommendation_draft::Column::AdoptedAt.is_null())
        .order_by_desc(plan_recommendation_draft::Column::UpdatedAt)
        .one(&state.db)
        .await?;
    let draft = if let Some(existing) = existing {
        let mut active: plan_recommendation_draft::ActiveModel = existing.into();
        active.learning_plan_template_id = Set(plan_template.id);
        active.title = Set(plan_template.title.clone());
        active.reason = Set(reason.clone());
        active.stage_count = Set(stage_count);
        active.task_count = Set(task_count);
        active.estimated_weeks = Set(plan_template.estimated_weeks);
        active.payload = Set(payload.clone());
        active.updated_at = Set(now);
        active.update(&state.db).await?
    } else {
        plan_recommendation_draft::ActiveModel {
            user_id: Set(subject.user_id),
            study_subject_id: Set(subject.id),
            learning_plan_template_id: Set(plan_template.id),
            kind: Set(kind),
            title: Set(plan_template.title.clone()),
            reason: Set(reason.clone()),
            stage_count: Set(stage_count),
            task_count: Set(task_count),
            estimated_weeks: Set(plan_template.estimated_weeks),
            payload: Set(payload),
            adopted_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            expires_at: Set(None),
            ..Default::default()
        }
        .insert(&state.db)
        .await?
    };
    Ok(RecommendedPlan { id: draft.id, title: draft.title, reason: draft.reason, stage_count: draft.stage_count, task_count: draft.task_count, estimated_weeks: draft.estimated_weeks, stages: stage_views })
}

async fn choose_template(state: &AppState, subject: &study_subject::Model, exclude: Option<i32>) -> Result<curriculum_template::Model, AppError> {
    let templates = curriculum_template::Entity::find().filter(curriculum_template::Column::Language.eq(subject.language.clone())).filter(curriculum_template::Column::Status.eq(curriculum_template::CurriculumTemplateStatus::Published)).order_by_asc(curriculum_template::Column::Id).all(&state.db).await?;
    templates.into_iter().filter(|t| Some(t.id) != exclude).max_by_key(|t| (target_matches(t, subject) as i32, -(t.id))).ok_or_else(|| AppError::business(BusinessError::ContentNotFound))
}

pub async fn plan_recommendation(State(state): State<AppState>, auth: AuthUser, Path(id): Path<i32>) -> Result<impl axum::response::IntoResponse, AppError> {
    let subject = study_subject::Entity::find_by_id(id).filter(study_subject::Column::UserId.eq(auth.user_id)).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;
    if subject.status != study_subject::StudySubjectStatus::PretestReady { return Err(AppError::business(BusinessError::ContentNotFound)); }
    let template = if let Some(template_id) = subject.curriculum_template_id { curriculum_template::Entity::find_by_id(template_id).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::ContentNotFound))? } else { choose_template(&state, &subject, None).await? };
    Ok(ok(plan_view(&state, &subject, template).await?))
}

pub async fn next_plan_recommendation(State(state): State<AppState>, auth: AuthUser, Path(id): Path<i32>) -> Result<impl axum::response::IntoResponse, AppError> {
    let subject = study_subject::Entity::find_by_id(id).filter(study_subject::Column::UserId.eq(auth.user_id)).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;
    if subject.status != study_subject::StudySubjectStatus::Finished { return Err(AppError::business(BusinessError::ContentNotFound)); }
    let template = choose_template(&state, &subject, subject.curriculum_template_id).await?;
    Ok(ok(plan_view(&state, &subject, template).await?))
}

pub async fn adopt_plan_recommendation(State(state): State<AppState>, auth: AuthUser, Path((id, template_id)): Path<(i32, i32)>) -> Result<Response, AppError> {
    let subject = study_subject::Entity::find_by_id(id).filter(study_subject::Column::UserId.eq(auth.user_id)).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;
    let draft = plan_recommendation_draft::Entity::find_by_id(template_id)
        .filter(plan_recommendation_draft::Column::StudySubjectId.eq(subject.id))
        .filter(plan_recommendation_draft::Column::UserId.eq(auth.user_id))
        .filter(plan_recommendation_draft::Column::AdoptedAt.is_null())
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;
    let plan_template = learning_plan_template::Entity::find_by_id(draft.learning_plan_template_id)
        .filter(learning_plan_template::Column::Status.eq(learning_plan_template::LearningPlanTemplateStatus::Published))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;
    let template = curriculum_template::Entity::find_by_id(plan_template.curriculum_template_id)
        .filter(curriculum_template::Column::Status.eq(curriculum_template::CurriculumTemplateStatus::Published))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;
    if subject.status == study_subject::StudySubjectStatus::PretestReady {
        if draft.kind != plan_recommendation_draft::PlanRecommendationDraftKind::Initial { return Err(AppError::business(BusinessError::InvalidStudySubjectStatus)); }
        let mut active: study_subject::ActiveModel = subject.into();
        active.curriculum_template_id = Set(Some(template.id));
        active.update(&state.db).await?;
        let response = crate::routes::study_subjects::create_plan(State(state.clone()), auth, Path(id)).await?.into_response();
        if response.status().is_success() {
            let mut adopted: plan_recommendation_draft::ActiveModel = draft.into();
            adopted.adopted_at = Set(Some(Utc::now()));
            adopted.updated_at = Set(Utc::now());
            adopted.update(&state.db).await?;
        }
        return Ok(response);
    }
    if subject.status != study_subject::StudySubjectStatus::Finished || draft.kind != plan_recommendation_draft::PlanRecommendationDraftKind::Next { return Err(AppError::business(BusinessError::InvalidStudySubjectStatus)); }
    let cost = subject.diamond_cost;
    let now = Utc::now();
    let tx = state.db.begin().await?;
    let existing = user::Entity::find_by_id(auth.user_id).one(&tx).await?.ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
    if existing.diamond < cost { return Err(AppError::business(BusinessError::InsufficientDiamonds)); }
    let remaining_diamond = existing.diamond - cost;
    let mut active_user: user::ActiveModel = existing.clone().into();
    active_user.diamond = Set(remaining_diamond);
    active_user.active_study_subject_id = Set(None);
    active_user.updated_at = Set(now);
    active_user.update(&tx).await?;
    asset_transaction::record(&tx, auth.user_id, asset_transaction::DIAMOND, -cost, remaining_diamond, "采用下一阶段学习计划").await?;
    let next = study_subject::ActiveModel { user_id: Set(auth.user_id), subject: Set(template.canonical_name.clone()), status: Set(study_subject::StudySubjectStatus::PretestQueuing), total_stages: Set(plan_template.stage_count), finished_stages: Set(0), diamond_cost: Set(cost), language: Set(plan_template.language.clone()), target: Set(subject.target.clone()), curriculum_template_id: Set(Some(template.id)), failure_code: Set(None), created_at: Set(now), updated_at: Set(now), ..Default::default() }.insert(&tx).await?;
    let active_user = user::ActiveModel {
        id: Set(auth.user_id),
        diamond: Set(remaining_diamond),
        active_study_subject_id: Set(Some(next.id)),
        updated_at: Set(now),
        ..Default::default()
    };
    active_user.update(&tx).await?;
    tx.commit().await?;
    let outline = crate::services::curriculum::load_outline(&state.db, template.id).await?;
    let learner = user::Entity::find_by_id(auth.user_id).one(&state.db).await?.ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
    if let Err(err) = dispatch_pretest(state.publisher.as_ref(), &state.config.pretest_exchange, &PretestRequest { task_id: next.id, prompt: next.subject.clone(), total_stages: next.total_stages, language: next.language.clone(), target: next.target.clone(), learner_profile: LearnerProfileSnapshot::from_user(&learner), authoritative_outline: outline }).await {
        let refund_tx = state.db.begin().await?;
        let failed = study_subject::Entity::find_by_id(next.id).one(&refund_tx).await?.ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;
        let mut failed_active: study_subject::ActiveModel = failed.into();
        failed_active.status = Set(study_subject::StudySubjectStatus::Failed);
        failed_active.failure_code = Set(Some("PRETEST_DISPATCH_FAILED".to_owned()));
        failed_active.updated_at = Set(Utc::now());
        failed_active.update(&refund_tx).await?;
        let refund_user = user::Entity::find_by_id(auth.user_id).one(&refund_tx).await?.ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
        let refunded_diamond = refund_user.diamond + cost;
        let mut refund_active: user::ActiveModel = refund_user.into();
        refund_active.diamond = Set(refunded_diamond);
        refund_active.updated_at = Set(Utc::now());
        refund_active.update(&refund_tx).await?;
        asset_transaction::record(&refund_tx, auth.user_id, asset_transaction::DIAMOND, cost, refunded_diamond, "下一阶段学习计划生成失败退款").await?;
        refund_tx.commit().await?;
        return Err(err);
    }
    let mut adopted: plan_recommendation_draft::ActiveModel = draft.into();
    adopted.adopted_at = Set(Some(Utc::now()));
    adopted.updated_at = Set(Utc::now());
    adopted.update(&state.db).await?;
    Ok(created(serde_json::json!({"study_subject_id": next.id, "status": "PRETEST_QUEUING"})).into_response())
}

#[cfg(test)]
mod tests {
    use super::{normalize_question, similar_question, suggested_questions};
    use std::collections::HashSet;

    #[test]
    fn normalizes_question_punctuation_and_whitespace() {
        assert_eq!(
            normalize_question("  BST 退化成链表？ "),
            "bst退化成链表"
        );
    }

    #[test]
    fn groups_close_question_phrasings() {
        assert!(similar_question(
            &normalize_question("删除两个子节点怎么办？"),
            &normalize_question("删除两个子节点怎么处理")
        ));
        assert!(!similar_question(
            &normalize_question("什么是二叉搜索树？"),
            &normalize_question("如何配置 Python 虚拟环境？")
        ));
    }

    #[test]
    fn suggested_questions_exclude_questions_already_asked() {
        let asked = HashSet::from([normalize_question("二叉搜索树的核心概念是什么？")]);
        let result = suggested_questions("二叉搜索树", &asked);
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|item| item["question"].is_string()));
    }
}
