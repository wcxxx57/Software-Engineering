use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::{
    auth::AuthUser,
    entities::{
        common::ProblemAnswer, pretest_problem, study_quiz, study_quiz_problem, study_stage,
        study_subject, study_subject::StudySubjectStatus, study_task, study_task_curriculum_node,
        user,
    },
    error::{AppError, BusinessError},
    response::{created, ok},
    routes::study_stages::{StudyStageDetailView, StudyTaskBriefView},
    services::asset_transaction::{self, DIAMOND},
    services::study_subject::{
        CurriculumAcquisitionRequest, LearnerHistorySnapshot, PlanRequest, PretestResult,
        dispatch_curriculum_acquisition, dispatch_plan,
    },
    services::{curriculum, personalization::LearnerProfileSnapshot},
    state::AppState,
};

const ALLOWED_LANGUAGES: &[&str] = &["PYTHON", "JAVA", "CPP", "GO", "RUST"];

// ── Views ──

#[derive(Debug, Serialize)]
pub struct StudySubjectView {
    pub id: i32,
    pub subject: String,
    pub status: StudySubjectStatus,
    pub total_stages: i32,
    pub finished_stages: i32,
    pub diamond_cost: i32,
    pub language: String,
    pub target: String,
    pub curriculum_template_id: Option<i32>,
    pub failure_code: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<study_subject::Model> for StudySubjectView {
    fn from(m: study_subject::Model) -> Self {
        Self {
            id: m.id,
            subject: m.subject,
            status: m.status,
            total_stages: m.total_stages,
            finished_stages: m.finished_stages,
            diamond_cost: m.diamond_cost,
            language: m.language,
            target: m.target,
            curriculum_template_id: m.curriculum_template_id,
            failure_code: m.failure_code,
            created_at: m.created_at.timestamp_millis(),
            updated_at: m.updated_at.timestamp_millis(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct PretestProblemView {
    pub id: i32,
    pub sort_order: i32,
    pub content: String,
    pub choice_a: String,
    pub choice_b: String,
    pub choice_c: String,
    pub choice_d: String,
    pub answer: ProblemAnswer,
    pub explanation: String,
    pub confidence: Option<pretest_problem::PretestConfidence>,
    pub chosen_answer: Option<ProblemAnswer>,
}

#[derive(Debug, Serialize)]
pub struct KnowledgeTreeView {
    pub legacy: bool,
    pub template: Option<KnowledgeTreeTemplateView>,
    pub sources: Vec<KnowledgeTreeSourceView>,
    pub nodes: Vec<KnowledgeTreeNodeView>,
}

#[derive(Debug, Serialize)]
pub struct KnowledgeTreeTemplateView {
    pub id: i32,
    pub canonical_name: String,
    pub version: i32,
}

#[derive(Debug, Serialize)]
pub struct KnowledgeTreeSourceView {
    pub platform: String,
    pub institution: String,
    pub source_url: String,
}

#[derive(Debug, Serialize)]
pub struct KnowledgeTreeNodeView {
    pub node_key: String,
    pub parent_node_key: Option<String>,
    pub title: String,
    pub description: String,
    pub depth: i32,
    pub sort_order: i32,
    pub planned: bool,
    pub progress: i32,
    pub available: bool,
    pub tasks: Vec<KnowledgeTreeTaskView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct KnowledgeTreeTaskView {
    pub id: i32,
    pub title: String,
    pub status: study_task::StudyTaskStatus,
}

// ── Payloads ──

#[derive(Debug, Deserialize, Validate)]
pub struct CreateRequest {
    #[validate(length(min = 1, max = 200))]
    pub subject: Option<String>,
    pub total_stages: Option<i32>,
    pub language: Option<String>,
    #[serde(default)]
    #[validate(length(max = 2000))]
    pub target: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePretestProblemRequest {
    pub chosen_answer: ProblemAnswer,
    pub confidence: pretest_problem::PretestConfidence,
}

// ── Handlers ──

/// POST /api/v1/study-subjects
pub async fn create(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CreateRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    payload.validate()?;

    let subject_text = payload
        .subject
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::ValidationFailed)?
        .to_owned();
    let raw_language = payload
        .language
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::ValidationFailed)?;
    let language = raw_language.to_ascii_uppercase();
    if !ALLOWED_LANGUAGES.contains(&language.as_str()) {
        return Err(AppError::ValidationFailed);
    }
    let total_stages = payload.total_stages.ok_or(AppError::ValidationFailed)?;
    let target = payload
        .target
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_owned();

    let available_templates = curriculum::list_published_summaries(&state.db).await?;

    let cost = state
        .config
        .study_subject_diamond_costs
        .get(&total_stages)
        .copied()
        .ok_or_else(|| AppError::business(BusinessError::InvalidStudyStages))?;

    let now = Utc::now();
    let tx = state.db.begin().await?;

    let existing_user = user::Entity::find_by_id(auth_user.user_id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

    if existing_user.diamond < cost {
        return Err(AppError::business(BusinessError::InsufficientDiamonds));
    }

    let new_diamond = existing_user.diamond - cost;
    let mut active_user: user::ActiveModel = existing_user.clone().into();
    active_user.diamond = Set(new_diamond);
    active_user.updated_at = Set(now);

    let record = study_subject::ActiveModel {
        user_id: Set(auth_user.user_id),
        subject: Set(subject_text.clone()),
        status: Set(StudySubjectStatus::CurriculumQueuing),
        total_stages: Set(total_stages),
        finished_stages: Set(0),
        diamond_cost: Set(cost),
        language: Set(language.clone()),
        target: Set(target.clone()),
        curriculum_template_id: Set(None),
        failure_code: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&tx)
    .await?;

    // Newly created subject becomes the user's active subject.
    active_user.active_study_subject_id = Set(Some(record.id));
    active_user.update(&tx).await?;
    asset_transaction::record(
        &tx,
        existing_user.id,
        DIAMOND,
        -cost,
        new_diamond,
        "创建学习计划",
    )
    .await?;

    tx.commit().await?;

    let dispatch_result = dispatch_curriculum_acquisition(
        state.publisher.as_ref(),
        &state.config.curriculum_exchange,
        &CurriculumAcquisitionRequest {
            task_id: record.id,
            prompt: subject_text,
            language,
            target,
            available_templates,
        },
    )
    .await;
    if let Err(err) = dispatch_result {
        let tx = state.db.begin().await?;

        let mut active: study_subject::ActiveModel = record.clone().into();
        active.status = Set(StudySubjectStatus::Failed);
        active.failure_code = Set(Some("CURRICULUM_DISPATCH_FAILED".to_owned()));
        active.updated_at = Set(Utc::now());
        active.update(&tx).await?;

        let refund_user = user::Entity::find_by_id(auth_user.user_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
        let new_diamond = refund_user.diamond + cost;
        let mut active_user: user::ActiveModel = refund_user.clone().into();
        active_user.diamond = Set(new_diamond);
        active_user.updated_at = Set(Utc::now());
        active_user.update(&tx).await?;
        asset_transaction::record(
            &tx,
            refund_user.id,
            DIAMOND,
            cost,
            new_diamond,
            "学习计划生成失败退款",
        )
        .await?;

        tx.commit().await?;
        return Err(err);
    }

    Ok(created(StudySubjectView::from(record)))
}

/// GET /api/v1/study-subjects
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub q: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<ListQuery>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let mut select = study_subject::Entity::find()
        .filter(study_subject::Column::UserId.eq(auth_user.user_id))
        .order_by_desc(study_subject::Column::CreatedAt);

    if let Some(q) = query.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        select = select.filter(study_subject::Column::Subject.contains(q));
    }

    let records = select.all(&state.db).await?;

    let views: Vec<StudySubjectView> = records.into_iter().map(StudySubjectView::from).collect();
    Ok(ok(views))
}

/// GET /api/v1/study-subjects/{id}
pub async fn get_by_id(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let record = study_subject::Entity::find_by_id(id)
        .filter(study_subject::Column::UserId.eq(auth_user.user_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;

    Ok(ok(StudySubjectView::from(record)))
}

/// GET /api/v1/study-subjects/{id}/pretest
pub async fn get_pretest(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let subject = study_subject::Entity::find_by_id(id)
        .filter(study_subject::Column::UserId.eq(auth_user.user_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;

    let pretest_problems = pretest_problem::Entity::find()
        .filter(pretest_problem::Column::StudySubjectId.eq(subject.id))
        .order_by_asc(pretest_problem::Column::SortOrder)
        .all(&state.db)
        .await?;

    let views: Vec<PretestProblemView> = pretest_problems
        .into_iter()
        .map(|pp| PretestProblemView {
            id: pp.id,
            sort_order: pp.sort_order,
            content: pp.content,
            choice_a: pp.choice_a,
            choice_b: pp.choice_b,
            choice_c: pp.choice_c,
            choice_d: pp.choice_d,
            answer: pp.answer,
            explanation: pp.explanation,
            confidence: pp.confidence,
            chosen_answer: pp.chosen_answer,
        })
        .collect();

    Ok(ok(views))
}

/// GET /api/v1/study-subjects/{id}/stages
pub async fn list_stages(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let subject = study_subject::Entity::find_by_id(id)
        .filter(study_subject::Column::UserId.eq(auth_user.user_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;

    let stages = study_stage::Entity::find()
        .filter(study_stage::Column::StudySubjectId.eq(subject.id))
        .order_by_asc(study_stage::Column::SortOrder)
        .all(&state.db)
        .await?;

    let stage_ids: Vec<i32> = stages.iter().map(|s| s.id).collect();
    let tasks = study_task::Entity::find()
        .filter(study_task::Column::StudyStageId.is_in(stage_ids))
        .order_by_asc(study_task::Column::SortOrder)
        .all(&state.db)
        .await?;

    let mut tasks_by_stage: std::collections::HashMap<i32, Vec<StudyTaskBriefView>> =
        std::collections::HashMap::new();
    for t in tasks {
        tasks_by_stage
            .entry(t.study_stage_id)
            .or_default()
            .push(StudyTaskBriefView {
                id: t.id,
                title: t.title,
                description: t.description,
                sort_order: t.sort_order,
                status: t.status,
                created_at: t.created_at.timestamp_millis(),
            });
    }

    let views: Vec<StudyStageDetailView> = stages
        .into_iter()
        .map(|s| StudyStageDetailView {
            id: s.id,
            study_subject_id: s.study_subject_id,
            title: s.title,
            description: s.description,
            sort_order: s.sort_order,
            status: s.status,
            total_tasks: s.total_tasks,
            finished_tasks: s.finished_tasks,
            created_at: s.created_at.timestamp_millis(),
            tasks: tasks_by_stage.remove(&s.id).unwrap_or_default(),
        })
        .collect();

    Ok(ok(views))
}

/// GET /api/v1/study-subjects/{id}/knowledge-tree
pub async fn get_knowledge_tree(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    use crate::entities::{
        curriculum_node, curriculum_source, curriculum_template, study_task_curriculum_node,
    };
    use std::collections::{HashMap, HashSet};

    let subject = study_subject::Entity::find_by_id(id)
        .filter(study_subject::Column::UserId.eq(auth_user.user_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;
    let Some(template_id) = subject.curriculum_template_id else {
        return Ok(ok(KnowledgeTreeView {
            legacy: true,
            template: None,
            sources: Vec::new(),
            nodes: Vec::new(),
        }));
    };

    let template = curriculum_template::Entity::find_by_id(template_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::internal("curriculum template missing"))?;
    let sources = curriculum_source::Entity::find()
        .filter(curriculum_source::Column::CurriculumTemplateId.eq(template_id))
        .filter(
            curriculum_source::Column::Status
                .eq(curriculum_source::CurriculumSourceStatus::Published),
        )
        .all(&state.db)
        .await?;
    let nodes = curriculum_node::Entity::find()
        .filter(curriculum_node::Column::CurriculumTemplateId.eq(template_id))
        .order_by_asc(curriculum_node::Column::SortOrder)
        .all(&state.db)
        .await?;

    let stages = study_stage::Entity::find()
        .filter(study_stage::Column::StudySubjectId.eq(subject.id))
        .all(&state.db)
        .await?;
    let stage_ids = stages.into_iter().map(|stage| stage.id).collect::<Vec<_>>();
    let tasks = if stage_ids.is_empty() {
        Vec::new()
    } else {
        study_task::Entity::find()
            .filter(study_task::Column::StudyStageId.is_in(stage_ids))
            .all(&state.db)
            .await?
    };
    let task_ids = tasks.iter().map(|task| task.id).collect::<Vec<_>>();
    let links = if task_ids.is_empty() {
        Vec::new()
    } else {
        study_task_curriculum_node::Entity::find()
            .filter(study_task_curriculum_node::Column::StudyTaskId.is_in(task_ids))
            .all(&state.db)
            .await?
    };
    let task_by_id = tasks
        .into_iter()
        .map(|task| (task.id, task))
        .collect::<HashMap<_, _>>();
    let key_by_node_id = nodes
        .iter()
        .map(|node| (node.id, node.node_key.clone()))
        .collect::<HashMap<_, _>>();
    let mut direct_task_ids: HashMap<String, Vec<i32>> = HashMap::new();
    for link in links {
        if let Some(key) = key_by_node_id.get(&link.curriculum_node_id) {
            direct_task_ids
                .entry(key.clone())
                .or_default()
                .push(link.study_task_id);
        }
    }
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    for node in &nodes {
        if let Some(parent) = &node.parent_node_key {
            children
                .entry(parent.clone())
                .or_default()
                .push(node.node_key.clone());
        }
    }
    fn descendants(
        key: &str,
        children: &HashMap<String, Vec<String>>,
        output: &mut HashSet<String>,
    ) {
        if !output.insert(key.to_owned()) {
            return;
        }
        if let Some(items) = children.get(key) {
            for child in items {
                descendants(child, children, output);
            }
        }
    }

    let node_views = nodes
        .into_iter()
        .map(|node| {
            let mut subtree = HashSet::new();
            descendants(&node.node_key, &children, &mut subtree);
            let aggregate_ids = subtree
                .iter()
                .flat_map(|key| direct_task_ids.get(key).into_iter().flatten().copied())
                .collect::<HashSet<_>>();
            let finished = aggregate_ids
                .iter()
                .filter(|task_id| {
                    task_by_id
                        .get(task_id)
                        .is_some_and(|task| task.status == study_task::StudyTaskStatus::Finished)
                })
                .count();
            let available = aggregate_ids.iter().any(|task_id| {
                task_by_id
                    .get(task_id)
                    .is_some_and(|task| task.status == study_task::StudyTaskStatus::Studying)
            });
            let progress = if aggregate_ids.is_empty() {
                0
            } else {
                ((finished * 100) / aggregate_ids.len()) as i32
            };
            let mut related_tasks = aggregate_ids
                .iter()
                .filter_map(|task_id| task_by_id.get(task_id))
                .map(|task| KnowledgeTreeTaskView {
                    id: task.id,
                    title: task.title.clone(),
                    status: task.status,
                })
                .collect::<Vec<_>>();
            related_tasks.sort_by_key(|task| task.id);
            KnowledgeTreeNodeView {
                node_key: node.node_key,
                parent_node_key: node.parent_node_key,
                title: node.title,
                description: node.description,
                depth: node.depth,
                sort_order: node.sort_order,
                planned: !aggregate_ids.is_empty(),
                progress,
                available,
                tasks: related_tasks,
            }
        })
        .collect();

    Ok(ok(KnowledgeTreeView {
        legacy: false,
        template: Some(KnowledgeTreeTemplateView {
            id: template.id,
            canonical_name: template.canonical_name,
            version: template.version,
        }),
        sources: sources
            .into_iter()
            .map(|source| KnowledgeTreeSourceView {
                platform: source.platform,
                institution: source.institution,
                source_url: source.source_url,
            })
            .collect(),
        nodes: node_views,
    }))
}

/// PATCH /api/v1/study-subjects/{id}/pretest/{pretest_problem_id}
pub async fn update_pretest_problem(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((id, pretest_problem_id)): Path<(i32, i32)>,
    Json(payload): Json<UpdatePretestProblemRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let subject = study_subject::Entity::find_by_id(id)
        .filter(study_subject::Column::UserId.eq(auth_user.user_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;

    if subject.status != StudySubjectStatus::PretestReady {
        return Err(AppError::business(BusinessError::InvalidStudySubjectStatus));
    }

    let pp = pretest_problem::Entity::find_by_id(pretest_problem_id)
        .filter(pretest_problem::Column::StudySubjectId.eq(subject.id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ProblemNotFound))?;

    let mut active: pretest_problem::ActiveModel = pp.into();
    active.chosen_answer = Set(Some(payload.chosen_answer));
    active.confidence = Set(Some(payload.confidence));
    active.update(&state.db).await?;

    Ok(ok(serde_json::json!({"success": true})))
}

/// POST /api/v1/study-subjects/{id}/plan
pub async fn create_plan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let tx = state.db.begin().await?;

    let subject = study_subject::Entity::find_by_id(id)
        .filter(study_subject::Column::UserId.eq(auth_user.user_id))
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;

    if subject.status != StudySubjectStatus::PretestReady {
        return Err(AppError::business(BusinessError::InvalidStudySubjectStatus));
    }

    let template_id = match subject.curriculum_template_id {
        Some(id) => id,
        None => curriculum::match_legacy_template(&tx, &subject.subject, &subject.language)
            .await?
            .map(|template| template.id)
            .ok_or_else(|| AppError::internal("plan subject is missing curriculum template"))?,
    };

    let mut active: study_subject::ActiveModel = subject.clone().into();
    active.status = Set(StudySubjectStatus::PlanQueuing);
    active.curriculum_template_id = Set(Some(template_id));
    active.updated_at = Set(Utc::now());
    active.update(&tx).await?;

    // Gather pretest results for the plan microservice
    let pretest_problems = pretest_problem::Entity::find()
        .filter(pretest_problem::Column::StudySubjectId.eq(subject.id))
        .order_by_asc(pretest_problem::Column::SortOrder)
        .all(&tx)
        .await?;

    let node_keys_by_id: std::collections::HashMap<i32, String> =
        crate::entities::curriculum_node::Entity::find()
            .filter(crate::entities::curriculum_node::Column::CurriculumTemplateId.eq(template_id))
            .all(&tx)
            .await?
            .into_iter()
            .map(|node| (node.id, node.node_key))
            .collect();

    let pretest_results: Vec<PretestResult> = pretest_problems
        .iter()
        .map(|pp| PretestResult {
            problem_id: pp.id,
            content: pp.content.clone(),
            choice_a: pp.choice_a.clone(),
            choice_b: pp.choice_b.clone(),
            choice_c: pp.choice_c.clone(),
            choice_d: pp.choice_d.clone(),
            answer: format!("{:?}", pp.answer),
            chosen_answer: pp.chosen_answer.map(|a| format!("{:?}", a)),
            confidence: pp.confidence.map(|c| format!("{:?}", c)),
            knowledge_node_key: pp
                .curriculum_node_id
                .and_then(|id| node_keys_by_id.get(&id).cloned()),
        })
        .collect();

    let existing_user = user::Entity::find_by_id(auth_user.user_id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
    let learner_profile = LearnerProfileSnapshot::from_user(&existing_user);
    let user_subjects = study_subject::Entity::find()
        .filter(study_subject::Column::UserId.eq(auth_user.user_id))
        .all(&tx)
        .await?;
    let completed_subjects = user_subjects
        .iter()
        .filter(|item| item.status == StudySubjectStatus::Finished)
        .map(|item| item.subject.clone())
        .collect::<Vec<_>>();

    let user_subject_ids = user_subjects.iter().map(|item| item.id).collect::<Vec<_>>();
    let user_stage_ids = if user_subject_ids.is_empty() {
        Vec::new()
    } else {
        study_stage::Entity::find()
            .filter(study_stage::Column::StudySubjectId.is_in(user_subject_ids))
            .all(&tx)
            .await?
            .into_iter()
            .map(|stage| stage.id)
            .collect::<Vec<_>>()
    };
    let user_tasks = if user_stage_ids.is_empty() {
        Vec::new()
    } else {
        study_task::Entity::find()
            .filter(study_task::Column::StudyStageId.is_in(user_stage_ids))
            .all(&tx)
            .await?
    };
    let user_task_ids = user_tasks.iter().map(|task| task.id).collect::<Vec<_>>();
    let finished_task_ids = user_tasks
        .iter()
        .filter(|task| task.status == study_task::StudyTaskStatus::Finished)
        .map(|task| task.id)
        .collect::<std::collections::HashSet<_>>();
    let task_node_links = if user_task_ids.is_empty() {
        Vec::new()
    } else {
        study_task_curriculum_node::Entity::find()
            .filter(study_task_curriculum_node::Column::StudyTaskId.is_in(user_task_ids.clone()))
            .all(&tx)
            .await?
    };
    let completed_knowledge_node_keys = task_node_links
        .iter()
        .filter(|link| finished_task_ids.contains(&link.study_task_id))
        .filter_map(|link| node_keys_by_id.get(&link.curriculum_node_id).cloned())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    let recent_quizzes = if user_task_ids.is_empty() {
        Vec::new()
    } else {
        study_quiz::Entity::find()
            .filter(study_quiz::Column::StudyTaskId.is_in(user_task_ids))
            .filter(study_quiz::Column::Status.eq(study_quiz::StudyQuizStatus::Submitted))
            .order_by_desc(study_quiz::Column::UpdatedAt)
            .limit(50)
            .all(&tx)
            .await?
    };
    let quiz_task_by_id = recent_quizzes
        .iter()
        .map(|quiz| (quiz.id, quiz.study_task_id))
        .collect::<std::collections::HashMap<_, _>>();
    let quiz_ids = recent_quizzes
        .iter()
        .map(|quiz| quiz.id)
        .collect::<Vec<_>>();
    let wrong_quiz_task_ids = if quiz_ids.is_empty() {
        std::collections::HashSet::new()
    } else {
        study_quiz_problem::Entity::find()
            .filter(study_quiz_problem::Column::StudyQuizId.is_in(quiz_ids))
            .all(&tx)
            .await?
            .into_iter()
            .filter(|problem| problem.chosen_answer != Some(problem.answer))
            .filter_map(|problem| quiz_task_by_id.get(&problem.study_quiz_id).copied())
            .collect::<std::collections::HashSet<_>>()
    };
    let mut weak_knowledge_node_keys = pretest_problems
        .iter()
        .filter(|problem| {
            problem.chosen_answer != Some(problem.answer)
                || problem.confidence != Some(pretest_problem::PretestConfidence::VerySure)
        })
        .filter_map(|problem| {
            problem
                .curriculum_node_id
                .and_then(|node_id| node_keys_by_id.get(&node_id).cloned())
        })
        .collect::<std::collections::HashSet<_>>();
    weak_knowledge_node_keys.extend(
        task_node_links
            .iter()
            .filter(|link| wrong_quiz_task_ids.contains(&link.study_task_id))
            .filter_map(|link| node_keys_by_id.get(&link.curriculum_node_id).cloned()),
    );
    let weak_knowledge_node_keys = weak_knowledge_node_keys.into_iter().collect::<Vec<_>>();

    tx.commit().await?;

    let request = PlanRequest {
        task_id: subject.id,
        prompt: subject.subject.clone(),
        total_stages: subject.total_stages,
        language: subject.language.clone(),
        target: subject.target.clone(),
        pretest_results,
        learner_profile,
        learner_history: LearnerHistorySnapshot {
            completed_subjects,
            completed_knowledge_node_keys,
            weak_knowledge_node_keys,
        },
        authoritative_outline: curriculum::load_outline(&state.db, template_id).await?,
    };

    if let Err(err) = dispatch_plan(
        state.publisher.as_ref(),
        &state.config.plan_exchange,
        &request,
    )
    .await
    {
        let tx = state.db.begin().await?;

        let mut active: study_subject::ActiveModel = subject.clone().into();
        active.status = Set(StudySubjectStatus::Failed);
        active.failure_code = Set(Some("PLAN_DISPATCH_FAILED".to_owned()));
        active.updated_at = Set(Utc::now());
        active.update(&tx).await?;

        let cost = subject.diamond_cost;
        let refund_user = user::Entity::find_by_id(auth_user.user_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
        let new_diamond = refund_user.diamond + cost;
        let mut active_user: user::ActiveModel = refund_user.clone().into();
        active_user.diamond = Set(new_diamond);
        active_user.updated_at = Set(Utc::now());
        active_user.update(&tx).await?;
        asset_transaction::record(
            &tx,
            refund_user.id,
            DIAMOND,
            cost,
            new_diamond,
            "学习计划生成失败退款",
        )
        .await?;

        tx.commit().await?;
        return Err(err);
    }

    Ok(ok(
        serde_json::json!({"id": subject.id, "status": "PLAN_QUEUING"}),
    ))
}
