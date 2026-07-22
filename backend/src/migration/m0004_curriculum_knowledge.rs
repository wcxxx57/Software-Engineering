use sea_orm::Schema;
use sea_orm_migration::prelude::*;

use crate::entities::{
    curriculum_node, curriculum_source, curriculum_template, study_task_curriculum_node,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let schema = Schema::new(manager.get_database_backend());

        for mut table in [
            schema.create_table_from_entity(curriculum_template::Entity),
            schema.create_table_from_entity(curriculum_source::Entity),
            schema.create_table_from_entity(curriculum_node::Entity),
            schema.create_table_from_entity(study_task_curriculum_node::Entity),
        ] {
            table.if_not_exists();
            manager.create_table(table).await?;
        }

        manager
            .create_index(
                Index::create()
                    .name("idx-curriculum-template-slug-version")
                    .table(curriculum_template::Entity)
                    .col(curriculum_template::Column::Slug)
                    .col(curriculum_template::Column::Version)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx-curriculum-source-hash")
                    .table(curriculum_source::Entity)
                    .col(curriculum_source::Column::ContentHash)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx-curriculum-node-template-key")
                    .table(curriculum_node::Entity)
                    .col(curriculum_node::Column::CurriculumTemplateId)
                    .col(curriculum_node::Column::NodeKey)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx-study-task-curriculum-node-unique")
                    .table(study_task_curriculum_node::Entity)
                    .col(study_task_curriculum_node::Column::StudyTaskId)
                    .col(study_task_curriculum_node::Column::CurriculumNodeId)
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        if !manager
            .has_column("study_subject", "curriculum_template_id")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new("study_subject"))
                        .add_column(ColumnDef::new(Alias::new("curriculum_template_id")).integer())
                        .to_owned(),
                )
                .await?;
        }
        if !manager.has_column("study_subject", "failure_code").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new("study_subject"))
                        .add_column(ColumnDef::new(Alias::new("failure_code")).string_len(64))
                        .to_owned(),
                )
                .await?;
        }
        if !manager
            .has_column("pretest_problem", "curriculum_node_id")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new("pretest_problem"))
                        .add_column(ColumnDef::new(Alias::new("curriculum_node_id")).integer())
                        .to_owned(),
                )
                .await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Alias::new("pretest_problem"))
                    .drop_column(Alias::new("curriculum_node_id"))
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Alias::new("study_subject"))
                    .drop_column(Alias::new("failure_code"))
                    .drop_column(Alias::new("curriculum_template_id"))
                    .to_owned(),
            )
            .await?;
        for table in [
            "study_task_curriculum_node",
            "curriculum_node",
            "curriculum_source",
            "curriculum_template",
        ] {
            manager
                .drop_table(
                    Table::drop()
                        .table(Alias::new(table))
                        .if_exists()
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}
