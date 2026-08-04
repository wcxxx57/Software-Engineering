use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, patch, post},
};
use chrono::{Duration, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::{
    auth::{ServiceAuth, ServiceKind},
    entities::{
        code_video, common::ProblemAnswer, curriculum_node, interactive_html,
        knowledge_explanation, knowledge_video, pretest_problem, study_quiz,
        study_quiz::StudyQuizStatus, study_quiz_problem, study_stage,
        study_stage::StudyStageStatus, study_subject, study_subject::StudySubjectStatus,
        study_task, study_task::StudyTaskStatus, study_task_curriculum_node, user,
        user_code_video_link, user_interactive_html_link, user_knowledge_video_link,
    },
    error::{AppError, BusinessError},
    response::ok,
    services::{
        asset_transaction::{self, DIAMOND, GOLD},
        curriculum,
        personalization::LearnerProfileSnapshot,
        study_subject::{PretestRequest, dispatch_pretest},
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/knowledge-videos/gc", get(knowledge_video_gc_candidates))
        .route(
            "/knowledge-videos/gc/{id}/confirm",
            post(confirm_knowledge_video_gc),
        )
        .route("/code-videos/gc", get(code_video_gc_candidates))
        .route("/code-videos/gc/{id}/confirm", post(confirm_code_video_gc))
        .route("/knowledge-videos/{id}", patch(update_knowledge_video))
        .route("/code-videos/{id}", patch(update_code_video))
        .route("/interactive-htmls/{id}", patch(update_interactive_html))
        .route(
            "/knowledge-explanations/{id}",
            patch(update_knowledge_explanation),
        )
        .route("/study-subjects/{id}", post(callback_study_subject))
        .route(
            "/curriculum-acquisitions/{id}",
            post(callback_curriculum_acquisition),
        )
        .route("/study-quizzes/{id}", post(callback_study_quiz))
        .route("/users/{id}/balance", post(recharge_balance))
}

#[derive(Debug, Deserialize)]
pub struct UpdateStatusRequest {
    pub status: String,
    pub object_key: Option<String>,
    pub content: Option<String>,
}

// 通过 link 或 study_task 反查 resource 所属用户。
// link 命中即工具自由创建，否则尝试任务派生。返回 None 表示孤儿资源。
async fn resolve_owner_via_task<C: ConnectionTrait>(
    db: &C,
    task_filter: study_task::Column,
    resource_id: i32,
) -> Result<Option<i32>, AppError> {
    let task = study_task::Entity::find()
        .filter(task_filter.eq(resource_id))
        .one(db)
        .await?;
    let Some(task) = task else {
        return Ok(None);
    };
    let stage = study_stage::Entity::find_by_id(task.study_stage_id)
        .one(db)
        .await?;
    let Some(stage) = stage else {
        return Ok(None);
    };
    let subject = study_subject::Entity::find_by_id(stage.study_subject_id)
        .one(db)
        .await?;
    Ok(subject.map(|s| s.user_id))
}

async fn resolve_knowledge_video_owner<C: ConnectionTrait>(
    db: &C,
    id: i32,
) -> Result<Option<i32>, AppError> {
    if let Some(link) = user_knowledge_video_link::Entity::find_by_id(id)
        .one(db)
        .await?
    {
        return Ok(Some(link.user_id));
    }
    resolve_owner_via_task(db, study_task::Column::KnowledgeVideoId, id).await
}

async fn resolve_code_video_owner<C: ConnectionTrait>(
    db: &C,
    id: i32,
) -> Result<Option<i32>, AppError> {
    if let Some(link) = user_code_video_link::Entity::find_by_id(id).one(db).await? {
        return Ok(Some(link.user_id));
    }
    // C2V 无任务派生路径——孤儿即返回 None
    Ok(None)
}

async fn resolve_interactive_html_owner<C: ConnectionTrait>(
    db: &C,
    id: i32,
) -> Result<Option<i32>, AppError> {
    if let Some(link) = user_interactive_html_link::Entity::find_by_id(id)
        .one(db)
        .await?
    {
        return Ok(Some(link.user_id));
    }
    resolve_owner_via_task(db, study_task::Column::InteractiveHtmlId, id).await
}

#[derive(Debug, Deserialize)]
struct GcQuery {
    #[serde(default = "default_gc_grace_seconds")]
    grace_seconds: i64,
}

fn default_gc_grace_seconds() -> i64 {
    86_400
}

#[derive(Debug, Serialize)]
struct GcCandidate {
    id: i32,
    object_key: Option<String>,
    created_at: i64,
}

#[derive(Debug, Serialize)]
struct GcSnapshot {
    referenced_object_keys: Vec<String>,
    candidates: Vec<GcCandidate>,
}

#[derive(Debug, Deserialize)]
struct GcConfirmRequest {
    object_key: Option<String>,
}

async fn knowledge_video_gc_candidates(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Query(query): Query<GcQuery>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if service_auth.service != ServiceKind::KnowledgeVideo {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }
    let grace = query.grace_seconds.clamp(3_600, 31_536_000);
    let cutoff = Utc::now() - Duration::seconds(grace);
    let records = knowledge_video::Entity::find().all(&state.db).await?;
    let linked_ids: HashSet<i32> = user_knowledge_video_link::Entity::find()
        .all(&state.db)
        .await?
        .into_iter()
        .map(|link| link.knowledge_video_id)
        .collect();
    let task_ids: HashSet<i32> = study_task::Entity::find()
        .filter(study_task::Column::KnowledgeVideoId.is_not_null())
        .all(&state.db)
        .await?
        .into_iter()
        .filter_map(|task| task.knowledge_video_id)
        .collect();

    let referenced_object_keys = records
        .iter()
        .filter_map(|record| record.object_key.clone())
        .collect();
    let candidates = records
        .into_iter()
        .filter(|record| {
            !linked_ids.contains(&record.id)
                && !task_ids.contains(&record.id)
                && record.created_at <= cutoff
                && matches!(
                    record.status,
                    knowledge_video::KnowledgeVideoStatus::Finished
                        | knowledge_video::KnowledgeVideoStatus::Failed
                )
        })
        .map(|record| GcCandidate {
            id: record.id,
            object_key: record.object_key,
            created_at: record.created_at.timestamp_millis(),
        })
        .collect();
    Ok(ok(GcSnapshot {
        referenced_object_keys,
        candidates,
    }))
}

async fn code_video_gc_candidates(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Query(query): Query<GcQuery>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if service_auth.service != ServiceKind::CodeVideo {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }
    let grace = query.grace_seconds.clamp(3_600, 31_536_000);
    let cutoff = Utc::now() - Duration::seconds(grace);
    let records = code_video::Entity::find().all(&state.db).await?;
    let linked_ids: HashSet<i32> = user_code_video_link::Entity::find()
        .all(&state.db)
        .await?
        .into_iter()
        .map(|link| link.code_video_id)
        .collect();
    let referenced_object_keys = records
        .iter()
        .filter_map(|record| record.object_key.clone())
        .collect();
    let candidates = records
        .into_iter()
        .filter(|record| {
            !linked_ids.contains(&record.id)
                && record.created_at <= cutoff
                && matches!(
                    record.status,
                    code_video::CodeVideoStatus::Finished | code_video::CodeVideoStatus::Failed
                )
        })
        .map(|record| GcCandidate {
            id: record.id,
            object_key: record.object_key,
            created_at: record.created_at.timestamp_millis(),
        })
        .collect();
    Ok(ok(GcSnapshot {
        referenced_object_keys,
        candidates,
    }))
}

async fn confirm_knowledge_video_gc(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Path(id): Path<i32>,
    Json(payload): Json<GcConfirmRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if service_auth.service != ServiceKind::KnowledgeVideo {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }
    let tx = state.db.begin().await?;
    let record = knowledge_video::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;
    let linked = user_knowledge_video_link::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .is_some();
    let task_linked = study_task::Entity::find()
        .filter(study_task::Column::KnowledgeVideoId.eq(id))
        .one(&tx)
        .await?
        .is_some();
    if linked
        || task_linked
        || record.object_key != payload.object_key
        || !matches!(
            record.status,
            knowledge_video::KnowledgeVideoStatus::Finished
                | knowledge_video::KnowledgeVideoStatus::Failed
        )
    {
        return Err(AppError::ValidationFailed);
    }
    knowledge_video::Entity::delete_by_id(id).exec(&tx).await?;
    tx.commit().await?;
    Ok(ok(serde_json::json!({"deleted": true})))
}

async fn confirm_code_video_gc(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Path(id): Path<i32>,
    Json(payload): Json<GcConfirmRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if service_auth.service != ServiceKind::CodeVideo {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }
    let tx = state.db.begin().await?;
    let record = code_video::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;
    let linked = user_code_video_link::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .is_some();
    if linked
        || record.object_key != payload.object_key
        || !matches!(
            record.status,
            code_video::CodeVideoStatus::Finished | code_video::CodeVideoStatus::Failed
        )
    {
        return Err(AppError::ValidationFailed);
    }
    code_video::Entity::delete_by_id(id).exec(&tx).await?;
    tx.commit().await?;
    Ok(ok(serde_json::json!({"deleted": true})))
}

// --- knowledge_video ---

async fn update_knowledge_video(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateStatusRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if service_auth.service != ServiceKind::KnowledgeVideo {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }

    let tx = state.db.begin().await?;
    let record = knowledge_video::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    let new_status = parse_knowledge_video_status(&payload.status)?;
    validate_knowledge_video_transition(record.status, new_status)?;

    let mut active: knowledge_video::ActiveModel = record.clone().into();
    active.status = Set(new_status);
    active.updated_at = Set(Utc::now());

    if new_status == knowledge_video::KnowledgeVideoStatus::Finished {
        active.object_key = Set(payload.object_key);
    }

    if new_status == knowledge_video::KnowledgeVideoStatus::Failed {
        if let Some(owner_id) = resolve_knowledge_video_owner(&tx, id).await? {
            let cost = state.config.knowledge_video_diamond_cost;
            let existing_user = user::Entity::find_by_id(owner_id)
                .one(&tx)
                .await?
                .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
            let new_diamond = existing_user.diamond + cost;
            let mut active_user: user::ActiveModel = existing_user.clone().into();
            active_user.diamond = Set(new_diamond);
            active_user.updated_at = Set(Utc::now());
            active_user.update(&tx).await?;
            asset_transaction::record(
                &tx,
                existing_user.id,
                DIAMOND,
                cost,
                new_diamond,
                "知识视频生成失败退款",
            )
            .await?;
        } else {
            tracing::warn!(
                resource_id = id,
                "knowledge_video FAILED with no owner (link or task) — skip refund"
            );
        }
    }

    active.update(&tx).await?;
    tx.commit().await?;

    Ok(ok(serde_json::json!({"id": id, "status": payload.status})))
}

fn parse_knowledge_video_status(
    s: &str,
) -> Result<knowledge_video::KnowledgeVideoStatus, AppError> {
    match s {
        "QUEUING" => Ok(knowledge_video::KnowledgeVideoStatus::Queuing),
        "GENERATING" => Ok(knowledge_video::KnowledgeVideoStatus::Generating),
        "FINISHED" => Ok(knowledge_video::KnowledgeVideoStatus::Finished),
        "FAILED" => Ok(knowledge_video::KnowledgeVideoStatus::Failed),
        _ => Err(AppError::business(BusinessError::InvalidContentStatus)),
    }
}

fn validate_knowledge_video_transition(
    from: knowledge_video::KnowledgeVideoStatus,
    to: knowledge_video::KnowledgeVideoStatus,
) -> Result<(), AppError> {
    use knowledge_video::KnowledgeVideoStatus::*;
    let valid = matches!(
        (from, to),
        (Queuing, Generating) | (Generating, Finished) | (Generating, Failed)
    );
    if !valid {
        return Err(AppError::business(BusinessError::InvalidContentStatus));
    }
    Ok(())
}

// --- code_video ---

async fn update_code_video(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateStatusRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if service_auth.service != ServiceKind::CodeVideo {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }

    let tx = state.db.begin().await?;
    let record = code_video::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    let new_status = parse_code_video_status(&payload.status)?;
    validate_code_video_transition(record.status, new_status)?;

    let mut active: code_video::ActiveModel = record.clone().into();
    active.status = Set(new_status);
    active.updated_at = Set(Utc::now());

    if new_status == code_video::CodeVideoStatus::Finished {
        active.object_key = Set(payload.object_key);
    }

    if new_status == code_video::CodeVideoStatus::Failed {
        if let Some(owner_id) = resolve_code_video_owner(&tx, id).await? {
            let cost = state.config.code_video_diamond_cost;
            let existing_user = user::Entity::find_by_id(owner_id)
                .one(&tx)
                .await?
                .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
            let new_diamond = existing_user.diamond + cost;
            let mut active_user: user::ActiveModel = existing_user.clone().into();
            active_user.diamond = Set(new_diamond);
            active_user.updated_at = Set(Utc::now());
            active_user.update(&tx).await?;
            asset_transaction::record(
                &tx,
                existing_user.id,
                DIAMOND,
                cost,
                new_diamond,
                "代码视频生成失败退款",
            )
            .await?;
        } else {
            tracing::warn!(
                resource_id = id,
                "code_video FAILED with no owner — skip refund"
            );
        }
    }

    active.update(&tx).await?;
    tx.commit().await?;

    Ok(ok(serde_json::json!({"id": id, "status": payload.status})))
}

fn parse_code_video_status(s: &str) -> Result<code_video::CodeVideoStatus, AppError> {
    match s {
        "QUEUING" => Ok(code_video::CodeVideoStatus::Queuing),
        "GENERATING" => Ok(code_video::CodeVideoStatus::Generating),
        "FINISHED" => Ok(code_video::CodeVideoStatus::Finished),
        "FAILED" => Ok(code_video::CodeVideoStatus::Failed),
        _ => Err(AppError::business(BusinessError::InvalidContentStatus)),
    }
}

fn validate_code_video_transition(
    from: code_video::CodeVideoStatus,
    to: code_video::CodeVideoStatus,
) -> Result<(), AppError> {
    use code_video::CodeVideoStatus::*;
    let valid = matches!(
        (from, to),
        (Queuing, Generating) | (Generating, Finished) | (Generating, Failed)
    );
    if !valid {
        return Err(AppError::business(BusinessError::InvalidContentStatus));
    }
    Ok(())
}

// --- interactive_html ---

async fn update_interactive_html(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateStatusRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if service_auth.service != ServiceKind::InteractiveHtml {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }

    let tx = state.db.begin().await?;
    let record = interactive_html::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    let new_status = parse_interactive_html_status(&payload.status)?;
    validate_interactive_html_transition(record.status, new_status)?;

    let mut active: interactive_html::ActiveModel = record.clone().into();
    active.status = Set(new_status);
    active.updated_at = Set(Utc::now());

    if new_status == interactive_html::InteractiveHtmlStatus::Finished {
        active.object_key = Set(payload.object_key);
    }

    if new_status == interactive_html::InteractiveHtmlStatus::Failed {
        if let Some(owner_id) = resolve_interactive_html_owner(&tx, id).await? {
            let cost = state.config.interactive_html_diamond_cost;
            let existing_user = user::Entity::find_by_id(owner_id)
                .one(&tx)
                .await?
                .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
            let new_diamond = existing_user.diamond + cost;
            let mut active_user: user::ActiveModel = existing_user.clone().into();
            active_user.diamond = Set(new_diamond);
            active_user.updated_at = Set(Utc::now());
            active_user.update(&tx).await?;
            asset_transaction::record(
                &tx,
                existing_user.id,
                DIAMOND,
                cost,
                new_diamond,
                "2D 交互生成失败退款",
            )
            .await?;
        } else {
            tracing::warn!(
                resource_id = id,
                "interactive_html FAILED with no owner — skip refund"
            );
        }
    }

    active.update(&tx).await?;
    tx.commit().await?;

    Ok(ok(serde_json::json!({"id": id, "status": payload.status})))
}

fn parse_interactive_html_status(
    s: &str,
) -> Result<interactive_html::InteractiveHtmlStatus, AppError> {
    match s {
        "QUEUING" => Ok(interactive_html::InteractiveHtmlStatus::Queuing),
        "GENERATING" => Ok(interactive_html::InteractiveHtmlStatus::Generating),
        "FINISHED" => Ok(interactive_html::InteractiveHtmlStatus::Finished),
        "FAILED" => Ok(interactive_html::InteractiveHtmlStatus::Failed),
        _ => Err(AppError::business(BusinessError::InvalidContentStatus)),
    }
}

fn validate_interactive_html_transition(
    from: interactive_html::InteractiveHtmlStatus,
    to: interactive_html::InteractiveHtmlStatus,
) -> Result<(), AppError> {
    use interactive_html::InteractiveHtmlStatus::*;
    let valid = matches!(
        (from, to),
        (Queuing, Generating) | (Generating, Finished) | (Generating, Failed)
    );
    if !valid {
        return Err(AppError::business(BusinessError::InvalidContentStatus));
    }
    Ok(())
}

// --- knowledge_explanation ---

async fn update_knowledge_explanation(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateStatusRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if service_auth.service != ServiceKind::KnowledgeExplanation {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }

    let tx = state.db.begin().await?;
    let record = knowledge_explanation::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    let new_status = parse_knowledge_explanation_status(&payload.status)?;
    validate_knowledge_explanation_transition(record.status, new_status)?;

    let mut active: knowledge_explanation::ActiveModel = record.clone().into();
    active.status = Set(new_status);
    active.updated_at = Set(Utc::now());

    if new_status == knowledge_explanation::KnowledgeExplanationStatus::Finished {
        active.content = Set(payload.content);
    }

    if new_status == knowledge_explanation::KnowledgeExplanationStatus::Failed {
        let existing_user = user::Entity::find_by_id(record.user_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
        let new_gold = existing_user.gold + record.cost;
        let mut active_user: user::ActiveModel = existing_user.clone().into();
        active_user.gold = Set(new_gold);
        active_user.updated_at = Set(Utc::now());
        active_user.update(&tx).await?;
        asset_transaction::record(
            &tx,
            existing_user.id,
            GOLD,
            record.cost,
            new_gold,
            "知识解析生成失败退款",
        )
        .await?;
    }

    active.update(&tx).await?;
    tx.commit().await?;

    Ok(ok(serde_json::json!({"id": id, "status": payload.status})))
}

fn parse_knowledge_explanation_status(
    s: &str,
) -> Result<knowledge_explanation::KnowledgeExplanationStatus, AppError> {
    match s {
        "QUEUING" => Ok(knowledge_explanation::KnowledgeExplanationStatus::Queuing),
        "GENERATING" => Ok(knowledge_explanation::KnowledgeExplanationStatus::Generating),
        "FINISHED" => Ok(knowledge_explanation::KnowledgeExplanationStatus::Finished),
        "FAILED" => Ok(knowledge_explanation::KnowledgeExplanationStatus::Failed),
        _ => Err(AppError::business(BusinessError::InvalidContentStatus)),
    }
}

fn validate_knowledge_explanation_transition(
    from: knowledge_explanation::KnowledgeExplanationStatus,
    to: knowledge_explanation::KnowledgeExplanationStatus,
) -> Result<(), AppError> {
    use knowledge_explanation::KnowledgeExplanationStatus::*;
    let valid = matches!(
        (from, to),
        (Queuing, Generating) | (Generating, Finished) | (Generating, Failed)
    );
    if !valid {
        return Err(AppError::business(BusinessError::InvalidContentStatus));
    }
    Ok(())
}

// --- study_subject callback ---

#[derive(Debug, Deserialize)]
struct CurriculumAcquisitionCallbackRequest {
    status: String,
    #[serde(default)]
    failure_code: Option<String>,
    #[serde(default)]
    curriculum: Option<curriculum::AcquiredCurriculum>,
    #[serde(default)]
    existing_template_id: Option<i32>,
}

async fn fail_curriculum_subject(
    state: &AppState,
    subject: &study_subject::Model,
    failure_code: &str,
    refund_reason: &str,
) -> Result<(), AppError> {
    let tx = state.db.begin().await?;
    let mut active: study_subject::ActiveModel = subject.clone().into();
    active.status = Set(StudySubjectStatus::Failed);
    active.failure_code = Set(Some(failure_code.to_owned()));
    active.updated_at = Set(Utc::now());
    active.update(&tx).await?;

    let existing_user = user::Entity::find_by_id(subject.user_id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
    let new_diamond = existing_user.diamond + subject.diamond_cost;
    let mut active_user: user::ActiveModel = existing_user.clone().into();
    active_user.diamond = Set(new_diamond);
    active_user.updated_at = Set(Utc::now());
    active_user.update(&tx).await?;
    asset_transaction::record(
        &tx,
        existing_user.id,
        DIAMOND,
        subject.diamond_cost,
        new_diamond,
        refund_reason,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn callback_curriculum_acquisition(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Path(id): Path<i32>,
    Json(payload): Json<CurriculumAcquisitionCallbackRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if service_auth.service != ServiceKind::Curriculum {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }

    let subject = study_subject::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;

    if payload.status == "GENERATING" {
        if subject.status != StudySubjectStatus::CurriculumQueuing {
            return Err(AppError::business(BusinessError::InvalidStudySubjectStatus));
        }
        let mut active: study_subject::ActiveModel = subject.into();
        active.status = Set(StudySubjectStatus::CurriculumFetching);
        active.updated_at = Set(Utc::now());
        active.update(&state.db).await?;
        return Ok(ok(serde_json::json!({"success": true})));
    }

    if !matches!(
        subject.status,
        StudySubjectStatus::CurriculumQueuing | StudySubjectStatus::CurriculumFetching
    ) {
        return Err(AppError::business(BusinessError::InvalidStudySubjectStatus));
    }

    if payload.status == "FAILED" {
        let code = payload
            .failure_code
            .unwrap_or_else(|| "CURRICULUM_ACQUISITION_FAILED".to_owned());
        fail_curriculum_subject(&state, &subject, &code, "课程大纲采集失败退款").await?;
        return Ok(ok(serde_json::json!({"success": true})));
    }

    if payload.status != "FINISHED" {
        return Err(AppError::business(BusinessError::InvalidContentStatus));
    }
    let template_id = if let Some(template_id) = payload.existing_template_id {
        let template = crate::entities::curriculum_template::Entity::find_by_id(template_id)
            .one(&state.db)
            .await?
            .filter(|template| {
                template.status
                    == crate::entities::curriculum_template::CurriculumTemplateStatus::Published
            })
            .ok_or_else(|| {
                AppError::internal("curriculum selector returned an unavailable template")
            })?;
        template.id
    } else {
        let curriculum_payload = payload
            .curriculum
            .ok_or_else(|| AppError::internal("curriculum FINISHED callback missing data"))?;
        if let Some(existing_id) =
            curriculum::published_template_id_by_hash(&state.db, &curriculum_payload.content_hash)
                .await?
        {
            existing_id
        } else {
            if let Err(code) = curriculum::validate_generated(&curriculum_payload) {
                fail_curriculum_subject(&state, &subject, code, "AI课程大纲生成失败退款").await?;
                return Ok(ok(serde_json::json!({"success": true})));
            }
            curriculum::persist_acquired(&state.db, &curriculum_payload).await?
        }
    };
    let authoritative_outline = curriculum::load_outline(&state.db, template_id).await?;
    let existing_user = user::Entity::find_by_id(subject.user_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
    let mut active: study_subject::ActiveModel = subject.clone().into();
    active.status = Set(StudySubjectStatus::PretestQueuing);
    active.curriculum_template_id = Set(Some(template_id));
    active.failure_code = Set(None);
    active.updated_at = Set(Utc::now());
    active.update(&state.db).await?;

    let request = PretestRequest {
        task_id: subject.id,
        prompt: subject.subject,
        total_stages: subject.total_stages,
        language: subject.language,
        target: subject.target,
        learner_profile: LearnerProfileSnapshot::from_user(&existing_user),
        authoritative_outline,
    };
    if dispatch_pretest(
        state.publisher.as_ref(),
        &state.config.pretest_exchange,
        &request,
    )
    .await
    .is_err()
    {
        let pinned_subject = study_subject::Entity::find_by_id(subject.id)
            .one(&state.db)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;
        fail_curriculum_subject(
            &state,
            &pinned_subject,
            "PRETEST_DISPATCH_FAILED",
            "课前测入队失败退款",
        )
        .await?;
        return Ok(ok(serde_json::json!({"success": false})));
    }
    Ok(ok(
        serde_json::json!({"success": true, "curriculum_template_id": template_id}),
    ))
}

#[derive(Debug, Deserialize)]
struct StudySubjectCallbackRequest {
    status: String,
    #[serde(default)]
    failure_code: Option<String>,
    #[serde(default)]
    problems: Option<Vec<CallbackProblem>>,
    #[serde(default)]
    stages: Option<Vec<CallbackStage>>,
}

#[derive(Debug, Deserialize)]
struct CallbackProblem {
    content: String,
    choice_a: String,
    choice_b: String,
    choice_c: String,
    choice_d: String,
    answer: String,
    explanation: String,
    #[serde(default)]
    knowledge_node_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CallbackStage {
    title: String,
    description: String,
    tasks: Vec<CallbackTask>,
}

#[derive(Debug, Deserialize)]
struct CallbackTask {
    title: String,
    description: String,
    #[serde(default)]
    knowledge_node_keys: Vec<String>,
}

async fn callback_study_subject(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Path(id): Path<i32>,
    Json(payload): Json<StudySubjectCallbackRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let is_pretest = service_auth.service == ServiceKind::Pretest;
    let is_plan = service_auth.service == ServiceKind::Plan;

    if !is_pretest && !is_plan {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }

    let tx = state.db.begin().await?;
    let subject = study_subject::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;

    let callback_status = payload.status.as_str();
    let current = subject.status;
    let now = Utc::now();

    // Determine the target status based on the 8x6 transition table
    let new_status = if is_pretest {
        match (current, callback_status) {
            (StudySubjectStatus::PretestQueuing, "GENERATING") => {
                StudySubjectStatus::PretestGenerating
            }
            (StudySubjectStatus::PretestQueuing, "FINISHED") => StudySubjectStatus::PretestReady,
            (StudySubjectStatus::PretestQueuing, "FAILED") => StudySubjectStatus::Failed,
            (StudySubjectStatus::PretestGenerating, "FINISHED") => StudySubjectStatus::PretestReady,
            (StudySubjectStatus::PretestGenerating, "FAILED") => StudySubjectStatus::Failed,
            _ => return Err(AppError::business(BusinessError::InvalidStudySubjectStatus)),
        }
    } else {
        // is_plan
        match (current, callback_status) {
            (StudySubjectStatus::PlanQueuing, "GENERATING") => StudySubjectStatus::PlanGenerating,
            (StudySubjectStatus::PlanQueuing, "FINISHED") => StudySubjectStatus::Studying,
            (StudySubjectStatus::PlanQueuing, "FAILED") => StudySubjectStatus::Failed,
            (StudySubjectStatus::PlanGenerating, "FINISHED") => StudySubjectStatus::Studying,
            (StudySubjectStatus::PlanGenerating, "FAILED") => StudySubjectStatus::Failed,
            _ => return Err(AppError::business(BusinessError::InvalidStudySubjectStatus)),
        }
    };

    let mut active: study_subject::ActiveModel = subject.clone().into();
    active.status = Set(new_status);
    active.updated_at = Set(now);

    // Handle FAILED → refund
    if new_status == StudySubjectStatus::Failed {
        active.failure_code = Set(Some(payload.failure_code.clone().unwrap_or_else(|| {
            if is_pretest {
                "PRETEST_GENERATION_FAILED".to_owned()
            } else {
                "PLAN_GENERATION_FAILED".to_owned()
            }
        })));
        let cost = subject.diamond_cost;
        let existing_user = user::Entity::find_by_id(subject.user_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
        let new_diamond = existing_user.diamond + cost;
        let mut active_user: user::ActiveModel = existing_user.clone().into();
        active_user.diamond = Set(new_diamond);
        active_user.updated_at = Set(now);
        active_user.update(&tx).await?;
        asset_transaction::record(
            &tx,
            existing_user.id,
            DIAMOND,
            cost,
            new_diamond,
            "学习计划生成失败退款",
        )
        .await?;
    }

    // Handle Pretest FINISHED → create problems
    if new_status == StudySubjectStatus::PretestReady {
        let problems = payload
            .problems
            .ok_or_else(|| AppError::internal("pretest FINISHED callback missing problems data"))?;

        let node_ids_by_key: std::collections::HashMap<String, i32> =
            if let Some(template_id) = subject.curriculum_template_id {
                curriculum_node::Entity::find()
                    .filter(curriculum_node::Column::CurriculumTemplateId.eq(template_id))
                    .all(&tx)
                    .await?
                    .into_iter()
                    .map(|node| (node.node_key, node.id))
                    .collect()
            } else {
                std::collections::HashMap::new()
            };

        for (i, p) in problems.into_iter().enumerate() {
            let answer = parse_problem_answer(&p.answer)?;
            let curriculum_node_id = p
                .knowledge_node_key
                .as_ref()
                .and_then(|key| node_ids_by_key.get(key).copied());
            if subject.curriculum_template_id.is_some() && curriculum_node_id.is_none() {
                return Err(AppError::internal(
                    "pretest referenced an unknown curriculum node",
                ));
            }
            pretest_problem::ActiveModel {
                study_subject_id: Set(subject.id),
                sort_order: Set(i as i32),
                content: Set(p.content),
                choice_a: Set(p.choice_a),
                choice_b: Set(p.choice_b),
                choice_c: Set(p.choice_c),
                choice_d: Set(p.choice_d),
                answer: Set(answer),
                explanation: Set(p.explanation),
                confidence: Set(None),
                chosen_answer: Set(None),
                curriculum_node_id: Set(curriculum_node_id),
                created_at: Set(now),
                ..Default::default()
            }
            .insert(&tx)
            .await?;
        }
    }

    // Handle Plan FINISHED → create stages and tasks + initialize unlock
    let mut explanations_to_dispatch: Vec<(i32, String)> = Vec::new();
    if new_status == StudySubjectStatus::Studying {
        let stages = payload
            .stages
            .ok_or_else(|| AppError::internal("plan FINISHED callback missing stages data"))?;
        if subject.curriculum_template_id.is_some()
            && (stages.len() != subject.total_stages as usize
                || stages
                    .iter()
                    .any(|stage| stage.tasks.len() != state.config.plan_tasks_per_stage as usize))
        {
            return Err(AppError::internal(
                "plan stage or task count does not match the requested shape",
            ));
        }

        let node_ids_by_key: std::collections::HashMap<String, i32> =
            if let Some(template_id) = subject.curriculum_template_id {
                curriculum_node::Entity::find()
                    .filter(curriculum_node::Column::CurriculumTemplateId.eq(template_id))
                    .all(&tx)
                    .await?
                    .into_iter()
                    .map(|node| (node.node_key, node.id))
                    .collect()
            } else {
                std::collections::HashMap::new()
            };

        for (si, s) in stages.into_iter().enumerate() {
            let is_first_stage = si == 0;
            let stage_status = if is_first_stage {
                StudyStageStatus::Studying
            } else {
                StudyStageStatus::Locked
            };

            let total_tasks = s.tasks.len() as i32;

            let stage_record = study_stage::ActiveModel {
                study_subject_id: Set(subject.id),
                title: Set(s.title),
                description: Set(s.description),
                sort_order: Set(si as i32),
                status: Set(stage_status),
                total_tasks: Set(total_tasks),
                finished_tasks: Set(0),
                created_at: Set(now),
                ..Default::default()
            }
            .insert(&tx)
            .await?;

            for (ti, t) in s.tasks.into_iter().enumerate() {
                let is_first_task = is_first_stage && ti == 0;
                let task_status = if is_first_task {
                    StudyTaskStatus::Studying
                } else {
                    StudyTaskStatus::Locked
                };

                let prompt = format!("{}\n\n{}", t.title, t.description);
                let knowledge_node_ids = t
                    .knowledge_node_keys
                    .iter()
                    .map(|key| {
                        node_ids_by_key.get(key).copied().ok_or_else(|| {
                            AppError::internal("plan referenced an unknown curriculum node")
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                if subject.curriculum_template_id.is_some() && knowledge_node_ids.is_empty() {
                    return Err(AppError::internal(
                        "plan task is missing curriculum node mapping",
                    ));
                }
                let ke_record = knowledge_explanation::ActiveModel {
                    user_id: Set(subject.user_id),
                    status: Set(knowledge_explanation::KnowledgeExplanationStatus::Queuing),
                    prompt: Set(prompt.clone()),
                    content: Set(None),
                    public: Set(false),
                    cost: Set(0),
                    created_at: Set(now),
                    updated_at: Set(now),
                    ..Default::default()
                }
                .insert(&tx)
                .await?;
                explanations_to_dispatch.push((ke_record.id, prompt));

                let task_record = study_task::ActiveModel {
                    study_stage_id: Set(stage_record.id),
                    title: Set(t.title),
                    description: Set(t.description),
                    sort_order: Set(ti as i32),
                    status: Set(task_status),
                    knowledge_video_id: Set(None),
                    interactive_html_id: Set(None),
                    knowledge_explanation_id: Set(Some(ke_record.id)),
                    created_at: Set(now),
                    updated_at: Set(now),
                    ..Default::default()
                }
                .insert(&tx)
                .await?;
                for curriculum_node_id in knowledge_node_ids {
                    study_task_curriculum_node::ActiveModel {
                        study_task_id: Set(task_record.id),
                        curriculum_node_id: Set(curriculum_node_id),
                        ..Default::default()
                    }
                    .insert(&tx)
                    .await?;
                }
            }
        }
    }

    active.update(&tx).await?;
    tx.commit().await?;

    // Dispatch explanation generation outside the transaction.
    // Failures here mark the individual record as FAILED; the plan callback
    // itself still succeeds because the rest of the subject state is committed.
    for (ke_id, prompt) in explanations_to_dispatch {
        let request = crate::services::content::GenerateRequest {
            task_id: ke_id,
            prompt,
        };
        if let Err(err) = crate::services::content::dispatch_to_service(
            state.publisher.as_ref(),
            &state.config.knowledge_explanation_exchange,
            &request,
        )
        .await
        {
            tracing::error!(
                error = %err,
                ke_id,
                "failed to dispatch knowledge_explanation; marking FAILED"
            );
            let tx = state.db.begin().await?;
            if let Some(record) = knowledge_explanation::Entity::find_by_id(ke_id)
                .one(&tx)
                .await?
            {
                let mut active: knowledge_explanation::ActiveModel = record.into();
                active.status = Set(knowledge_explanation::KnowledgeExplanationStatus::Failed);
                active.updated_at = Set(Utc::now());
                active.update(&tx).await?;
            }
            tx.commit().await?;
        }
    }

    Ok(ok(
        serde_json::json!({"id": id, "status": format!("{:?}", new_status)}),
    ))
}

fn parse_problem_answer(s: &str) -> Result<ProblemAnswer, AppError> {
    match s {
        "A" => Ok(ProblemAnswer::A),
        "B" => Ok(ProblemAnswer::B),
        "C" => Ok(ProblemAnswer::C),
        "D" => Ok(ProblemAnswer::D),
        _ => Err(AppError::internal(format!("invalid problem answer: {s}"))),
    }
}

// --- study_quiz callback ---

#[derive(Debug, Deserialize)]
struct StudyQuizCallbackRequest {
    status: String,
    #[serde(default)]
    problems: Option<Vec<CallbackProblem>>,
}

async fn callback_study_quiz(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Path(id): Path<i32>,
    Json(payload): Json<StudyQuizCallbackRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if service_auth.service != ServiceKind::Quiz {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }

    let tx = state.db.begin().await?;
    let quiz = study_quiz::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::QuizNotFound))?;

    let callback_status = payload.status.as_str();
    let now = Utc::now();

    let new_status = match (quiz.status, callback_status) {
        (StudyQuizStatus::Queuing, "GENERATING") => StudyQuizStatus::Generating,
        (StudyQuizStatus::Queuing, "FINISHED") => StudyQuizStatus::Ready,
        (StudyQuizStatus::Queuing, "FAILED") => StudyQuizStatus::Failed,
        (StudyQuizStatus::Generating, "FINISHED") => StudyQuizStatus::Ready,
        (StudyQuizStatus::Generating, "FAILED") => StudyQuizStatus::Failed,
        _ => return Err(AppError::business(BusinessError::InvalidStudyQuizStatus)),
    };

    let mut active: study_quiz::ActiveModel = quiz.clone().into();
    active.status = Set(new_status);
    active.updated_at = Set(now);

    // Handle FAILED → refund cost gold
    if new_status == StudyQuizStatus::Failed && quiz.cost > 0 {
        // Find the user through the join chain
        let task = study_task::Entity::find_by_id(quiz.study_task_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;
        let stage = study_stage::Entity::find_by_id(task.study_stage_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::StageNotFound))?;
        let subject = study_subject::Entity::find_by_id(stage.study_subject_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;

        let existing_user = user::Entity::find_by_id(subject.user_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
        let new_gold = existing_user.gold + quiz.cost;
        let mut active_user: user::ActiveModel = existing_user.clone().into();
        active_user.gold = Set(new_gold);
        active_user.updated_at = Set(now);
        active_user.update(&tx).await?;
        asset_transaction::record(
            &tx,
            existing_user.id,
            GOLD,
            quiz.cost,
            new_gold,
            "知识点测验生成失败退款",
        )
        .await?;
    }

    // Handle FINISHED → create problems
    if new_status == StudyQuizStatus::Ready {
        let problems = payload
            .problems
            .ok_or_else(|| AppError::internal("quiz FINISHED callback missing problems data"))?;

        let total = problems.len() as i32;
        active.total_problems = Set(total);

        for (i, p) in problems.into_iter().enumerate() {
            let answer = parse_problem_answer(&p.answer)?;
            study_quiz_problem::ActiveModel {
                study_quiz_id: Set(quiz.id),
                sort_order: Set(i as i32),
                content: Set(p.content),
                choice_a: Set(p.choice_a),
                choice_b: Set(p.choice_b),
                choice_c: Set(p.choice_c),
                choice_d: Set(p.choice_d),
                answer: Set(answer),
                explanation: Set(p.explanation),
                chosen_answer: Set(None),
                bookmarked: Set(false),
                bookmarked_at: Set(None),
                mistake_hidden: Set(false),
                created_at: Set(now),
                ..Default::default()
            }
            .insert(&tx)
            .await?;
        }
    }

    active.update(&tx).await?;
    tx.commit().await?;

    Ok(ok(
        serde_json::json!({"id": id, "status": format!("{:?}", new_status)}),
    ))
}

// --- recharge ---

#[derive(Debug, Deserialize)]
struct RechargeRequest {
    gold: Option<i32>,
    diamond: Option<i32>,
}

async fn recharge_balance(
    State(state): State<AppState>,
    service_auth: ServiceAuth,
    Path(id): Path<i32>,
    Json(payload): Json<RechargeRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if service_auth.service != ServiceKind::Recharge {
        return Err(AppError::business(BusinessError::InvalidApiKey));
    }

    if payload.gold.is_none() && payload.diamond.is_none() {
        return Err(AppError::ValidationFailed);
    }

    let tx = state.db.begin().await?;

    let existing = user::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

    let new_gold = existing.gold + payload.gold.unwrap_or(0);
    let new_diamond = existing.diamond + payload.diamond.unwrap_or(0);

    if new_gold < 0 {
        return Err(AppError::business(BusinessError::InsufficientGold));
    }
    if new_diamond < 0 {
        return Err(AppError::business(BusinessError::InsufficientDiamonds));
    }

    let gold_delta = payload.gold.unwrap_or(0);
    let diamond_delta = payload.diamond.unwrap_or(0);
    let mut active: user::ActiveModel = existing.clone().into();
    active.gold = Set(new_gold);
    active.diamond = Set(new_diamond);
    active.updated_at = Set(Utc::now());
    active.update(&tx).await?;
    asset_transaction::record(&tx, existing.id, GOLD, gold_delta, new_gold, "系统调整").await?;
    asset_transaction::record(
        &tx,
        existing.id,
        DIAMOND,
        diamond_delta,
        new_diamond,
        "系统调整",
    )
    .await?;

    tx.commit().await?;

    Ok(ok(serde_json::json!({
        "id": id,
        "gold": new_gold,
        "diamond": new_diamond,
    })))
}
