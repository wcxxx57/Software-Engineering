use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "chat_question")]
pub struct Model {
    #[sea_orm(primary_key)] pub id: i32,
    pub study_task_id: i32,
    pub curriculum_node_id: Option<i32>,
    pub user_id: i32,
    #[sea_orm(column_type = "Text")] pub question: String,
    #[sea_orm(column_type = "Text")] pub normalized_question: String,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
