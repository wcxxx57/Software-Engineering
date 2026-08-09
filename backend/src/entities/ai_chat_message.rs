use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// A single persisted AI Chat message.
///
/// `scope_key` is either `general` or `task:<id>`. Keeping the scope as a
/// normalized key makes the ownership boundary explicit and lets the same
/// schema work with PostgreSQL, SQLite and MySQL without nullable composite
/// unique-index differences.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "ai_chat_message")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    #[sea_orm(column_type = "String(StringLen::N(128))")]
    pub scope_key: String,
    #[sea_orm(column_type = "String(StringLen::N(128))")]
    pub client_message_id: String,
    #[sea_orm(column_type = "String(StringLen::N(16))")]
    pub role: String,
    #[sea_orm(column_type = "Text")]
    pub content: String,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
