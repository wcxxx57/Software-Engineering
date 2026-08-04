use sea_orm::{ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, Schema};
use sea_orm_migration::prelude::*;

use crate::entities::{chat_question, study_task, study_task_curriculum_node};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let schema = Schema::new(manager.get_database_backend());
        let mut table = schema.create_table_from_entity(chat_question::Entity);
        table.if_not_exists();
        manager.create_table(table).await?;
        manager.create_index(Index::create().name("idx-chat-question-node-normalized-v2").table(chat_question::Entity).col(chat_question::Column::CurriculumNodeId).col(chat_question::Column::NormalizedQuestion).if_not_exists().to_owned()).await?;
        let db = manager.get_connection();
        for task in study_task::Entity::find().all(db).await? {
            if task.curriculum_node_id.is_some() { continue; }
            let links = study_task_curriculum_node::Entity::find().filter(study_task_curriculum_node::Column::StudyTaskId.eq(task.id)).all(db).await?;
            if links.len() != 1 { continue; }
            let day = task.sort_order + 1;
            let mut active: study_task::ActiveModel = task.into();
            active.curriculum_node_id = Set(Some(links[0].curriculum_node_id));
            active.day_index = Set(Some(day));
            active.update(db).await?;
        }
        Ok(())
    }
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.drop_table(Table::drop().table(chat_question::Entity).if_exists().to_owned()).await
    }
}
