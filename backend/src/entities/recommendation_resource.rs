use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(24))", enum_name = "recommendation_resource_kind")]
pub enum RecommendationResourceKind {
    #[sea_orm(string_value = "KNOWLEDGE_VIDEO")]
    KnowledgeVideo,
    #[sea_orm(string_value = "CODE_VIDEO")]
    CodeVideo,
    #[sea_orm(string_value = "INTERACTIVE_HTML")]
    InteractiveHtml,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(16))", enum_name = "recommendation_quality_status")]
pub enum RecommendationQualityStatus {
    #[sea_orm(string_value = "PENDING")]
    Pending,
    #[sea_orm(string_value = "PASSED")]
    Passed,
    #[sea_orm(string_value = "REJECTED")]
    Rejected,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "recommendation_resource")]
pub struct Model {
    #[sea_orm(primary_key)] pub id: i32,
    pub resource_kind: RecommendationResourceKind,
    pub resource_id: i32,
    pub curriculum_node_id: Option<i32>,
    pub creator_user_id: Option<i32>,
    pub title: String,
    #[sea_orm(column_type = "Text")] pub summary: String,
    pub quality_status: RecommendationQualityStatus,
    pub featured: bool,
    pub display_priority: i32,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
