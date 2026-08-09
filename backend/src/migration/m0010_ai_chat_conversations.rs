use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("ai_chat_message", "conversation_id")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new("ai_chat_message"))
                        .add_column(
                            ColumnDef::new(Alias::new("conversation_id"))
                                .string_len(128)
                                .not_null()
                                .default("legacy"),
                        )
                        .to_owned(),
                )
                .await?;
        }

        manager
            .create_index(
                Index::create()
                    .name("idx-ai-chat-message-conversation")
                    .table(Alias::new("ai_chat_message"))
                    .col(Alias::new("user_id"))
                    .col(Alias::new("scope_key"))
                    .col(Alias::new("conversation_id"))
                    .col(Alias::new("created_at"))
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx-ai-chat-message-conversation")
                    .table(Alias::new("ai_chat_message"))
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        if manager
            .has_column("ai_chat_message", "conversation_id")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new("ai_chat_message"))
                        .drop_column(Alias::new("conversation_id"))
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}
