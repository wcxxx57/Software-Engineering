use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::N(12))",
    enum_name = "plan_recommendation_draft_kind"
)]
pub enum PlanRecommendationDraftKind {
    #[sea_orm(string_value = "INITIAL")]
    Initial,
    #[sea_orm(string_value = "NEXT")]
    Next,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "plan_recommendation_draft")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    pub study_subject_id: i32,
    pub learning_plan_template_id: i32,
    pub kind: PlanRecommendationDraftKind,
    pub title: String,
    #[sea_orm(column_type = "Text")]
    pub reason: String,
    pub stage_count: i32,
    pub task_count: i32,
    pub estimated_weeks: Option<i32>,
    #[sea_orm(column_type = "Json")]
    pub payload: Json,
    pub adopted_at: Option<DateTimeUtc>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub expires_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id"
    )]
    User,
    #[sea_orm(
        belongs_to = "super::study_subject::Entity",
        from = "Column::StudySubjectId",
        to = "super::study_subject::Column::Id"
    )]
    StudySubject,
    #[sea_orm(
        belongs_to = "super::learning_plan_template::Entity",
        from = "Column::LearningPlanTemplateId",
        to = "super::learning_plan_template::Column::Id"
    )]
    Template,
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef { Relation::User.def() }
}

impl Related<super::study_subject::Entity> for Entity {
    fn to() -> RelationDef { Relation::StudySubject.def() }
}

impl Related<super::learning_plan_template::Entity> for Entity {
    fn to() -> RelationDef { Relation::Template.def() }
}

impl ActiveModelBehavior for ActiveModel {}
