use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::Utc;
use std::collections::HashMap;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::AuthUser,
    entities::{knowledge_video, recommendation_resource, user, user_knowledge_video_link},
    error::{AppError, BusinessError},
    response::{created, ok},
    services::{
        asset_transaction::{self, DIAMOND},
        content::dispatch_payload,
        personalization::LearnerProfileSnapshot,
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct CreateRequest {
    pub prompt: String,
    #[serde(default)]
    pub public: bool,
}

#[derive(Debug, Serialize)]
pub struct KnowledgeVideoView {
    pub id: i32,
    pub status: knowledge_video::KnowledgeVideoStatus,
    pub title: String,
    pub prompt: String,
    pub object_key: Option<String>,
    pub public: bool,
    pub bookmarked: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
struct KnowledgeVideoGenerateRequest {
    task_id: i32,
    prompt: String,
    learner_profile: LearnerProfileSnapshot,
}

impl From<knowledge_video::Model> for KnowledgeVideoView {
    fn from(m: knowledge_video::Model) -> Self {
        Self {
            id: m.id,
            status: m.status,
            title: display_title_from_prompt(&m.prompt),
            prompt: m.prompt,
            object_key: m.object_key,
            public: m.public,
            bookmarked: m.bookmarked,
            created_at: m.created_at.timestamp_millis(),
            updated_at: m.updated_at.timestamp_millis(),
        }
    }
}

fn display_title_from_prompt(prompt: &str) -> String {
    for raw in prompt.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let cleaned = line.trim_start_matches('#').trim();
        if cleaned.is_empty() || cleaned.starts_with("```") {
            continue;
        }
        return if cleaned.chars().count() > 30 {
            cleaned.chars().take(30).collect::<String>() + "…"
        } else {
            cleaned.to_owned()
        };
    }
    "未命名".to_owned()
}

pub async fn create(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CreateRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    if state.config.core_flow_only {
        return Err(AppError::business(BusinessError::FeatureDisabled));
    }
    let now = Utc::now();
    let cost = state.config.knowledge_video_diamond_cost;
    let tx = state.db.begin().await?;

    let existing_user = user::Entity::find_by_id(auth_user.user_id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

    if existing_user.diamond < cost {
        return Err(AppError::business(BusinessError::InsufficientDiamonds));
    }

    let learner_profile = LearnerProfileSnapshot::from_user(&existing_user);
    let new_diamond = existing_user.diamond - cost;
    let mut active_user: user::ActiveModel = existing_user.clone().into();
    active_user.diamond = Set(new_diamond);
    active_user.updated_at = Set(now);
    active_user.update(&tx).await?;
    asset_transaction::record(
        &tx,
        existing_user.id,
        DIAMOND,
        -cost,
        new_diamond,
        "生成知识视频",
    )
    .await?;

    let record = knowledge_video::ActiveModel {
        status: Set(knowledge_video::KnowledgeVideoStatus::Queuing),
        prompt: Set(payload.prompt.clone()),
        object_key: Set(None),
        public: Set(payload.public),
        bookmarked: Set(false),
        bookmarked_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&tx)
    .await?;

    user_knowledge_video_link::ActiveModel {
        knowledge_video_id: Set(record.id),
        user_id: Set(auth_user.user_id),
        created_at: Set(now),
    }
    .insert(&tx)
    .await?;

    tx.commit().await?;

    let request = KnowledgeVideoGenerateRequest {
        task_id: record.id,
        prompt: payload.prompt,
        learner_profile,
    };
    if let Err(err) = dispatch_payload(
        state.publisher.as_ref(),
        &state.config.knowledge_video_exchange,
        &request,
    )
    .await
    {
        let tx = state.db.begin().await?;
        let mut active: knowledge_video::ActiveModel = record.clone().into();
        active.status = Set(knowledge_video::KnowledgeVideoStatus::Failed);
        active.updated_at = Set(Utc::now());
        active.update(&tx).await?;

        let refund_user = user::Entity::find_by_id(auth_user.user_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
        let new_diamond = refund_user.diamond + cost;
        let mut active_user: user::ActiveModel = refund_user.clone().into();
        active_user.diamond = Set(new_diamond);
        active_user.updated_at = Set(Utc::now());
        active_user.update(&tx).await?;
        asset_transaction::record(
            &tx,
            refund_user.id,
            DIAMOND,
            cost,
            new_diamond,
            "知识视频生成失败退款",
        )
        .await?;

        tx.commit().await?;
        return Err(err);
    }

    Ok(created(KnowledgeVideoView::from(record)))
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub q: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<ListQuery>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let mut select = user_knowledge_video_link::Entity::find()
        .filter(user_knowledge_video_link::Column::UserId.eq(auth_user.user_id))
        .order_by_desc(user_knowledge_video_link::Column::CreatedAt)
        .find_also_related(knowledge_video::Entity);

    if let Some(q) = query.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        select = select.filter(knowledge_video::Column::Prompt.contains(q));
    }

    let pairs = select.all(&state.db).await?;

    let resource_ids = pairs
        .iter()
        .filter_map(|(_, resource)| resource.as_ref().map(|resource| resource.id))
        .collect::<Vec<_>>();
    let catalog_titles = if resource_ids.is_empty() {
        HashMap::new()
    } else {
        recommendation_resource::Entity::find()
            .filter(recommendation_resource::Column::ResourceKind.eq(recommendation_resource::RecommendationResourceKind::KnowledgeVideo))
            .filter(recommendation_resource::Column::ResourceId.is_in(resource_ids))
            .all(&state.db)
            .await?
            .into_iter()
            .filter_map(|catalog| {
                let title = catalog.title.trim().to_owned();
                (!title.is_empty()).then_some((catalog.resource_id, title))
            })
            .collect::<HashMap<_, _>>()
    };

    let views: Vec<KnowledgeVideoView> = pairs
        .into_iter()
        .filter_map(|(_link, kv)| {
            kv.map(|kv| {
                let mut view = KnowledgeVideoView::from(kv.clone());
                if let Some(title) = catalog_titles.get(&kv.id) {
                    view.title = title.clone();
                }
                view
            })
        })
        .collect();
    Ok(ok(views))
}

pub async fn get_by_id(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let owned = user_knowledge_video_link::Entity::find_by_id(id)
        .filter(user_knowledge_video_link::Column::UserId.eq(auth_user.user_id))
        .one(&state.db)
        .await?
        .is_some();

    let record = knowledge_video::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    let catalog = recommendation_resource::Entity::find()
        .filter(recommendation_resource::Column::ResourceKind.eq(recommendation_resource::RecommendationResourceKind::KnowledgeVideo))
        .filter(recommendation_resource::Column::ResourceId.eq(id))
        .one(&state.db).await?;
    let public_catalogued = catalog.as_ref().is_some_and(|item| {
        item.curriculum_node_id.is_some()
            || (item.featured
                && item.quality_status
                    == recommendation_resource::RecommendationQualityStatus::Passed)
    });
    if !owned
        && !(public_catalogued
            && record.public
            && record.status == knowledge_video::KnowledgeVideoStatus::Finished
            && record
                .object_key
                .as_deref()
                .is_some_and(|key| !key.trim().is_empty()))
    {
        return Err(AppError::business(BusinessError::ContentNotFound));
    }

    Ok(ok(KnowledgeVideoView::from(record)))
}

pub async fn delete(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let result = user_knowledge_video_link::Entity::delete_many()
        .filter(user_knowledge_video_link::Column::KnowledgeVideoId.eq(id))
        .filter(user_knowledge_video_link::Column::UserId.eq(auth_user.user_id))
        .exec(&state.db)
        .await?;

    if result.rows_affected == 0 {
        return Err(AppError::business(BusinessError::ContentNotFound));
    }

    Ok(ok(serde_json::json!({"deleted": true})))
}

/// PATCH /api/v1/knowledge-videos/{id}/bookmark
pub async fn toggle_bookmark(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let link = user_knowledge_video_link::Entity::find_by_id(id)
        .filter(user_knowledge_video_link::Column::UserId.eq(auth_user.user_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;
    let record = knowledge_video::Entity::find_by_id(link.knowledge_video_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    let bookmarked = !record.bookmarked;
    let mut active: knowledge_video::ActiveModel = record.into();
    active.bookmarked = Set(bookmarked);
    active.bookmarked_at = Set(bookmarked.then(Utc::now));
    active.updated_at = Set(Utc::now());
    active.update(&state.db).await?;
    Ok(ok(serde_json::json!({"bookmarked": bookmarked})))
}
