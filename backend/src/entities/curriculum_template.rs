use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sea_orm(
    rs_type = "String",
    db_type = "String(StringLen::N(20))",
    enum_name = "curriculum_template_status"
)]
pub enum CurriculumTemplateStatus {
    #[sea_orm(string_value = "PENDING_REVIEW")]
    PendingReview,
    #[sea_orm(string_value = "PUBLISHED")]
    Published,
    #[sea_orm(string_value = "ARCHIVED")]
    Archived,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "curriculum_template")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub canonical_name: String,
    pub slug: String,
    pub version: i32,
    pub language: String,
    pub status: CurriculumTemplateStatus,
    #[sea_orm(column_type = "Json")]
    pub aliases: Json,
    pub created_at: DateTimeUtc,
    pub published_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::curriculum_source::Entity")]
    Sources,
    #[sea_orm(has_many = "super::curriculum_node::Entity")]
    Nodes,
}

impl Related<super::curriculum_source::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Sources.def()
    }
}

impl Related<super::curriculum_node::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Nodes.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
