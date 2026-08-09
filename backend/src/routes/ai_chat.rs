use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use chrono::Utc;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, DatabaseConnection, DatabaseTransaction, DbErr, EntityTrait,
    QueryFilter, QueryOrder, QuerySelect, TransactionTrait, sea_query::OnConflict,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::AuthUser,
    entities::{ai_chat_message, study_stage, study_subject, study_task},
    error::{AppError, BusinessError},
    response::ok,
    state::AppState,
};

const MAX_HISTORY_MESSAGES: usize = 50;
const MAX_MESSAGE_ID_CHARS: usize = 128;
const MAX_MESSAGE_CHARS: usize = 4_000;

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub scope: Option<String>,
    pub task_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct HistoryRequest {
    #[serde(rename = "type")]
    pub scope_type: String,
    pub task_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct AppendMessagesRequest {
    pub scope: HistoryRequest,
    pub messages: Vec<ChatMessageInput>,
}

#[derive(Debug, Deserialize)]
pub struct ChatMessageInput {
    pub id: String,
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct HistoryView {
    pub messages: Vec<ChatMessageView>,
}

#[derive(Debug, Serialize)]
pub struct ChatMessageView {
    pub id: String,
    pub role: String,
    pub content: String,
    /// Unix milliseconds keep the browser contract numeric and avoid leaking
    /// a database-specific timestamp representation to the frontend.
    pub created_at: i64,
}

#[derive(Debug)]
struct ResolvedScope {
    key: String,
}

/// GET /api/v1/me/ai-chat/messages
pub async fn list_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<HistoryQuery>,
) -> Result<impl IntoResponse, AppError> {
    let scope = resolve_scope(&state, auth.user_id, query.scope.as_deref(), query.task_id).await?;
    Ok(ok(HistoryView {
        messages: load_history(&state.db, auth.user_id, &scope.key).await?,
    }))
}

/// POST /api/v1/me/ai-chat/messages
///
/// Messages are appended idempotently by client id. This supports retries and
/// a one-time migration from the old browser localStorage implementation.
pub async fn append_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<AppendMessagesRequest>,
) -> Result<impl IntoResponse, AppError> {
    if payload.messages.is_empty() || payload.messages.len() > MAX_HISTORY_MESSAGES {
        return Err(AppError::ValidationFailed);
    }
    for message in &payload.messages {
        validate_message(message)?;
    }

    let scope = resolve_scope(
        &state,
        auth.user_id,
        Some(payload.scope.scope_type.as_str()),
        payload.scope.task_id,
    )
    .await?;

    let transaction = state.db.begin().await?;
    for message in payload.messages {
        let insert_result = ai_chat_message::Entity::insert(ai_chat_message::ActiveModel {
            user_id: Set(auth.user_id),
            scope_key: Set(scope.key.clone()),
            client_message_id: Set(message.id.trim().to_owned()),
            role: Set(message.role),
            content: Set(message.content.trim().to_owned()),
            created_at: Set(Utc::now()),
            ..Default::default()
        })
        .on_conflict(
            OnConflict::columns([
                ai_chat_message::Column::UserId,
                ai_chat_message::Column::ScopeKey,
                ai_chat_message::Column::ClientMessageId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec(&transaction)
        .await;

        match insert_result {
            Ok(_) | Err(DbErr::RecordNotInserted) => {}
            Err(error) => return Err(error.into()),
        }
    }
    prune_history(&transaction, auth.user_id, &scope.key).await?;
    transaction.commit().await?;

    Ok(ok(serde_json::json!({
        "saved": true,
        "scope": scope.key,
    })))
}

/// DELETE /api/v1/me/ai-chat/messages
pub async fn clear_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<HistoryQuery>,
) -> Result<impl IntoResponse, AppError> {
    let scope = resolve_scope(&state, auth.user_id, query.scope.as_deref(), query.task_id).await?;
    let result = ai_chat_message::Entity::delete_many()
        .filter(ai_chat_message::Column::UserId.eq(auth.user_id))
        .filter(ai_chat_message::Column::ScopeKey.eq(scope.key))
        .exec(&state.db)
        .await?;
    Ok(ok(serde_json::json!({ "deleted": result.rows_affected })))
}

async fn resolve_scope(
    state: &AppState,
    user_id: i32,
    scope_type: Option<&str>,
    task_id: Option<i32>,
) -> Result<ResolvedScope, AppError> {
    match (scope_type, task_id) {
        (Some("general"), None) => Ok(ResolvedScope {
            key: "general".to_owned(),
        }),
        (Some("task"), Some(task_id)) if task_id > 0 => {
            let task = study_task::Entity::find_by_id(task_id)
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;
            let stage = study_stage::Entity::find_by_id(task.study_stage_id)
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;
            study_subject::Entity::find_by_id(stage.study_subject_id)
                .filter(study_subject::Column::UserId.eq(user_id))
                .one(&state.db)
                .await?
                .ok_or_else(|| AppError::business(BusinessError::TaskNotFound))?;
            Ok(ResolvedScope {
                key: format!("task:{task_id}"),
            })
        }
        _ => Err(AppError::ValidationFailed),
    }
}

fn validate_message(message: &ChatMessageInput) -> Result<(), AppError> {
    let id_len = message.id.trim().chars().count();
    let content = message.content.trim();
    if id_len == 0
        || id_len > MAX_MESSAGE_ID_CHARS
        || !matches!(message.role.as_str(), "user" | "assistant")
        || content.is_empty()
        || content.chars().count() > MAX_MESSAGE_CHARS
    {
        return Err(AppError::ValidationFailed);
    }
    Ok(())
}

async fn load_history(
    db: &DatabaseConnection,
    user_id: i32,
    scope_key: &str,
) -> Result<Vec<ChatMessageView>, AppError> {
    let rows = ai_chat_message::Entity::find()
        .filter(ai_chat_message::Column::UserId.eq(user_id))
        .filter(ai_chat_message::Column::ScopeKey.eq(scope_key))
        .order_by_desc(ai_chat_message::Column::Id)
        .limit(MAX_HISTORY_MESSAGES as u64)
        .all(db)
        .await?;
    Ok(rows
        .into_iter()
        .rev()
        .map(|message| ChatMessageView {
            id: message.client_message_id,
            role: message.role,
            content: message.content,
            created_at: message.created_at.timestamp_millis(),
        })
        .collect())
}

async fn prune_history(
    db: &DatabaseTransaction,
    user_id: i32,
    scope_key: &str,
) -> Result<(), AppError> {
    let rows = ai_chat_message::Entity::find()
        .filter(ai_chat_message::Column::UserId.eq(user_id))
        .filter(ai_chat_message::Column::ScopeKey.eq(scope_key))
        .order_by_desc(ai_chat_message::Column::Id)
        .all(db)
        .await?;
    if rows.len() <= MAX_HISTORY_MESSAGES {
        return Ok(());
    }
    let stale_ids = rows
        .into_iter()
        .skip(MAX_HISTORY_MESSAGES)
        .map(|message| message.id)
        .collect::<Vec<_>>();
    ai_chat_message::Entity::delete_many()
        .filter(ai_chat_message::Column::Id.is_in(stale_ids))
        .exec(db)
        .await?;
    Ok(())
}
