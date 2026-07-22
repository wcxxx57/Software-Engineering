use chrono::Utc;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, EntityTrait};
use sea_orm_migration::prelude::*;

use crate::entities::{asset_transaction, user};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let connection = manager.get_connection();
        let users = user::Entity::find().all(connection).await?;
        let now = Utc::now();

        for user in users {
            for (asset, balance) in [
                ("EXP", user.exp),
                ("GOLD", user.gold),
                ("DIAMOND", user.diamond),
            ] {
                if balance == 0 {
                    continue;
                }

                asset_transaction::ActiveModel {
                    user_id: Set(user.id),
                    asset: Set(asset.to_owned()),
                    amount: Set(balance),
                    balance_after: Set(balance),
                    title: Set("历史余额结转".to_owned()),
                    created_at: Set(now),
                    ..Default::default()
                }
                .insert(connection)
                .await?;
            }
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DELETE FROM asset_transaction WHERE title = '历史余额结转'")
            .await?;
        Ok(())
    }
}
