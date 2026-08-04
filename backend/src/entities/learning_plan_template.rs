use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::N(16))",
    enum_name = "learning_plan_template_status"
)]
pub enum LearningPlanTemplateStatus {
    #[sea_orm(string_value = "PUBLISHED")]
    Published,
    #[sea_orm(string_value = "ARCHIVED")]
    Archived,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "learning_plan_template")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub curriculum_template_id: i32,
    pub title: String,
    #[sea_orm(column_type = "Json")]
    pub target_tags: Json,
    pub language: String,
    pub difficulty_min: Option<i32>,
    pub difficulty_max: Option<i32>,
    pub stage_count: i32,
    pub estimated_weeks: Option<i32>,
    pub status: LearningPlanTemplateStatus,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::curriculum_template::Entity",
        from = "Column::CurriculumTemplateId",
        to = "super::curriculum_template::Column::Id"
    )]
    CurriculumTemplate,
    #[sea_orm(has_many = "super::learning_plan_template_stage::Entity")]
    Stages,
}

impl Related<super::curriculum_template::Entity> for Entity {
    fn to() -> RelationDef { Relation::CurriculumTemplate.def() }
}

impl Related<super::learning_plan_template_stage::Entity> for Entity {
    fn to() -> RelationDef { Relation::Stages.def() }
}

impl ActiveModelBehavior for ActiveModel {}
