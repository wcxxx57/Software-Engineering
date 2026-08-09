use sea_orm::Schema;
use sea_orm_migration::prelude::*;

use crate::entities::ai_chat_message;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let schema = Schema::new(manager.get_database_backend());
        let mut table = schema.create_table_from_entity(ai_chat_message::Entity);
        table.if_not_exists();
        manager.create_table(table).await?;

        // The client message id makes retries idempotent. The scope key also
        // avoids PostgreSQL/SQLite differences around NULL values in composite
        // unique indexes.
        manager
            .create_index(
                Index::create()
                    .name("uniq-ai-chat-message-client")
                    .table(ai_chat_message::Entity)
                    .col(ai_chat_message::Column::UserId)
                    .col(ai_chat_message::Column::ScopeKey)
                    .col(ai_chat_message::Column::ClientMessageId)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx-ai-chat-message-history")
                    .table(ai_chat_message::Entity)
                    .col(ai_chat_message::Column::UserId)
                    .col(ai_chat_message::Column::ScopeKey)
                    .col(ai_chat_message::Column::CreatedAt)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(ai_chat_message::Entity)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}
