use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "curriculum_node")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub curriculum_template_id: i32,
    pub node_key: String,
    pub parent_node_key: Option<String>,
    pub title: String,
    #[sea_orm(column_type = "Text")]
    pub description: String,
    pub depth: i32,
    pub sort_order: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::curriculum_template::Entity",
        from = "Column::CurriculumTemplateId",
        to = "super::curriculum_template::Column::Id"
    )]
    CurriculumTemplate,
    #[sea_orm(has_many = "super::study_task_curriculum_node::Entity")]
    StudyTaskLinks,
}

impl Related<super::curriculum_template::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::CurriculumTemplate.def()
    }
}

impl Related<super::study_task_curriculum_node::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::StudyTaskLinks.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
