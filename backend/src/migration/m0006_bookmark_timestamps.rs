use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const TABLES: [&str; 3] = [
    "study_quiz_problem",
    "knowledge_video",
    "knowledge_explanation",
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in TABLES {
            if !manager.has_column(table, "bookmarked_at").await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(table))
                            .add_column(
                                ColumnDef::new(Alias::new("bookmarked_at"))
                                    .timestamp_with_time_zone()
                                    .null(),
                            )
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in TABLES {
            if manager.has_column(table, "bookmarked_at").await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(table))
                            .drop_column(Alias::new("bookmarked_at"))
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}
