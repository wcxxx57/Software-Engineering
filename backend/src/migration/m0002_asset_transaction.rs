use sea_orm::Schema;
use sea_orm_migration::prelude::*;

use crate::entities::asset_transaction;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let schema = Schema::new(manager.get_database_backend());
        let mut table = schema.create_table_from_entity(asset_transaction::Entity);
        table.if_not_exists();
        manager.create_table(table).await?;
        manager
            .create_index(
                Index::create()
                    .name("idx-asset-transaction-user-created")
                    .table(asset_transaction::Entity)
                    .col(asset_transaction::Column::UserId)
                    .col(asset_transaction::Column::CreatedAt)
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
                    .table(asset_transaction::Entity)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}
