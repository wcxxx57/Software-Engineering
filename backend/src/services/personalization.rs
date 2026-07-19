use chrono::{Datelike, Utc};
use serde::Serialize;

use crate::entities::{common::Gender, user};

#[derive(Debug, Clone, Serialize)]
pub struct LearnerProfileSnapshot {
    pub age: Option<i32>,
    pub gender: Option<Gender>,
    pub introduction: String,
    pub experience_points: i32,
    pub total_checkins: i32,
    pub streak_checkins: i32,
}

impl LearnerProfileSnapshot {
    pub fn from_user(user: &user::Model) -> Self {
        let current_year = Utc::now().year();
        let age = user
            .birth_year
            .map(|birth_year| current_year - birth_year)
            .filter(|age| (0..=150).contains(age));

        Self {
            age,
            gender: user.gender,
            introduction: user.introduction.clone(),
            experience_points: user.exp,
            total_checkins: user.total_checkins,
            streak_checkins: user.streak_checkins,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LearningContextSnapshot {
    pub subject: String,
    pub target: String,
    pub language: String,
    pub total_stages: i32,
    pub finished_stages: i32,
    pub stage_total_tasks: i32,
    pub stage_finished_tasks: i32,
    pub pretest_total_problems: i32,
    pub pretest_answered_problems: i32,
    pub pretest_correct_problems: i32,
    pub task_title: Option<String>,
    pub task_description: Option<String>,
}
