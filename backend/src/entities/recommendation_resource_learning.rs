use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "recommendation_resource_learning")]
pub struct Model {
    #[sea_orm(primary_key)] pub id: i32,
    pub recommendation_resource_id: i32,
    pub user_id: i32,
    pub first_opened_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
