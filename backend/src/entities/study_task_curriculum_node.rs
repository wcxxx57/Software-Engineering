use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "study_task_curriculum_node")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub study_task_id: i32,
    pub curriculum_node_id: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::study_task::Entity",
        from = "Column::StudyTaskId",
        to = "super::study_task::Column::Id"
    )]
    StudyTask,
    #[sea_orm(
        belongs_to = "super::curriculum_node::Entity",
        from = "Column::CurriculumNodeId",
        to = "super::curriculum_node::Column::Id"
    )]
    CurriculumNode,
}

impl Related<super::study_task::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::StudyTask.def()
    }
}

impl Related<super::curriculum_node::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::CurriculumNode.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
