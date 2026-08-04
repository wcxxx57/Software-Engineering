use sea_orm::Schema;
use sea_orm_migration::prelude::*;

use crate::entities::{
    learning_plan_template, learning_plan_template_stage, learning_plan_template_task,
    plan_recommendation_draft,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let schema = Schema::new(manager.get_database_backend());
        for mut table in [
            schema.create_table_from_entity(learning_plan_template::Entity),
            schema.create_table_from_entity(learning_plan_template_stage::Entity),
            schema.create_table_from_entity(learning_plan_template_task::Entity),
            schema.create_table_from_entity(plan_recommendation_draft::Entity),
        ] {
            table.if_not_exists();
            manager.create_table(table).await?;
        }
        for index in [
            Index::create()
                .name("idx-learning-plan-template-curriculum-stage")
                .table(learning_plan_template::Entity)
                .col(learning_plan_template::Column::CurriculumTemplateId)
                .col(learning_plan_template::Column::StageCount)
                .col(learning_plan_template::Column::Language)
                .unique()
                .if_not_exists()
                .to_owned(),
            Index::create()
                .name("idx-learning-plan-stage-template-order")
                .table(learning_plan_template_stage::Entity)
                .col(learning_plan_template_stage::Column::LearningPlanTemplateId)
                .col(learning_plan_template_stage::Column::SortOrder)
                .if_not_exists()
                .to_owned(),
            Index::create()
                .name("idx-learning-plan-task-stage-order")
                .table(learning_plan_template_task::Entity)
                .col(learning_plan_template_task::Column::LearningPlanTemplateStageId)
                .col(learning_plan_template_task::Column::SortOrder)
                .if_not_exists()
                .to_owned(),
            Index::create()
                .name("idx-plan-draft-subject-kind")
                .table(plan_recommendation_draft::Entity)
                .col(plan_recommendation_draft::Column::StudySubjectId)
                .col(plan_recommendation_draft::Column::Kind)
                .col(plan_recommendation_draft::Column::AdoptedAt)
                .if_not_exists()
                .to_owned(),
        ] {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(plan_recommendation_draft::Entity)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(learning_plan_template_task::Entity)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(learning_plan_template_stage::Entity)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(learning_plan_template::Entity)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}
