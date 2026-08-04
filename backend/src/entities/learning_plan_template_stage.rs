use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "learning_plan_template_stage")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub learning_plan_template_id: i32,
    pub title: String,
    #[sea_orm(column_type = "Text")]
    pub description: String,
    pub sort_order: i32,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::learning_plan_template::Entity",
        from = "Column::LearningPlanTemplateId",
        to = "super::learning_plan_template::Column::Id"
    )]
    Template,
    #[sea_orm(has_many = "super::learning_plan_template_task::Entity")]
    Tasks,
}

impl Related<super::learning_plan_template::Entity> for Entity {
    fn to() -> RelationDef { Relation::Template.def() }
}

impl Related<super::learning_plan_template_task::Entity> for Entity {
    fn to() -> RelationDef { Relation::Tasks.def() }
}

impl ActiveModelBehavior for ActiveModel {}
