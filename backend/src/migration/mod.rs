mod m0001_init_schema;
mod m0002_asset_transaction;
mod m0003_asset_opening_balances;
mod m0004_curriculum_knowledge;
mod m0005_resource_bookmarks;

use sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m0001_init_schema::Migration),
            Box::new(m0002_asset_transaction::Migration),
            Box::new(m0003_asset_opening_balances::Migration),
            Box::new(m0004_curriculum_knowledge::Migration),
            Box::new(m0005_resource_bookmarks::Migration),
        ]
    }
}
