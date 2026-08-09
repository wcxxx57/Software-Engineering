use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// A single persisted AI Chat message.
///
/// `scope_key` is either `general` or `task:<id>`. `conversation_id` separates
/// multiple conversations inside the same scope, so opening AI Chat can start
/// fresh while an earlier conversation remains resumable from PostgreSQL.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "ai_chat_message")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    #[sea_orm(column_type = "String(StringLen::N(128))")]
    pub scope_key: String,
    #[sea_orm(column_type = "String(StringLen::N(128))")]
    pub conversation_id: String,
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
