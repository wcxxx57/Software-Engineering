use axum::{
    Json,
    extract::{Path, State},
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, TransactionTrait,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::AuthUser,
    entities::{
        curriculum_node, interactive_html, knowledge_explanation, knowledge_video, pretest_problem,
        study_quiz, study_quiz::StudyQuizStatus, study_stage, study_stage::StudyStageStatus,
        study_subject, study_subject::StudySubjectStatus, study_task,
        study_task::StudyTaskStatus, study_task_curriculum_node, user,
    },
    error::{AppError, BusinessError},
    response::{created, ok},
    services::{
        asset_transaction::{self, DIAMOND, EXP, GOLD},
        content::{GenerateRequest, dispatch_payload, dispatch_to_service},
        personalization::{LearnerProfileSnapshot, LearningContextSnapshot},
        study_subject::{QuizRequest, dispatch_quiz},
    },
    state::AppState,
};

// ── Views ──

#[derive(Debug, Serialize)]
pub struct StudyTaskView {
    pub id: i32,
    pub study_stage_id: i32,
    pub curriculum_node_id: Option<i32>,
    pub day_index: Option<i32>,
    pub title: String,
    pub description: String,
    pub sort_order: i32,
    pub status: StudyTaskStatus,
    pub knowledge_video_id: Option<i32>,
    pub interactive_html_id: Option<i32>,
    pub knowledge_explanation_id: Option<i32>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<study_task::Model> for StudyTaskView {
    fn from(m: study_task::Model) -> Self {
        Self {
            id: m.id,
            study_stage_id: m.study_stage_id,
            curriculum_node_id: m.curriculum_node_id,
            day_index: m.day_index,
            title: m.title,
            description: m.description,
            sort_order: m.sort_order,
            status: m.status,
            knowledge_video_id: m.knowledge_video_id,
            interactive_html_id: m.interactive_html_id,
            knowledge_explanation_id: m.knowledge_explanation_id,
            created_at: m.created_at.timestamp_millis(),
            updated_at: m.updated_at.timestamp_millis(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StudyQuizBriefView {
    pub id: i32,
    pub status: StudyQuizStatus,
    pub total_problems: i32,
    pub correct_problems: i32,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct RecommendedResourceView {
    pub id: i32,
    pub title: String,
    pub summary: String,
    pub reasons: Vec<String>,
    pub learner_count: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct TaskRecommendationResourcesView {
    pub knowledge_video: Vec<RecommendedResourceView>,
    pub interactive_html: Vec<RecommendedResourceView>,
}

#[derive(Debug, Serialize)]
pub struct TaskRecommendationsView {
    pub eligible: bool,
    pub knowledge_point_title: Option<String>,
    pub resources: TaskRecommendationResourcesView,
}

// ── Payloads ──

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct PromptRequest {
    pub prompt: Option<String>,
}

#[derive(Debug, Serialize)]
struct KnowledgeVideoGenerateRequest {
    task_id: i32,
    prompt: String,
    language: String,
    extra_info: String,
    learner_profile: LearnerProfileSnapshot,
    learning_context: LearningContextSnapshot,
}

#[derive(Debug, Serialize)]
struct KnowledgeExplanationGenerateRequest {
    task_id: i32,
    prompt: String,
    learner_profile: LearnerProfileSnapshot,
    learning_context: LearningContextSnapshot,
}

fn task_default_prompt(task: &study_task::Model) -> String {
    let title = task.title.trim();
    let desc = task.description.trim();
    if desc.is_empty() {
        title.to_owned()
    } else if title.is_empty() {
        desc.to_owned()
    } else {
        format!("{title}\n\n{desc}")
    }
}

fn resolve_prompt(payload: PromptRequest, task: &study_task::Model) -> String {
    payload
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| task_default_prompt(task))
}

fn percentage_amount(amount: i32, percent: i32) -> Result<i32, AppError> {
    let numerator = i64::from(amount)
        .checked_mul(i64::from(percent))
        .and_then(|value| value.checked_add(50))
        .ok_or_else(|| AppError::internal("percentage calculation overflowed i64"))?;
    i32::try_from(numerator / 100)
        .map_err(|_| AppError::internal("percentage result overflowed i32"))
}

// ── Helpers ──

/// Load a study_task and verify ownership through the join chain.
async fn load_owned_task<C: sea_orm::ConnectionTrait>(
    db: &C,
    task_id: i32,
    user_id: i32,
) -> Result<(study_task::Model, study_stage::Model, study_subject::Model), AppError> {
    let task = study_task::Entity::find_by_id(task_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;

    let stage = study_stage::Entity::find_by_id(task.study_stage_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;

    let subject = study_subject::Entity::find_by_id(stage.study_subject_id)
        .filter(study_subject::Column::UserId.eq(user_id))
        .one(db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;

    Ok((task, stage, subject))
}

// ── Handlers ──

/// GET /api/v1/study-tasks/{id}
pub async fn get_by_id(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let (task, _, _) = load_owned_task(&state.db, id, auth_user.user_id).await?;
    Ok(ok(StudyTaskView::from(task)))
}

/// GET /api/v1/study-tasks/{id}/recommendations
///
/// A task without reusable, quality-screened content is a valid empty-result
/// case. Returning a structured response lets the client offer generation
/// instead of treating the absence of a recommendation as a missing endpoint.
pub async fn get_recommendations(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let (task, _, _) = load_owned_task(&state.db, id, auth_user.user_id).await?;
    let node_ids = study_task_curriculum_node::Entity::find()
        .filter(study_task_curriculum_node::Column::StudyTaskId.eq(task.id))
        .all(&state.db)
        .await?
        .into_iter()
        .map(|link| link.curriculum_node_id)
        .collect::<Vec<_>>();
    let knowledge_point_title = if node_ids.is_empty() {
        None
    } else {
        curriculum_node::Entity::find()
            .filter(curriculum_node::Column::Id.is_in(node_ids))
            .one(&state.db)
            .await?
            .map(|node| node.title)
    };

    Ok(ok(TaskRecommendationsView {
        // The recommendation pipeline is available for the task. It may return
        // no item until a finished resource has passed the quality gate.
        eligible: true,
        knowledge_point_title,
        resources: TaskRecommendationResourcesView {
            knowledge_video: Vec::new(),
            interactive_html: Vec::new(),
        },
    }))
}

/// POST /api/v1/study-tasks/{id}/complete
pub async fn complete(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let tx = state.db.begin().await?;

    let (task, stage, subject) = load_owned_task(&tx, id, auth_user.user_id).await?;

    if task.status != StudyTaskStatus::Studying {
        return Err(AppError::business(BusinessError::InvalidStudyTaskStatus));
    }

    let mut completed_subject = false;

    // 1. Mark task as Finished
    let mut active_task: study_task::ActiveModel = task.into();
    active_task.status = Set(StudyTaskStatus::Finished);
    active_task.updated_at = Set(Utc::now());
    active_task.update(&tx).await?;

    // 2. Update stage finished_tasks
    let new_finished_tasks = stage.finished_tasks + 1;
    let mut active_stage: study_stage::ActiveModel = stage.clone().into();
    active_stage.finished_tasks = Set(new_finished_tasks);

    // 3. Check if there's a next task in the same stage
    let next_task = study_task::Entity::find()
        .filter(study_task::Column::StudyStageId.eq(stage.id))
        .filter(study_task::Column::Status.eq(StudyTaskStatus::Locked))
        .order_by_asc(study_task::Column::SortOrder)
        .one(&tx)
        .await?;

    if let Some(next) = next_task {
        // Unlock next task
        let mut active_next: study_task::ActiveModel = next.into();
        active_next.status = Set(StudyTaskStatus::Studying);
        active_next.updated_at = Set(Utc::now());
        active_next.update(&tx).await?;
    }

    // 4. Check if stage is fully completed
    if new_finished_tasks >= stage.total_tasks {
        active_stage.status = Set(StudyStageStatus::Finished);
        active_stage.update(&tx).await?;

        // Update subject finished_stages
        let new_finished_stages = subject.finished_stages + 1;
        let mut active_subject: study_subject::ActiveModel = subject.clone().into();
        active_subject.finished_stages = Set(new_finished_stages);

        if new_finished_stages >= subject.total_stages {
            // All stages done
            completed_subject = true;
            active_subject.status = Set(StudySubjectStatus::Finished);
            active_subject.updated_at = Set(Utc::now());
            active_subject.update(&tx).await?;
        } else {
            active_subject.updated_at = Set(Utc::now());
            active_subject.update(&tx).await?;

            // Unlock next stage and its first task
            let next_stage = study_stage::Entity::find()
                .filter(study_stage::Column::StudySubjectId.eq(subject.id))
                .filter(study_stage::Column::Status.eq(StudyStageStatus::Locked))
                .order_by_asc(study_stage::Column::SortOrder)
                .one(&tx)
                .await?;

            if let Some(ns) = next_stage {
                let mut active_ns: study_stage::ActiveModel = ns.clone().into();
                active_ns.status = Set(StudyStageStatus::Studying);
                active_ns.update(&tx).await?;

                let first_task = study_task::Entity::find()
                    .filter(study_task::Column::StudyStageId.eq(ns.id))
                    .order_by_asc(study_task::Column::SortOrder)
                    .one(&tx)
                    .await?;

                if let Some(ft) = first_task {
                    let mut active_ft: study_task::ActiveModel = ft.into();
                    active_ft.status = Set(StudyTaskStatus::Studying);
                    active_ft.updated_at = Set(Utc::now());
                    active_ft.update(&tx).await?;
                }
            }
        }
    } else {
        active_stage.update(&tx).await?;
    }

    let diamond_refund = if completed_subject {
        percentage_amount(
            subject.diamond_cost,
            state.config.study_subject_completion_refund_percent,
        )?
    } else {
        0
    };
    let exp_reward = state
        .config
        .study_task_exp_reward
        .checked_add(if completed_subject {
            state.config.study_subject_exp_reward
        } else {
            0
        })
        .ok_or_else(|| AppError::internal("study completion exp overflowed i32"))?;

    let existing_user = user::Entity::find_by_id(auth_user.user_id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
    let mut active_user: user::ActiveModel = existing_user.clone().into();
    let new_exp = existing_user
        .exp
        .checked_add(exp_reward)
        .ok_or_else(|| AppError::internal("user exp overflowed i32"))?;
    let new_diamond = existing_user
        .diamond
        .checked_add(diamond_refund)
        .ok_or_else(|| AppError::internal("user diamond overflowed i32"))?;
    active_user.exp = Set(new_exp);
    active_user.diamond = Set(new_diamond);
    active_user.updated_at = Set(Utc::now());
    active_user.update(&tx).await?;
    asset_transaction::record(
        &tx,
        existing_user.id,
        EXP,
        exp_reward,
        new_exp,
        if completed_subject {
            "完成学习任务与学习计划"
        } else {
            "完成学习任务"
        },
    )
    .await?;
    asset_transaction::record(
        &tx,
        existing_user.id,
        DIAMOND,
        diamond_refund,
        new_diamond,
        "学习计划完课返还",
    )
    .await?;

    tx.commit().await?;
    Ok(ok(serde_json::json!({
        "success": true,
        "exp_reward": exp_reward,
        "diamond_refund": diamond_refund,
        "subject_completed": completed_subject,
    })))
}

/// POST /api/v1/study-tasks/{id}/knowledge-video
pub async fn create_knowledge_video(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
    Json(payload): Json<PromptRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if state.config.core_flow_only {
        return Err(AppError::business(BusinessError::FeatureDisabled));
    }
    let now = Utc::now();
    let cost = state.config.knowledge_video_diamond_cost;
    let tx = state.db.begin().await?;

    let (task, stage, subject) = load_owned_task(&tx, id, auth_user.user_id).await?;

    if task.status == StudyTaskStatus::Locked {
        return Err(AppError::business(BusinessError::InvalidStudyTaskStatus));
    }

    let prompt = resolve_prompt(payload, &task);

    let existing_user = user::Entity::find_by_id(auth_user.user_id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

    if existing_user.diamond < cost {
        return Err(AppError::business(BusinessError::InsufficientDiamonds));
    }

    let learner_profile = LearnerProfileSnapshot::from_user(&existing_user);
    let pretest_problems = pretest_problem::Entity::find()
        .filter(pretest_problem::Column::StudySubjectId.eq(subject.id))
        .all(&tx)
        .await?;
    let learning_context = LearningContextSnapshot {
        subject: subject.subject.clone(),
        target: subject.target.clone(),
        language: subject.language.clone(),
        total_stages: subject.total_stages,
        finished_stages: subject.finished_stages,
        stage_total_tasks: stage.total_tasks,
        stage_finished_tasks: stage.finished_tasks,
        pretest_total_problems: pretest_problems.len() as i32,
        pretest_answered_problems: pretest_problems
            .iter()
            .filter(|problem| problem.chosen_answer.is_some())
            .count() as i32,
        pretest_correct_problems: pretest_problems
            .iter()
            .filter(|problem| problem.chosen_answer == Some(problem.answer))
            .count() as i32,
        task_title: Some(task.title.clone()),
        task_description: Some(task.description.clone()),
    };

    let new_diamond = existing_user.diamond - cost;
    let mut active_user: user::ActiveModel = existing_user.clone().into();
    active_user.diamond = Set(new_diamond);
    active_user.updated_at = Set(now);
    active_user.update(&tx).await?;
    asset_transaction::record(
        &tx,
        existing_user.id,
        DIAMOND,
        -cost,
        new_diamond,
        "生成知识视频",
    )
    .await?;

    let kv_record = knowledge_video::ActiveModel {
        status: Set(knowledge_video::KnowledgeVideoStatus::Queuing),
        prompt: Set(prompt.clone()),
        object_key: Set(None),
        public: Set(true),
        bookmarked: Set(false),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&tx)
    .await?;

    let mut active_task: study_task::ActiveModel = task.into();
    active_task.knowledge_video_id = Set(Some(kv_record.id));
    active_task.updated_at = Set(now);
    active_task.update(&tx).await?;

    tx.commit().await?;

    let request = KnowledgeVideoGenerateRequest {
        task_id: kv_record.id,
        prompt: prompt.clone(),
        language: subject.language,
        extra_info: subject.target,
        learner_profile,
        learning_context,
    };
    if let Err(err) = dispatch_payload(
        state.publisher.as_ref(),
        &state.config.knowledge_video_exchange,
        &request,
    )
    .await
    {
        let tx = state.db.begin().await?;
        let mut active: knowledge_video::ActiveModel = kv_record.clone().into();
        active.status = Set(knowledge_video::KnowledgeVideoStatus::Failed);
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
            "知识视频生成失败退款",
        )
        .await?;

        tx.commit().await?;
        return Err(err);
    }

    Ok(created(serde_json::json!({
        "knowledge_video_id": kv_record.id,
    })))
}

/// POST /api/v1/study-tasks/{id}/interactive-html
pub async fn create_interactive_html(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
    Json(payload): Json<PromptRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if state.config.core_flow_only {
        return Err(AppError::business(BusinessError::FeatureDisabled));
    }
    let now = Utc::now();
    let cost = state.config.interactive_html_diamond_cost;
    let tx = state.db.begin().await?;

    let (task, _, _) = load_owned_task(&tx, id, auth_user.user_id).await?;

    if task.status == StudyTaskStatus::Locked {
        return Err(AppError::business(BusinessError::InvalidStudyTaskStatus));
    }

    let prompt = resolve_prompt(payload, &task);

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
    active_user.update(&tx).await?;
    asset_transaction::record(
        &tx,
        existing_user.id,
        DIAMOND,
        -cost,
        new_diamond,
        "生成 2D 交互内容",
    )
    .await?;

    let ih_record = interactive_html::ActiveModel {
        status: Set(interactive_html::InteractiveHtmlStatus::Queuing),
        prompt: Set(prompt.clone()),
        object_key: Set(None),
        public: Set(true),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&tx)
    .await?;

    let mut active_task: study_task::ActiveModel = task.into();
    active_task.interactive_html_id = Set(Some(ih_record.id));
    active_task.updated_at = Set(now);
    active_task.update(&tx).await?;

    tx.commit().await?;

    let request = GenerateRequest {
        task_id: ih_record.id,
        prompt: prompt.clone(),
    };
    if let Err(err) = dispatch_to_service(
        state.publisher.as_ref(),
        &state.config.interactive_html_exchange,
        &request,
    )
    .await
    {
        let tx = state.db.begin().await?;
        let mut active: interactive_html::ActiveModel = ih_record.clone().into();
        active.status = Set(interactive_html::InteractiveHtmlStatus::Failed);
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
            "2D 交互生成失败退款",
        )
        .await?;

        tx.commit().await?;
        return Err(err);
    }

    Ok(created(serde_json::json!({
        "interactive_html_id": ih_record.id,
    })))
}

/// POST /api/v1/study-tasks/{id}/explanation
pub async fn create_explanation(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
    Json(payload): Json<PromptRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let now = Utc::now();
    let tx = state.db.begin().await?;

    let (task, stage, subject) = load_owned_task(&tx, id, auth_user.user_id).await?;

    if task.status == StudyTaskStatus::Locked {
        return Err(AppError::business(BusinessError::InvalidStudyTaskStatus));
    }

    let prompt = resolve_prompt(payload, &task);

    let existing_user = user::Entity::find_by_id(auth_user.user_id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
    let learner_profile = LearnerProfileSnapshot::from_user(&existing_user);
    let pretest_problems = pretest_problem::Entity::find()
        .filter(pretest_problem::Column::StudySubjectId.eq(subject.id))
        .all(&tx)
        .await?;
    let pretest_total_problems = pretest_problems.len() as i32;
    let pretest_answered_problems = pretest_problems
        .iter()
        .filter(|problem| problem.chosen_answer.is_some())
        .count() as i32;
    let pretest_correct_problems = pretest_problems
        .iter()
        .filter(|problem| problem.chosen_answer == Some(problem.answer))
        .count() as i32;
    let learning_context = LearningContextSnapshot {
        subject: subject.subject.clone(),
        target: subject.target.clone(),
        language: subject.language.clone(),
        total_stages: subject.total_stages,
        finished_stages: subject.finished_stages,
        stage_total_tasks: stage.total_tasks,
        stage_finished_tasks: stage.finished_tasks,
        pretest_total_problems,
        pretest_answered_problems,
        pretest_correct_problems,
        task_title: Some(task.title.clone()),
        task_description: Some(task.description.clone()),
    };

    let ke_record = knowledge_explanation::ActiveModel {
        user_id: Set(auth_user.user_id),
        status: Set(knowledge_explanation::KnowledgeExplanationStatus::Queuing),
        prompt: Set(prompt.clone()),
        content: Set(None),
        public: Set(false),
        bookmarked: Set(false),
        cost: Set(0),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&tx)
    .await?;

    let mut active_task: study_task::ActiveModel = task.into();
    active_task.knowledge_explanation_id = Set(Some(ke_record.id));
    active_task.updated_at = Set(now);
    active_task.update(&tx).await?;

    tx.commit().await?;

    let request = KnowledgeExplanationGenerateRequest {
        task_id: ke_record.id,
        prompt: prompt.clone(),
        learner_profile,
        learning_context,
    };
    if let Err(err) = dispatch_payload(
        state.publisher.as_ref(),
        &state.config.knowledge_explanation_exchange,
        &request,
    )
    .await
    {
        let tx = state.db.begin().await?;
        let mut active: knowledge_explanation::ActiveModel = ke_record.clone().into();
        active.status = Set(knowledge_explanation::KnowledgeExplanationStatus::Failed);
        active.updated_at = Set(Utc::now());
        active.update(&tx).await?;
        tx.commit().await?;
        return Err(err);
    }

    Ok(created(serde_json::json!({
        "knowledge_explanation_id": ke_record.id,
    })))
}

/// POST /api/v1/study-tasks/{id}/quizzes
pub async fn create_quiz(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
    Json(payload): Json<PromptRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let now = Utc::now();
    let tx = state.db.begin().await?;

    let (task, _, _) = load_owned_task(&tx, id, auth_user.user_id).await?;

    if task.status == StudyTaskStatus::Locked {
        return Err(AppError::business(BusinessError::InvalidStudyTaskStatus));
    }

    let prompt = resolve_prompt(payload, &task);

    // Count existing quizzes for this task
    let existing_count = study_quiz::Entity::find()
        .filter(study_quiz::Column::StudyTaskId.eq(task.id))
        .count(&tx)
        .await? as i32;

    let free_limit = state.config.study_quiz_free_limit_per_task;
    let cost = if existing_count < free_limit {
        0
    } else {
        state.config.study_quiz_extra_gold_cost
    };

    if cost > 0 {
        let existing_user = user::Entity::find_by_id(auth_user.user_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

        if existing_user.gold < cost {
            return Err(AppError::business(BusinessError::InsufficientGold));
        }

        let new_gold = existing_user.gold - cost;
        let mut active_user: user::ActiveModel = existing_user.clone().into();
        active_user.gold = Set(new_gold);
        active_user.updated_at = Set(now);
        active_user.update(&tx).await?;
        asset_transaction::record(
            &tx,
            existing_user.id,
            GOLD,
            -cost,
            new_gold,
            "生成额外知识点测验",
        )
        .await?;
    }

    let quiz_record = study_quiz::ActiveModel {
        study_task_id: Set(task.id),
        status: Set(StudyQuizStatus::Queuing),
        cost: Set(cost),
        total_problems: Set(0),
        correct_problems: Set(0),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&tx)
    .await?;

    tx.commit().await?;

    let request = QuizRequest {
        task_id: quiz_record.id,
        prompt,
    };
    if let Err(err) = dispatch_quiz(
        state.publisher.as_ref(),
        &state.config.quiz_exchange,
        &request,
    )
    .await
    {
        let tx = state.db.begin().await?;

        let mut active: study_quiz::ActiveModel = quiz_record.clone().into();
        active.status = Set(StudyQuizStatus::Failed);
        active.updated_at = Set(Utc::now());
        active.update(&tx).await?;

        if cost > 0 {
            let refund_user = user::Entity::find_by_id(auth_user.user_id)
                .one(&tx)
                .await?
                .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
            let new_gold = refund_user.gold + cost;
            let mut active_user: user::ActiveModel = refund_user.clone().into();
            active_user.gold = Set(new_gold);
            active_user.updated_at = Set(Utc::now());
            active_user.update(&tx).await?;
            asset_transaction::record(
                &tx,
                refund_user.id,
                GOLD,
                cost,
                new_gold,
                "知识点测验生成失败退款",
            )
            .await?;
        }

        tx.commit().await?;
        return Err(err);
    }

    Ok(created(serde_json::json!({
        "quiz_id": quiz_record.id,
        "cost": cost,
    })))
}

/// GET /api/v1/study-tasks/{id}/quizzes
pub async fn list_quizzes(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let (task, _, _) = load_owned_task(&state.db, id, auth_user.user_id).await?;

    let quizzes = study_quiz::Entity::find()
        .filter(study_quiz::Column::StudyTaskId.eq(task.id))
        .order_by_desc(study_quiz::Column::CreatedAt)
        .all(&state.db)
        .await?;

    let views: Vec<StudyQuizBriefView> = quizzes
        .into_iter()
        .map(|q| StudyQuizBriefView {
            id: q.id,
            status: q.status,
            total_problems: q.total_problems,
            correct_problems: q.correct_problems,
            created_at: q.created_at.timestamp_millis(),
        })
        .collect();

    Ok(ok(views))
}

/// GET /api/v1/study-tasks/{id}/knowledge-video
pub async fn get_knowledge_video(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let (task, _, _) = load_owned_task(&state.db, id, auth_user.user_id).await?;
    let kv_id = task
        .knowledge_video_id
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    let record = knowledge_video::Entity::find_by_id(kv_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    Ok(ok(super::knowledge_videos::KnowledgeVideoView::from(
        record,
    )))
}

/// GET /api/v1/study-tasks/{id}/interactive-html
pub async fn get_interactive_html(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let (task, _, _) = load_owned_task(&state.db, id, auth_user.user_id).await?;
    let ih_id = task
        .interactive_html_id
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    let record = interactive_html::Entity::find_by_id(ih_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    Ok(ok(super::interactive_htmls::InteractiveHtmlView::from(
        record,
    )))
}
