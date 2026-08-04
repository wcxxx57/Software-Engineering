use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "learning_plan_template_task")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub learning_plan_template_stage_id: i32,
    pub curriculum_node_id: i32,
    #[sea_orm(column_type = "Text")]
    pub description: String,
    pub day_index: i32,
    pub sort_order: i32,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::learning_plan_template_stage::Entity",
        from = "Column::LearningPlanTemplateStageId",
        to = "super::learning_plan_template_stage::Column::Id"
    )]
    Stage,
    #[sea_orm(
        belongs_to = "super::curriculum_node::Entity",
        from = "Column::CurriculumNodeId",
        to = "super::curriculum_node::Column::Id"
    )]
    CurriculumNode,
}

impl Related<super::learning_plan_template_stage::Entity> for Entity {
    fn to() -> RelationDef { Relation::Stage.def() }
}

impl Related<super::curriculum_node::Entity> for Entity {
    fn to() -> RelationDef { Relation::CurriculumNode.def() }
}

impl ActiveModelBehavior for ActiveModel {}
