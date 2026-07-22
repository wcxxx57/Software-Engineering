use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::N(20))",
    enum_name = "curriculum_source_status"
)]
pub enum CurriculumSourceStatus {
    #[sea_orm(string_value = "PENDING_REVIEW")]
    PendingReview,
    #[sea_orm(string_value = "PUBLISHED")]
    Published,
    #[sea_orm(string_value = "REJECTED")]
    Rejected,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "curriculum_source")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub curriculum_template_id: i32,
    pub platform: String,
    pub institution: String,
    pub instructor: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub source_url: String,
    pub content_hash: String,
    #[sea_orm(column_type = "Text")]
    pub raw_outline: String,
    #[sea_orm(column_type = "Json")]
    pub validation_failures: Json,
    pub match_score: f64,
    pub status: CurriculumSourceStatus,
    pub captured_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::curriculum_template::Entity",
        from = "Column::CurriculumTemplateId",
        to = "super::curriculum_template::Column::Id"
    )]
    CurriculumTemplate,
}

impl Related<super::curriculum_template::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::CurriculumTemplate.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
