use axum::{
    Json,
    extract::{Path, Query, State},
};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, JoinType, QueryFilter,
    QueryOrder, QuerySelect, RelationTrait,
};
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::{
    auth::AuthUser,
    entities::{
        asset_transaction,
        common::{Gender, ProblemAnswer},
        curriculum_node, knowledge_explanation, knowledge_video, study_quiz, study_quiz_problem,
        study_stage, study_subject, study_task, study_task_curriculum_node, user,
        user_knowledge_video_link,
    },
    error::{AppError, BusinessError},
    response::ok,
    routes::user_views::UserView,
    state::AppState,
};

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateMeRequest {
    pub birth_year: Option<i32>,
    pub gender: Option<Gender>,
    #[validate(length(max = 1_024))]
    pub introduction: Option<String>,
    pub active_study_subject_id: Option<i32>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateUsernameRequest {
    #[validate(length(min = 3, max = 32))]
    pub username: String,
}

#[derive(Debug, Serialize)]
pub struct MeProfileView {
    id: i32,
    username: String,
    birth_year: Option<i32>,
    gender: Option<Gender>,
    introduction: String,
    active_study_subject_id: Option<i32>,
}

pub async fn get_me(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let user = user::Entity::find_by_id(auth_user.user_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

    Ok(ok(UserView::from(user)))
}

#[derive(Debug, Serialize)]
pub struct AssetOverviewView {
    exp: i32,
    gold: i32,
    diamond: i32,
    transactions: Vec<AssetTransactionView>,
}

#[derive(Debug, Serialize)]
pub struct AssetTransactionView {
    id: i32,
    asset: String,
    amount: i32,
    balance_after: i32,
    title: String,
    created_at: i64,
}

/// GET /api/v1/me/assets
pub async fn get_assets(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let user = user::Entity::find_by_id(auth_user.user_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

    let transactions = asset_transaction::Entity::find()
        .filter(asset_transaction::Column::UserId.eq(auth_user.user_id))
        .order_by_desc(asset_transaction::Column::CreatedAt)
        .order_by_desc(asset_transaction::Column::Id)
        .limit(200)
        .all(&state.db)
        .await?
        .into_iter()
        .map(|item| AssetTransactionView {
            id: item.id,
            asset: item.asset,
            amount: item.amount,
            balance_after: item.balance_after,
            title: item.title,
            created_at: item.created_at.timestamp_millis(),
        })
        .collect();

    Ok(ok(AssetOverviewView {
        exp: user.exp,
        gold: user.gold,
        diamond: user.diamond,
        transactions,
    }))
}

pub async fn update_me(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<UpdateMeRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    payload.validate()?;

    let user = user::Entity::find_by_id(auth_user.user_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

    let mut active_user: user::ActiveModel = user.into();

    if let Some(birth_year) = payload.birth_year {
        active_user.birth_year = Set(Some(birth_year));
    }

    if let Some(gender) = payload.gender {
        active_user.gender = Set(Some(gender));
    }

    if let Some(introduction) = payload.introduction {
        active_user.introduction = Set(introduction);
    }

    if let Some(subject_id) = payload.active_study_subject_id {
        let owns = study_subject::Entity::find_by_id(subject_id)
            .filter(study_subject::Column::UserId.eq(auth_user.user_id))
            .one(&state.db)
            .await?
            .is_some();
        if !owns {
            return Err(AppError::business(BusinessError::StudySubjectNotFound));
        }
        active_user.active_study_subject_id = Set(Some(subject_id));
    }

    active_user.updated_at = Set(chrono::Utc::now());
    let updated = active_user.update(&state.db).await?;

    Ok(ok(MeProfileView {
        id: updated.id,
        username: updated.username,
        birth_year: updated.birth_year,
        gender: updated.gender,
        introduction: updated.introduction,
        active_study_subject_id: updated.active_study_subject_id,
    }))
}

pub async fn update_username(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<UpdateUsernameRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    payload.validate()?;

    let existing_user = user::Entity::find_by_id(auth_user.user_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

    if existing_user.username == payload.username {
        return Ok(ok(UserView::from(existing_user)));
    }

    let existing = user::Entity::find()
        .filter(user::Column::Username.eq(payload.username.as_str()))
        .one(&state.db)
        .await?;

    if existing.is_some() {
        return Err(AppError::business(BusinessError::UsernameAlreadyExists));
    }

    let mut active_user: user::ActiveModel = existing_user.into();
    active_user.username = Set(payload.username);
    active_user.updated_at = Set(chrono::Utc::now());

    let updated = active_user.update(&state.db).await?;

    Ok(ok(UserView::from(updated)))
}

// ── Mistakes / Bookmarks ──

#[derive(Debug, Serialize)]
pub struct QuizProblemReviewView {
    pub id: i32,
    pub sort_order: i32,
    pub content: String,
    pub choice_a: String,
    pub choice_b: String,
    pub choice_c: String,
    pub choice_d: String,
    pub answer: ProblemAnswer,
    pub explanation: String,
    pub chosen_answer: Option<ProblemAnswer>,
    pub bookmarked: bool,
    pub bookmarked_at: Option<i64>,
    pub mistake_hidden: bool,
    pub created_at: i64,
    pub source: QuizProblemSource,
}

#[derive(Debug, Serialize)]
pub struct QuizProblemSource {
    pub quiz_id: i32,
    pub task_id: i32,
    pub task_title: String,
    pub knowledge_point_title: String,
    pub stage_id: i32,
    pub stage_title: String,
    pub subject_id: i32,
    pub subject_name: String,
}

#[derive(Debug, Serialize)]
pub struct BookmarkItemView {
    pub id: i32,
    pub kind: &'static str,
    pub title: String,
    pub description: String,
    pub knowledge_point_title: Option<String>,
    pub source: Option<QuizProblemSource>,
    pub open_url: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct ProblemSearchQuery {
    #[serde(default)]
    pub include_hidden: Option<bool>,
    #[serde(default)]
    pub q: Option<String>,
}

/// GET /api/v1/quiz-problems/{id}. The result is scoped to the current user's
/// study subject, so a bookmarked-problem URL can never reveal another user's quiz.
pub async fn get_quiz_problem(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let rows: Vec<(
        study_quiz_problem::Model,
        Option<study_quiz::Model>,
        Option<study_task::Model>,
        Option<study_stage::Model>,
        Option<study_subject::Model>,
    )> = study_quiz_problem::Entity::find_by_id(id)
        .find_also_related(study_quiz::Entity)
        .join(JoinType::InnerJoin, study_quiz::Relation::StudyTask.def())
        .join(JoinType::InnerJoin, study_task::Relation::StudyStage.def())
        .join(
            JoinType::InnerJoin,
            study_stage::Relation::StudySubject.def(),
        )
        .filter(study_subject::Column::UserId.eq(auth_user.user_id))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|(qp, quiz)| (qp, quiz, None, None, None))
        .collect();

    let problem = build_review_views(&state, rows, |_| true)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::business(BusinessError::StudyQuizProblemNotFound))?;

    Ok(ok(problem))
}

/// GET /api/v1/me/mistakes
pub async fn list_mistakes(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<ProblemSearchQuery>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let include_hidden = query.include_hidden.unwrap_or(false);
    let q = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);

    let mut select = study_quiz_problem::Entity::find()
        .find_also_related(study_quiz::Entity)
        .join(JoinType::InnerJoin, study_quiz::Relation::StudyTask.def())
        .join(JoinType::InnerJoin, study_task::Relation::StudyStage.def())
        .join(
            JoinType::InnerJoin,
            study_stage::Relation::StudySubject.def(),
        )
        .filter(study_subject::Column::UserId.eq(auth_user.user_id));

    if let Some(ref q) = q {
        select = select.filter(study_quiz_problem::Column::Content.contains(q));
    }

    let rows: Vec<(
        study_quiz_problem::Model,
        Option<study_quiz::Model>,
        Option<study_task::Model>,
        Option<study_stage::Model>,
        Option<study_subject::Model>,
    )> = select
        .all(&state.db)
        .await?
        .into_iter()
        .map(|(qp, q)| (qp, q, None, None, None))
        .collect();

    // SeaORM 不能一次性 join 5 张表并把每张映射到 tuple，分两步取来源链。
    let views = build_review_views(&state, rows, |qp| {
        qp.chosen_answer.map(|c| c != qp.answer).unwrap_or(false)
            && (include_hidden || !qp.mistake_hidden)
    })
    .await?;

    Ok(ok(views))
}

/// GET /api/v1/me/bookmarks. Returns problems, videos, and knowledge explanations.
pub async fn list_bookmarks(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<ProblemSearchQuery>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let q = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);

    let mut select = study_quiz_problem::Entity::find()
        .find_also_related(study_quiz::Entity)
        .join(JoinType::InnerJoin, study_quiz::Relation::StudyTask.def())
        .join(JoinType::InnerJoin, study_task::Relation::StudyStage.def())
        .join(
            JoinType::InnerJoin,
            study_stage::Relation::StudySubject.def(),
        )
        .filter(study_subject::Column::UserId.eq(auth_user.user_id))
        .filter(study_quiz_problem::Column::Bookmarked.eq(true));

    if let Some(ref q) = q {
        select = select.filter(study_quiz_problem::Column::Content.contains(q));
    }

    let rows: Vec<(
        study_quiz_problem::Model,
        Option<study_quiz::Model>,
        Option<study_task::Model>,
        Option<study_stage::Model>,
        Option<study_subject::Model>,
    )> = select
        .all(&state.db)
        .await?
        .into_iter()
        .map(|(qp, q)| (qp, q, None, None, None))
        .collect();

    let mut items: Vec<BookmarkItemView> = build_review_views(&state, rows, |_| true)
        .await?
        .into_iter()
        .map(|problem| BookmarkItemView {
            id: problem.id,
            kind: "quiz_problem",
            title: "小测题目".to_owned(),
            description: problem.content,
            knowledge_point_title: Some(problem.source.knowledge_point_title.clone()),
            source: Some(problem.source),
            open_url: Some(format!("/quiz-problems/{}", problem.id)),
            // Records created before bookmark timestamps were introduced fall back
            // to their creation time, while all new favourites use the actual action time.
            created_at: problem.bookmarked_at.unwrap_or(problem.created_at),
        })
        .collect();

    let mut videos = user_knowledge_video_link::Entity::find()
        .filter(user_knowledge_video_link::Column::UserId.eq(auth_user.user_id))
        .find_also_related(knowledge_video::Entity)
        .filter(knowledge_video::Column::Bookmarked.eq(true));
    if let Some(ref q) = q {
        videos = videos.filter(knowledge_video::Column::Prompt.contains(q));
    }
    items.extend(
        videos
            .all(&state.db)
            .await?
            .into_iter()
            .filter_map(|(_link, video)| video)
            .map(|video| BookmarkItemView {
                id: video.id,
                kind: "knowledge_video",
                title: "知识视频".to_owned(),
                description: video.prompt,
                knowledge_point_title: None,
                source: None,
                open_url: None,
                created_at: video
                    .bookmarked_at
                    .unwrap_or(video.created_at)
                    .timestamp_millis(),
            }),
    );

    let mut explanations = knowledge_explanation::Entity::find()
        .filter(knowledge_explanation::Column::UserId.eq(auth_user.user_id))
        .filter(knowledge_explanation::Column::Bookmarked.eq(true));
    if let Some(ref q) = q {
        explanations = explanations.filter(knowledge_explanation::Column::Prompt.contains(q));
    }
    let explanations = explanations.all(&state.db).await?;
    let explanation_ids = explanations.iter().map(|item| item.id).collect::<Vec<_>>();
    let task_id_by_explanation_id = if explanation_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        study_task::Entity::find()
            .filter(study_task::Column::KnowledgeExplanationId.is_in(explanation_ids))
            .all(&state.db)
            .await?
            .into_iter()
            .filter_map(|task| task.knowledge_explanation_id.map(|id| (id, task.id)))
            .collect::<std::collections::HashMap<_, _>>()
    };
    items.extend(explanations.into_iter().map(|explanation| BookmarkItemView {
        id: explanation.id,
        kind: "knowledge_explanation",
        title: "知识点解析".to_owned(),
        description: explanation.prompt,
        knowledge_point_title: None,
        source: None,
        open_url: task_id_by_explanation_id
            .get(&explanation.id)
            .map(|task_id| format!("/tasks/{task_id}#explanation")),
        created_at: explanation
            .bookmarked_at
            .unwrap_or(explanation.created_at)
            .timestamp_millis(),
    }));

    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(ok(items))
}

async fn build_review_views(
    state: &AppState,
    rows: Vec<(
        study_quiz_problem::Model,
        Option<study_quiz::Model>,
        Option<study_task::Model>,
        Option<study_stage::Model>,
        Option<study_subject::Model>,
    )>,
    keep: impl Fn(&study_quiz_problem::Model) -> bool,
) -> Result<Vec<QuizProblemReviewView>, AppError> {
    let filtered: Vec<(study_quiz_problem::Model, study_quiz::Model)> = rows
        .into_iter()
        .filter_map(|(qp, q, _, _, _)| q.map(|q| (qp, q)))
        .filter(|(qp, _)| keep(qp))
        .collect();

    if filtered.is_empty() {
        return Ok(Vec::new());
    }

    // 一次性取齐来源链
    let task_ids: Vec<i32> = filtered.iter().map(|(_, q)| q.study_task_id).collect();
    let tasks = study_task::Entity::find()
        .filter(study_task::Column::Id.is_in(task_ids.clone()))
        .all(&state.db)
        .await?;
    let task_map: std::collections::HashMap<i32, study_task::Model> =
        tasks.into_iter().map(|t| (t.id, t)).collect();

    // A task can be associated with more than one curriculum node. Preserve
    // all mapped point titles for review/bookmark context; older plans without
    // a tree fall back to their task title below.
    let task_node_links = study_task_curriculum_node::Entity::find()
        .filter(study_task_curriculum_node::Column::StudyTaskId.is_in(task_ids))
        .all(&state.db)
        .await?;
    let node_ids = task_node_links
        .iter()
        .map(|link| link.curriculum_node_id)
        .collect::<Vec<_>>();
    let node_titles_by_id = if node_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        curriculum_node::Entity::find()
            .filter(curriculum_node::Column::Id.is_in(node_ids))
            .all(&state.db)
            .await?
            .into_iter()
            .map(|node| (node.id, node.title))
            .collect::<std::collections::HashMap<_, _>>()
    };
    let mut knowledge_points_by_task: std::collections::HashMap<i32, Vec<String>> =
        std::collections::HashMap::new();
    for link in task_node_links {
        if let Some(title) = node_titles_by_id.get(&link.curriculum_node_id) {
            knowledge_points_by_task
                .entry(link.study_task_id)
                .or_default()
                .push(title.clone());
        }
    }
    for titles in knowledge_points_by_task.values_mut() {
        titles.sort();
        titles.dedup();
    }

    let stage_ids: Vec<i32> = task_map.values().map(|t| t.study_stage_id).collect();
    let stages = study_stage::Entity::find()
        .filter(study_stage::Column::Id.is_in(stage_ids))
        .all(&state.db)
        .await?;
    let stage_map: std::collections::HashMap<i32, study_stage::Model> =
        stages.into_iter().map(|s| (s.id, s)).collect();

    let subject_ids: Vec<i32> = stage_map.values().map(|s| s.study_subject_id).collect();
    let subjects = study_subject::Entity::find()
        .filter(study_subject::Column::Id.is_in(subject_ids))
        .all(&state.db)
        .await?;
    let subject_map: std::collections::HashMap<i32, study_subject::Model> =
        subjects.into_iter().map(|s| (s.id, s)).collect();

    let mut views: Vec<QuizProblemReviewView> = filtered
        .into_iter()
        .filter_map(|(qp, q)| {
            let task = task_map.get(&q.study_task_id)?;
            let stage = stage_map.get(&task.study_stage_id)?;
            let subject = subject_map.get(&stage.study_subject_id)?;
            let knowledge_point_title = knowledge_points_by_task
                .get(&task.id)
                .filter(|titles| !titles.is_empty())
                .map(|titles| titles.join("、"))
                .unwrap_or_else(|| task.title.clone());
            Some(QuizProblemReviewView {
                id: qp.id,
                sort_order: qp.sort_order,
                content: qp.content,
                choice_a: qp.choice_a,
                choice_b: qp.choice_b,
                choice_c: qp.choice_c,
                choice_d: qp.choice_d,
                answer: qp.answer,
                explanation: qp.explanation,
                chosen_answer: qp.chosen_answer,
                bookmarked: qp.bookmarked,
                bookmarked_at: qp.bookmarked_at.map(|time| time.timestamp_millis()),
                mistake_hidden: qp.mistake_hidden,
                created_at: qp.created_at.timestamp_millis(),
                source: QuizProblemSource {
                    quiz_id: q.id,
                    task_id: task.id,
                    task_title: task.title.clone(),
                    knowledge_point_title,
                    stage_id: stage.id,
                    stage_title: stage.title.clone(),
                    subject_id: subject.id,
                    subject_name: subject.subject.clone(),
                },
            })
        })
        .collect();

    views.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(views)
}
