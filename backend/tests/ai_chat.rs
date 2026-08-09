mod common;

use axum::http::StatusCode;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::json;
use zhiying_backend::entities::user;

use common::TestApp;

#[tokio::test]
async fn ai_chat_history_is_persisted_and_idempotent() {
    let app = TestApp::new().await;
    let token = app.create_user_and_login("chat_owner", "password123").await;

    let (status, _) = app
        .request(
            "GET",
            "/api/v1/me/ai-chat/messages?scope=general&conversation_id=conversation-a",
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let messages = json!({
        "scope": {"type": "general"},
        "conversation_id": "conversation-a",
        "messages": [
            {"id": "client-user-1", "role": "user", "content": "什么是 PostgreSQL？", "created_at": 1},
            {"id": "client-assistant-1", "role": "assistant", "content": "PostgreSQL 是关系型数据库。", "created_at": 2}
        ]
    });
    let (status, body) = app
        .request(
            "POST",
            "/api/v1/me/ai-chat/messages",
            Some(&token),
            Some(messages.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["saved"], true);

    // Retrying the same request must not duplicate messages.
    let (status, _) = app
        .request(
            "POST",
            "/api/v1/me/ai-chat/messages",
            Some(&token),
            Some(messages),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = app
        .request(
            "GET",
            "/api/v1/me/ai-chat/messages?scope=general&conversation_id=conversation-a",
            Some(&token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let history = body["data"]["messages"].as_array().unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0]["id"], "client-user-1");
    assert_eq!(history[1]["role"], "assistant");
    assert!(history[0]["created_at"].is_number());

    let (status, body) = app
        .request(
            "GET",
            "/api/v1/me/ai-chat/conversations?scope=general",
            Some(&token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let conversations = body["data"]["conversations"].as_array().unwrap();
    assert_eq!(conversations.len(), 1);
    assert_eq!(conversations[0]["id"], "conversation-a");
    assert_eq!(conversations[0]["title"], "什么是 PostgreSQL？");
    assert_eq!(conversations[0]["message_count"], 2);
}

#[tokio::test]
async fn ai_chat_history_is_isolated_between_users_and_can_be_cleared() {
    let app = TestApp::new().await;
    let owner_token = app
        .create_user_and_login("chat_owner_2", "password123")
        .await;
    let other_token = app
        .create_user_and_login("chat_other_2", "password123")
        .await;

    let (status, _) = app
        .request(
            "POST",
            "/api/v1/me/ai-chat/messages",
            Some(&owner_token),
            Some(json!({
                "scope": {"type": "general"},
                "conversation_id": "owner-conversation",
                "messages": [{"id": "owner-only", "role": "user", "content": "只属于第一个用户"}]
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = app
        .request(
            "GET",
            "/api/v1/me/ai-chat/messages?scope=general&conversation_id=owner-conversation",
            Some(&other_token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["data"]["messages"].as_array().unwrap().is_empty());

    let (status, _) = app
        .request(
            "POST",
            "/api/v1/me/ai-chat/messages",
            Some(&owner_token),
            Some(json!({
                "scope": {"type": "general"},
                "conversation_id": "kept-conversation",
                "messages": [{"id": "kept-message", "role": "user", "content": "这段对话应继续保留"}]
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = app
        .request(
            "DELETE",
            "/api/v1/me/ai-chat/messages?scope=general&conversation_id=owner-conversation",
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["deleted"], 1);

    let (status, body) = app
        .request(
            "GET",
            "/api/v1/me/ai-chat/messages?scope=general&conversation_id=kept-conversation",
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["messages"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn task_chat_history_requires_owned_task_scope() {
    let app = TestApp::new().await;
    let owner_token = app
        .create_user_and_login("chat_task_owner", "password123")
        .await;
    let other_token = app
        .create_user_and_login("chat_task_other", "password123")
        .await;
    let db = app.db().await;
    let owner_id = user::Entity::find()
        .filter(user::Column::Username.eq("chat_task_owner"))
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .id;
    let (_, _, task_ids) = app.insert_study_subject_with_plan(owner_id, 1, 1).await;
    let task_id = task_ids[0][0];

    let path = format!(
        "/api/v1/me/ai-chat/messages?scope=task&task_id={task_id}&conversation_id=task-conversation"
    );
    let (status, _) = app.request("GET", &path, Some(&other_token), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = app
        .request(
            "POST",
            "/api/v1/me/ai-chat/messages",
            Some(&owner_token),
            Some(json!({
                "scope": {"type": "task", "task_id": task_id},
                "conversation_id": "task-conversation",
                "messages": [{"id": "task-message", "role": "user", "content": "解释当前任务"}]
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
}
