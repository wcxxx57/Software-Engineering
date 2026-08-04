use sea_orm::Schema;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, EntityTrait, QueryFilter, ColumnTrait};
use sea_orm_migration::prelude::*;

use crate::entities::{chat_question, recommendation_resource, recommendation_resource_learning, study_task, study_task_curriculum_node};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let schema = Schema::new(manager.get_database_backend());
        for mut table in [
            schema.create_table_from_entity(recommendation_resource::Entity),
            schema.create_table_from_entity(recommendation_resource_learning::Entity),
            schema.create_table_from_entity(chat_question::Entity),
        ] {
            table.if_not_exists();
            manager.create_table(table).await?;
        }
        for (column, definition) in [
            ("curriculum_node_id", ColumnDef::new(Alias::new("curriculum_node_id")).integer()),
            ("day_index", ColumnDef::new(Alias::new("day_index")).integer()),
        ] {
            if !manager.has_column("study_task", column).await? {
                manager.alter_table(Table::alter().table(Alias::new("study_task")).add_column(definition).to_owned()).await?;
            }
        }
        for index in [
            Index::create().name("idx-recommendation-resource-unique").table(recommendation_resource::Entity).col(recommendation_resource::Column::ResourceKind).col(recommendation_resource::Column::ResourceId).unique().if_not_exists().to_owned(),
            Index::create().name("idx-recommendation-resource-node-kind").table(recommendation_resource::Entity).col(recommendation_resource::Column::CurriculumNodeId).col(recommendation_resource::Column::ResourceKind).if_not_exists().to_owned(),
            Index::create().name("idx-recommendation-learning-unique").table(recommendation_resource_learning::Entity).col(recommendation_resource_learning::Column::RecommendationResourceId).col(recommendation_resource_learning::Column::UserId).unique().if_not_exists().to_owned(),
            Index::create().name("idx-chat-question-node-normalized").table(chat_question::Entity).col(chat_question::Column::CurriculumNodeId).col(chat_question::Column::NormalizedQuestion).if_not_exists().to_owned(),
        ] { manager.create_index(index).await?; }

        // Backfill only unambiguous historical tasks. Never infer a node from
        // the task title: multi-node and unmapped tasks remain ineligible.
        let db = manager.get_connection();
        let tasks = study_task::Entity::find().all(db).await?;
        for task in tasks {
            if task.curriculum_node_id.is_some() { continue; }
            let links = study_task_curriculum_node::Entity::find()
                .filter(study_task_curriculum_node::Column::StudyTaskId.eq(task.id))
                .all(db).await?;
            if links.len() != 1 { continue; }
            let day_index = task.sort_order + 1;
            let mut active: study_task::ActiveModel = task.into();
            active.curriculum_node_id = Set(Some(links[0].curriculum_node_id));
            active.day_index = Set(Some(day_index));
            active.update(db).await?;
        }
        Ok(())
    }
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in ["curriculum_node_id", "day_index"] {
            if manager.has_column("study_task", column).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new("study_task"))
                            .drop_column(Alias::new(column))
                            .to_owned(),
                    )
                    .await?;
            }
        }
        manager.drop_table(Table::drop().table(recommendation_resource_learning::Entity).if_exists().to_owned()).await?;
        manager.drop_table(Table::drop().table(chat_question::Entity).if_exists().to_owned()).await?;
        manager.drop_table(Table::drop().table(recommendation_resource::Entity).if_exists().to_owned()).await?;
        Ok(())
    }
}
