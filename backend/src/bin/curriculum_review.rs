use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Database, EntityTrait, QueryFilter,
    TransactionTrait,
};
use serde_json::json;
use zhiying_backend::entities::{curriculum_source, curriculum_template};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let database_url = std::env::var("DATABASE_URL")?;
    let db = Database::connect(database_url).await?;
    let args = std::env::args().skip(1).collect::<Vec<_>>();

    match args.as_slice() {
        [command] if command == "list" => list_pending(&db).await?,
        [command, id] if command == "publish" => {
            review(&db, id.parse()?, true).await?;
        }
        [command, id] if command == "reject" => {
            review(&db, id.parse()?, false).await?;
        }
        _ => {
            eprintln!(
                "usage: curriculum_review list | publish <template_id> | reject <template_id>"
            );
            std::process::exit(2);
        }
    }
    Ok(())
}

async fn list_pending(db: &sea_orm::DatabaseConnection) -> Result<(), sea_orm::DbErr> {
    let templates = curriculum_template::Entity::find()
        .filter(
            curriculum_template::Column::Status
                .eq(curriculum_template::CurriculumTemplateStatus::PendingReview),
        )
        .all(db)
        .await?;
    let mut result = Vec::with_capacity(templates.len());
    for template in templates {
        let sources = curriculum_source::Entity::find()
            .filter(curriculum_source::Column::CurriculumTemplateId.eq(template.id))
            .all(db)
            .await?;
        result.push(json!({
            "template_id": template.id,
            "canonical_name": template.canonical_name,
            "version": template.version,
            "sources": sources.into_iter().map(|source| json!({
                "source_url": source.source_url,
                "institution": source.institution,
                "match_score": source.match_score,
                "validation_failures": source.validation_failures,
            })).collect::<Vec<_>>(),
        }));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&result).expect("review output is JSON")
    );
    Ok(())
}

async fn review(
    db: &sea_orm::DatabaseConnection,
    template_id: i32,
    publish: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let tx = db.begin().await?;
    let template = curriculum_template::Entity::find_by_id(template_id)
        .one(&tx)
        .await?
        .ok_or("curriculum template not found")?;
    if template.status != curriculum_template::CurriculumTemplateStatus::PendingReview {
        return Err("only PENDING_REVIEW templates can be reviewed".into());
    }

    let mut active: curriculum_template::ActiveModel = template.into();
    active.status = Set(if publish {
        curriculum_template::CurriculumTemplateStatus::Published
    } else {
        curriculum_template::CurriculumTemplateStatus::Archived
    });
    active.published_at = Set(publish.then(Utc::now));
    active.update(&tx).await?;

    let sources = curriculum_source::Entity::find()
        .filter(curriculum_source::Column::CurriculumTemplateId.eq(template_id))
        .all(&tx)
        .await?;
    for source in sources {
        let mut active: curriculum_source::ActiveModel = source.into();
        active.status = Set(if publish {
            curriculum_source::CurriculumSourceStatus::Published
        } else {
            curriculum_source::CurriculumSourceStatus::Rejected
        });
        active.update(&tx).await?;
    }
    tx.commit().await?;
    println!("{}", if publish { "published" } else { "rejected" });
    Ok(())
}
