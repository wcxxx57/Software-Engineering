use chrono::Utc;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ConnectionTrait, DbErr};

use crate::entities::asset_transaction;

pub const EXP: &str = "EXP";
pub const GOLD: &str = "GOLD";
pub const DIAMOND: &str = "DIAMOND";

pub async fn record<C: ConnectionTrait>(
    db: &C,
    user_id: i32,
    asset: &str,
    amount: i32,
    balance_after: i32,
    title: impl Into<String>,
) -> Result<(), DbErr> {
    if amount == 0 {
        return Ok(());
    }

    asset_transaction::ActiveModel {
        user_id: Set(user_id),
        asset: Set(asset.to_owned()),
        amount: Set(amount),
        balance_after: Set(balance_after),
        title: Set(title.into()),
        created_at: Set(Utc::now()),
        ..Default::default()
    }
    .insert(db)
    .await?;

    Ok(())
}
