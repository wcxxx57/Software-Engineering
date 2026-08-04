use axum::{
    Json,
    extract::{Path, State},
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, TransactionTrait,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::AuthUser,
    entities::{knowledge_explanation, user},
    error::{AppError, BusinessError},
    response::{created, ok},
    services::{
        asset_transaction::{self, GOLD},
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
pub struct KnowledgeExplanationView {
    pub id: i32,
    pub status: knowledge_explanation::KnowledgeExplanationStatus,
    pub prompt: String,
    pub content: Option<String>,
    pub public: bool,
    pub bookmarked: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
struct KnowledgeExplanationGenerateRequest {
    task_id: i32,
    prompt: String,
    learner_profile: LearnerProfileSnapshot,
}

impl From<knowledge_explanation::Model> for KnowledgeExplanationView {
    fn from(m: knowledge_explanation::Model) -> Self {
        Self {
            id: m.id,
            status: m.status,
            prompt: m.prompt,
            content: m.content,
            public: m.public,
            bookmarked: m.bookmarked,
            created_at: m.created_at.timestamp_millis(),
            updated_at: m.updated_at.timestamp_millis(),
        }
    }
}

pub async fn create(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CreateRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let now = Utc::now();
    let cost = state.config.knowledge_explanation_gold_cost;
    let tx = state.db.begin().await?;

    let existing_user = user::Entity::find_by_id(auth_user.user_id)
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

    if existing_user.gold < cost {
        return Err(AppError::business(BusinessError::InsufficientGold));
    }

    let learner_profile = LearnerProfileSnapshot::from_user(&existing_user);
    let new_gold = existing_user.gold - cost;
    let mut active_user: user::ActiveModel = existing_user.clone().into();
    active_user.gold = Set(new_gold);
    active_user.updated_at = Set(now);
    active_user.update(&tx).await?;
    asset_transaction::record(
        &tx,
        existing_user.id,
        GOLD,
        -cost,
        new_gold,
        "生成独立知识解析",
    )
    .await?;

    let record = knowledge_explanation::ActiveModel {
        user_id: Set(auth_user.user_id),
        status: Set(knowledge_explanation::KnowledgeExplanationStatus::Queuing),
        prompt: Set(payload.prompt.clone()),
        content: Set(None),
        public: Set(payload.public),
        bookmarked: Set(false),
        bookmarked_at: Set(None),
        cost: Set(cost),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&tx)
    .await?;

    tx.commit().await?;

    let request = KnowledgeExplanationGenerateRequest {
        task_id: record.id,
        prompt: payload.prompt,
        learner_profile,
    };
    if let Err(err) = dispatch_payload(
        state.publisher.as_ref(),
        &state.config.knowledge_explanation_exchange,
        &request,
    )
    .await
    {
        let tx = state.db.begin().await?;
        let mut active: knowledge_explanation::ActiveModel = record.clone().into();
        active.status = Set(knowledge_explanation::KnowledgeExplanationStatus::Failed);
        active.updated_at = Set(Utc::now());
        active.update(&tx).await?;

        let refund_user = user::Entity::find_by_id(auth_user.user_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
        let new_gold = refund_user.gold + cost;
        let mut active_user: user::ActiveModel = refund_user.clone().into();
        active_user.gold = Set(new_gold);
        active_user.updated_at = Set(Utc::now());
        active_user.update(&tx).await?;
        asset_transaction::record(
            &tx,
            refund_user.id,
            GOLD,
            cost,
            new_gold,
            "知识解析生成失败退款",
        )
        .await?;

        tx.commit().await?;
        return Err(err);
    }

    Ok(created(KnowledgeExplanationView::from(record)))
}

pub async fn get_by_id(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let record = knowledge_explanation::Entity::find_by_id(id)
        .filter(knowledge_explanation::Column::UserId.eq(auth_user.user_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    Ok(ok(KnowledgeExplanationView::from(record)))
}

#[derive(Debug, Deserialize)]
pub struct UpdateRequest {
    pub public: Option<bool>,
    #[serde(default)]
    pub retry: bool,
}

pub async fn update(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let now = Utc::now();
    let tx = state.db.begin().await?;

    let record = knowledge_explanation::Entity::find_by_id(id)
        .filter(knowledge_explanation::Column::UserId.eq(auth_user.user_id))
        .one(&tx)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;

    let mut active: knowledge_explanation::ActiveModel = record.clone().into();
    let mut changed = false;

    if let Some(public) = payload.public {
        active.public = Set(public);
        changed = true;
    }

    if payload.retry {
        if record.status != knowledge_explanation::KnowledgeExplanationStatus::Failed {
            return Err(AppError::business(BusinessError::InvalidContentStatus));
        }

        let cost = state.config.knowledge_explanation_gold_cost;
        let existing_user = user::Entity::find_by_id(auth_user.user_id)
            .one(&tx)
            .await?
            .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;

        if existing_user.gold < cost {
            return Err(AppError::business(BusinessError::InsufficientGold));
        }

        let new_gold = existing_user.gold - cost;
        let mut active_user: user::ActiveModel = existing_user.clone().into();
        active_user.gold = Set(new_gold);
        active_user.updated_at = Set(now);
        active_user.update(&tx).await?;
        asset_transaction::record(
            &tx,
            existing_user.id,
            GOLD,
            -cost,
            new_gold,
            "重新生成知识解析",
        )
        .await?;

        active.status = Set(knowledge_explanation::KnowledgeExplanationStatus::Queuing);
        active.content = Set(None);
        active.cost = Set(cost);
        changed = true;
    }

    if changed {
        active.updated_at = Set(now);
        let updated = active.update(&tx).await?;
        tx.commit().await?;

        if payload.retry {
            let user = user::Entity::find_by_id(auth_user.user_id)
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
            let request = KnowledgeExplanationGenerateRequest {
                task_id: updated.id,
                prompt: updated.prompt.clone(),
                learner_profile: LearnerProfileSnapshot::from_user(&user),
            };
            if let Err(err) = dispatch_payload(
                state.publisher.as_ref(),
                &state.config.knowledge_explanation_exchange,
                &request,
            )
            .await
            {
                let tx = state.db.begin().await?;
                let mut active: knowledge_explanation::ActiveModel = updated.clone().into();
                active.status = Set(knowledge_explanation::KnowledgeExplanationStatus::Failed);
                active.updated_at = Set(Utc::now());
                active.update(&tx).await?;

                let cost = state.config.knowledge_explanation_gold_cost;
                let refund_user = user::Entity::find_by_id(auth_user.user_id)
                    .one(&tx)
                    .await?
                    .ok_or_else(|| AppError::business(BusinessError::UserNotFound))?;
                let new_gold = refund_user.gold + cost;
                let mut active_user: user::ActiveModel = refund_user.clone().into();
                active_user.gold = Set(new_gold);
                active_user.updated_at = Set(Utc::now());
                active_user.update(&tx).await?;
                asset_transaction::record(
                    &tx,
                    refund_user.id,
                    GOLD,
                    cost,
                    new_gold,
                    "知识解析生成失败退款",
                )
                .await?;

                tx.commit().await?;
                return Err(err);
            }
        }

        Ok(ok(KnowledgeExplanationView::from(updated)))
    } else {
        tx.commit().await?;
        Ok(ok(KnowledgeExplanationView::from(record)))
    }
}

/// PATCH /api/v1/knowledge-explanations/{id}/bookmark
pub async fn toggle_bookmark(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let record = knowledge_explanation::Entity::find_by_id(id)
        .filter(knowledge_explanation::Column::UserId.eq(auth_user.user_id))
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::business(BusinessError::ContentNotFound))?;
    let bookmarked = !record.bookmarked;
    let mut active: knowledge_explanation::ActiveModel = record.into();
    active.bookmarked = Set(bookmarked);
    active.bookmarked_at = Set(bookmarked.then(Utc::now));
    active.updated_at = Set(Utc::now());
    active.update(&state.db).await?;
    Ok(ok(serde_json::json!({"bookmarked": bookmarked})))
}
