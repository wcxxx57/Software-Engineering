use axum::{extract::State, response::IntoResponse};
use chrono::Datelike;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::Serialize;
use std::collections::HashMap;

use crate::{
    auth::AuthUser,
    entities::{
        curriculum_node, study_quiz, study_quiz_problem, study_stage, study_subject, study_task,
        user,
    },
    error::{AppError, BusinessError},
    response::ok,
    state::AppState,
};

#[derive(Debug, Serialize)]
pub struct LearningProfileView {
    pub user_id: i32,
    pub username: String,
    pub age_band: Option<String>,
    pub introduction: String,
    pub level: i32,
    pub experience_points: i32,
    pub total_checkins: i32,
    pub streak_checkins: i32,
    pub active_subject: Option<ActiveSubjectView>,
}

#[derive(Debug, Serialize)]
pub struct ActiveSubjectView {
    pub id: i32,
    pub subject: String,
    pub language: String,
    pub target: String,
    pub total_stages: i32,
    pub finished_stages: i32,
    pub total_tasks: i32,
    pub finished_tasks: i32,
    pub progress_percent: i32,
    pub current_stage_title: Option<String>,
    pub current_task_title: Option<String>,
    pub quiz_total_problems: i32,
    pub quiz_correct_problems: i32,
    pub quiz_accuracy_percent: Option<i32>,
    pub weak_points: Vec<WeakPointView>,
}

#[derive(Debug, Serialize)]
pub struct WeakPointView {
    pub title: String,
    pub mistake_count: i32,
}

/// GET /api/v1/me/learning-profile
///
/// This endpoint intentionally exposes a compact teaching profile rather than
/// the complete user record. In particular, it never returns passwords,
/// balances, raw birth years, or gender to the AI gateway.
pub async fn get_learning_profile(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let current_user = user::Entity::find_by_id(auth_user.user_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

    let active_subject = if let Some(subject_id) = current_user.active_study_subject_id {
        Some(build_active_subject(&state, subject_id, auth_user.user_id).await?)
    } else {
        None
    };

    Ok(ok(LearningProfileView {
        user_id: current_user.id,
        username: current_user.username,
        age_band: age_band(current_user.birth_year),
        introduction: current_user.introduction,
        level: level_from_exp(current_user.exp),
        experience_points: current_user.exp,
        total_checkins: current_user.total_checkins,
        streak_checkins: current_user.streak_checkins,
        active_subject,
    }))
}

async fn build_active_subject(
    state: &AppState,
    subject_id: i32,
    user_id: i32,
) -> Result<ActiveSubjectView, AppError> {
    let subject = study_subject::Entity::find_by_id(subject_id)
        .filter(study_subject::Column::UserId.eq(user_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::StudySubjectNotFound))?;

    let stages = study_stage::Entity::find()
        .filter(study_stage::Column::StudySubjectId.eq(subject.id))
        .order_by_asc(study_stage::Column::SortOrder)
        .all(&state.db)
        .await?;
    let stage_ids = stages.iter().map(|stage| stage.id).collect::<Vec<_>>();
    let tasks = if stage_ids.is_empty() {
        Vec::new()
    } else {
        study_task::Entity::find()
            .filter(study_task::Column::StudyStageId.is_in(stage_ids))
            .order_by_asc(study_task::Column::SortOrder)
            .all(&state.db)
            .await?
    };
    let total_tasks = tasks.len() as i32;
    let finished_tasks = tasks
        .iter()
        .filter(|task| task.status == study_task::StudyTaskStatus::Finished)
        .count() as i32;
    let current_stage_title = stages
        .iter()
        .find(|stage| stage.status != study_stage::StudyStageStatus::Finished)
        .map(|stage| stage.title.clone());
    let current_stage_id = stages
        .iter()
        .find(|stage| stage.status != study_stage::StudyStageStatus::Finished)
        .map(|stage| stage.id);
    let current_task_title = current_stage_id.and_then(|stage_id| {
        tasks
            .iter()
            .filter(|task| task.study_stage_id == stage_id)
            .find(|task| task.status != study_task::StudyTaskStatus::Finished)
            .map(|task| task.title.clone())
    });

    let task_ids = tasks.iter().map(|task| task.id).collect::<Vec<_>>();
    let submitted_quizzes = if task_ids.is_empty() {
        Vec::new()
    } else {
        study_quiz::Entity::find()
            .filter(study_quiz::Column::StudyTaskId.is_in(task_ids.clone()))
            .filter(study_quiz::Column::Status.eq(study_quiz::StudyQuizStatus::Submitted))
            .all(&state.db)
            .await?
    };
    let quiz_total_problems = submitted_quizzes
        .iter()
        .map(|quiz| quiz.total_problems)
        .sum::<i32>();
    let quiz_correct_problems = submitted_quizzes
        .iter()
        .map(|quiz| quiz.correct_problems)
        .sum::<i32>();
    let quiz_accuracy_percent = (quiz_total_problems > 0).then(|| {
        ((quiz_correct_problems as f64 / quiz_total_problems as f64) * 100.0).round() as i32
    });

    let weak_points = collect_weak_points(state, &tasks, &submitted_quizzes).await?;

    Ok(ActiveSubjectView {
        id: subject.id,
        subject: subject.subject,
        language: subject.language,
        target: subject.target,
        total_stages: subject.total_stages,
        finished_stages: subject.finished_stages,
        total_tasks,
        finished_tasks,
        progress_percent: percentage(finished_tasks, total_tasks),
        current_stage_title,
        current_task_title,
        quiz_total_problems,
        quiz_correct_problems,
        quiz_accuracy_percent,
        weak_points,
    })
}

async fn collect_weak_points(
    state: &AppState,
    tasks: &[study_task::Model],
    quizzes: &[study_quiz::Model],
) -> Result<Vec<WeakPointView>, AppError> {
    if quizzes.is_empty() {
        return Ok(Vec::new());
    }

    let quiz_ids = quizzes.iter().map(|quiz| quiz.id).collect::<Vec<_>>();
    let problems = study_quiz_problem::Entity::find()
        .filter(study_quiz_problem::Column::StudyQuizId.is_in(quiz_ids.clone()))
        .all(&state.db)
        .await?;
    let task_by_quiz = quizzes
        .iter()
        .map(|quiz| (quiz.id, quiz.study_task_id))
        .collect::<HashMap<_, _>>();
    let task_by_id = tasks
        .iter()
        .map(|task| (task.id, task))
        .collect::<HashMap<_, _>>();
    let node_ids = tasks
        .iter()
        .filter_map(|task| task.curriculum_node_id)
        .collect::<Vec<_>>();
    let nodes = if node_ids.is_empty() {
        Vec::new()
    } else {
        curriculum_node::Entity::find()
            .filter(curriculum_node::Column::Id.is_in(node_ids))
            .all(&state.db)
            .await?
    };
    let node_titles = nodes
        .into_iter()
        .map(|node| (node.id, node.title))
        .collect::<HashMap<_, _>>();

    let mut counts = HashMap::<String, i32>::new();
    for problem in problems {
        if problem.chosen_answer == Some(problem.answer) {
            continue;
        }
        let Some(task_id) = task_by_quiz.get(&problem.study_quiz_id) else {
            continue;
        };
        let Some(task) = task_by_id.get(task_id) else {
            continue;
        };
        let title = task
            .curriculum_node_id
            .and_then(|node_id| node_titles.get(&node_id).cloned())
            .unwrap_or_else(|| task.title.clone());
        *counts.entry(title).or_default() += 1;
    }

    let mut weak_points = counts
        .into_iter()
        .map(|(title, mistake_count)| WeakPointView {
            title,
            mistake_count,
        })
        .collect::<Vec<_>>();
    weak_points.sort_by(|left, right| {
        right
            .mistake_count
            .cmp(&left.mistake_count)
            .then_with(|| left.title.cmp(&right.title))
    });
    weak_points.truncate(5);
    Ok(weak_points)
}

fn percentage(value: i32, total: i32) -> i32 {
    if total <= 0 {
        0
    } else {
        ((value as f64 / total as f64) * 100.0).round() as i32
    }
}

fn level_from_exp(exp: i32) -> i32 {
    if exp <= 0 {
        0
    } else {
        ((f64::from(exp) / 100.0).sqrt().floor()) as i32
    }
}

fn age_band(birth_year: Option<i32>) -> Option<String> {
    let current_year = chrono::Utc::now().year();
    let age = birth_year
        .map(|year| current_year - year)
        .filter(|age| (0..=150).contains(age))?;
    Some(match age {
        0..=17 => "未成年".to_owned(),
        18..=24 => "18-24 岁".to_owned(),
        25..=34 => "25-34 岁".to_owned(),
        35..=44 => "35-44 岁".to_owned(),
        _ => "45 岁以上".to_owned(),
    })
}
