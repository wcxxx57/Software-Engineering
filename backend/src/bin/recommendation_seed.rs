use std::env;

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Database, EntityTrait, QueryFilter,
};
use sea_orm_migration::MigratorTrait;

use zhiying_backend::{
    entities::{
        recommendation_resource, recommendation_resource_learning, user,
    },
    migration::Migrator,
};

fn required(name: &str) -> String {
    env::var(name).unwrap_or_else(|_| panic!("missing required environment variable {name}"))
}

fn parse_kind(value: &str) -> recommendation_resource::RecommendationResourceKind {
    match value.to_ascii_uppercase().as_str() {
        "KNOWLEDGE_VIDEO" | "KNOWLEDGE-VIDEO" => {
            recommendation_resource::RecommendationResourceKind::KnowledgeVideo
        }
        "CODE_VIDEO" | "CODE-VIDEO" => {
            recommendation_resource::RecommendationResourceKind::CodeVideo
        }
        "INTERACTIVE_HTML" | "INTERACTIVE-HTML" | "2D" => {
            recommendation_resource::RecommendationResourceKind::InteractiveHtml
        }
        other => panic!("unsupported RECOMMENDATION_RESOURCE_KIND: {other}"),
    }
}

fn parse_bool(name: &str, default: bool) -> bool {
    match env::var(name).ok().as_deref() {
        None => default,
        Some("1" | "true" | "TRUE" | "yes" | "YES") => true,
        Some("0" | "false" | "FALSE" | "no" | "NO") => false,
        Some(value) => panic!("{name} must be a boolean, got {value}"),
    }
}

fn parse_user_ids() -> Vec<i32> {
    env::var("RECOMMENDATION_LEARNER_IDS")
        .unwrap_or_default()
        .split(',')
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            value
                .trim()
                .parse::<i32>()
                .unwrap_or_else(|_| panic!("invalid learner id: {value}"))
        })
        .collect()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let database_url = env::var("DATABASE_URL")?;
    let db = Database::connect(database_url).await?;
    Migrator::up(&db, None).await?;

    let kind = parse_kind(&required("RECOMMENDATION_RESOURCE_KIND"));
    let resource_id = required("RECOMMENDATION_RESOURCE_ID").parse::<i32>()?;
    let curriculum_node_id = env::var("RECOMMENDATION_CURRICULUM_NODE_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.parse::<i32>())
        .transpose()?;
    let title = required("RECOMMENDATION_TITLE");
    let summary = env::var("RECOMMENDATION_SUMMARY")
        .unwrap_or_else(|_| "通过已完成内容直接学习当前知识点。".to_owned());
    let quality_status = match env::var("RECOMMENDATION_QUALITY_STATUS")
        .unwrap_or_else(|_| "PASSED".to_owned())
        .to_ascii_uppercase()
        .as_str()
    {
        "PENDING" => recommendation_resource::RecommendationQualityStatus::Pending,
        "PASSED" => recommendation_resource::RecommendationQualityStatus::Passed,
        "REJECTED" => recommendation_resource::RecommendationQualityStatus::Rejected,
        other => panic!("unsupported RECOMMENDATION_QUALITY_STATUS: {other}"),
    };
    let featured = parse_bool("RECOMMENDATION_FEATURED", false);
    let display_priority = env::var("RECOMMENDATION_DISPLAY_PRIORITY")
        .unwrap_or_else(|_| "0".to_owned())
        .parse::<i32>()?;
    let now = Utc::now();

    let existing = recommendation_resource::Entity::find()
        .filter(recommendation_resource::Column::ResourceKind.eq(kind))
        .filter(recommendation_resource::Column::ResourceId.eq(resource_id))
        .one(&db)
        .await?;
    let catalog = if let Some(row) = existing {
        let mut active: recommendation_resource::ActiveModel = row.into();
        active.curriculum_node_id = Set(curriculum_node_id);
        active.title = Set(title);
        active.summary = Set(summary);
        active.quality_status = Set(quality_status);
        active.featured = Set(featured);
        active.display_priority = Set(display_priority);
        active.updated_at = Set(now);
        active.update(&db).await?
    } else {
        recommendation_resource::ActiveModel {
            resource_kind: Set(kind),
            resource_id: Set(resource_id),
            curriculum_node_id: Set(curriculum_node_id),
            creator_user_id: Set(None),
            title: Set(title),
            summary: Set(summary),
            quality_status: Set(quality_status),
            featured: Set(featured),
            display_priority: Set(display_priority),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        }
        .insert(&db)
        .await?
    };

    for user_id in parse_user_ids() {
        if user::Entity::find_by_id(user_id).one(&db).await?.is_none() {
            return Err(format!("learner user {user_id} does not exist").into());
        }
        let already_opened = recommendation_resource_learning::Entity::find()
            .filter(
                recommendation_resource_learning::Column::RecommendationResourceId
                    .eq(catalog.id),
            )
            .filter(recommendation_resource_learning::Column::UserId.eq(user_id))
            .one(&db)
            .await?
            .is_some();
        if !already_opened {
            recommendation_resource_learning::ActiveModel {
                recommendation_resource_id: Set(catalog.id),
                user_id: Set(user_id),
                first_opened_at: Set(now),
                ..Default::default()
            }
            .insert(&db)
            .await?;
        }
    }

    println!(
        "catalog_id={} resource_kind={kind:?} resource_id={} featured={} quality_status={quality_status:?}",
        catalog.id, resource_id, featured
    );
    Ok(())
}
