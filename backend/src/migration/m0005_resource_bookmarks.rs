use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in ["knowledge_video", "knowledge_explanation"] {
            if !manager.has_column(table, "bookmarked").await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(table))
                            .add_column(
                                ColumnDef::new(Alias::new("bookmarked"))
                                    .boolean()
                                    .not_null()
                                    .default(false),
                            )
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in ["knowledge_explanation", "knowledge_video"] {
            if manager.has_column(table, "bookmarked").await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(table))
                            .drop_column(Alias::new("bookmarked"))
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}
