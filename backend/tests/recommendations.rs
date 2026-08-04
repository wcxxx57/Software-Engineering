mod common;

use axum::http::StatusCode;
use chrono::Utc;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use zhiying_backend::entities::{
    chat_question, code_video, curriculum_node, curriculum_template, knowledge_video,
    recommendation_resource, recommendation_resource_learning, study_stage, study_subject,
    study_task, user, user_code_video_link, user_knowledge_video_link,
};

use common::TestApp;

async fn published_node(app: &TestApp) -> (i32, i32) {
    let db = app.db().await;
    let template = curriculum_template::Entity::find()
        .filter(curriculum_template::Column::Status.eq(curriculum_template::CurriculumTemplateStatus::Published))
        .one(&db)
        .await
        .expect("query curriculum template")
        .expect("seeded published curriculum template");
    let node = curriculum_node::Entity::find()
        .filter(curriculum_node::Column::CurriculumTemplateId.eq(template.id))
        .order_by_asc(curriculum_node::Column::SortOrder)
        .one(&db)
        .await
        .expect("query curriculum node")
        .expect("seeded curriculum node");
    (template.id, node.id)
}

async fn insert_task(app: &TestApp, user_id: i32, template_id: i32, node_id: i32) -> (i32, i32) {
    let db = app.db().await;
    let now = Utc::now();
    let subject = study_subject::ActiveModel {
        user_id: Set(user_id),
        subject: Set("推荐测试主题".to_owned()),
        status: Set(study_subject::StudySubjectStatus::Studying),
        total_stages: Set(1),
        finished_stages: Set(0),
        diamond_cost: Set(10),
        language: Set("PYTHON".to_owned()),
        target: Set("理解树结构".to_owned()),
        curriculum_template_id: Set(Some(template_id)),
        failure_code: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&db)
    .await
    .expect("insert study subject");
    let stage = study_stage::ActiveModel {
        study_subject_id: Set(subject.id),
        title: Set("树结构".to_owned()),
        description: Set("学习树结构".to_owned()),
        sort_order: Set(0),
        status: Set(study_stage::StudyStageStatus::Studying),
        total_tasks: Set(1),
        finished_tasks: Set(0),
        created_at: Set(now),
        ..Default::default()
    }
    .insert(&db)
    .await
    .expect("insert study stage");
    let task = study_task::ActiveModel {
        study_stage_id: Set(stage.id),
        curriculum_node_id: Set(Some(node_id)),
        day_index: Set(Some(1)),
        title: Set("二叉搜索树".to_owned()),
        description: Set("学习查找与插入".to_owned()),
        sort_order: Set(0),
        status: Set(study_task::StudyTaskStatus::Studying),
        knowledge_video_id: Set(None),
        interactive_html_id: Set(None),
        knowledge_explanation_id: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&db)
    .await
    .expect("insert study task");
    (subject.id, task.id)
}

#[tokio::test]
async fn task_recommendations_filter_and_count_unique_learners() {
    let app = TestApp::new().await;
    let token = app.create_user_and_login("recommend_owner", "password123").await;
    let _other_token = app.create_user_and_login("recommend_viewer", "password123").await;
    let db = app.db().await;
    let owner_id = user::Entity::find()
        .filter(user::Column::Username.eq("recommend_owner"))
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .id;
    let viewer_id = user::Entity::find()
        .filter(user::Column::Username.eq("recommend_viewer"))
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .id;
    let (template_id, node_id) = published_node(&app).await;
    let (_subject_id, task_id) = insert_task(&app, owner_id, template_id, node_id).await;
    let now = Utc::now();
    let video = knowledge_video::ActiveModel {
        status: Set(knowledge_video::KnowledgeVideoStatus::Finished),
        prompt: Set("二叉搜索树查找与插入".to_owned()),
        object_key: Set(Some("knowledge-videos/recommendation.mp4".to_owned())),
        public: Set(true),
        bookmarked: Set(false),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&db)
    .await
    .unwrap();
    user_knowledge_video_link::ActiveModel {
        knowledge_video_id: Set(video.id),
        user_id: Set(viewer_id),
        created_at: Set(now),
    }
    .insert(&db)
    .await
    .unwrap();
    let catalog = recommendation_resource::ActiveModel {
        resource_kind: Set(recommendation_resource::RecommendationResourceKind::KnowledgeVideo),
        resource_id: Set(video.id),
        curriculum_node_id: Set(Some(node_id)),
        creator_user_id: Set(Some(viewer_id)),
        title: Set("二叉搜索树查找与插入".to_owned()),
        summary: Set("用视频理解查找路径。".to_owned()),
        quality_status: Set(recommendation_resource::RecommendationQualityStatus::Pending),
        featured: Set(false),
        display_priority: Set(0),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&db)
    .await
    .unwrap();
    for user_id in [owner_id, viewer_id] {
        recommendation_resource_learning::ActiveModel {
            recommendation_resource_id: Set(catalog.id),
            user_id: Set(user_id),
            first_opened_at: Set(now),
            ..Default::default()
        }
        .insert(&db)
        .await
        .unwrap();
    }

    let (status, body) = app
        .request(
            "GET",
            &format!("/api/v1/study-tasks/{task_id}/recommendations"),
            Some(&token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["eligible"], true);
    assert_eq!(body["data"]["resources"]["knowledge_video"].as_array().unwrap().len(), 1);
    assert_eq!(body["data"]["resources"]["knowledge_video"][0]["catalog_id"], catalog.id);
    assert_eq!(body["data"]["resources"]["knowledge_video"][0]["learner_count"], 2);
}

#[tokio::test]
async fn featured_code_video_is_playable_by_non_owner_and_open_is_idempotent() {
    let app = TestApp::new().await;
    let token = app.create_user_and_login("featured_viewer", "password123").await;
    let owner_token = app.create_user_and_login("featured_owner", "password123").await;
    let db = app.db().await;
    let owner_id = user::Entity::find()
        .filter(user::Column::Username.eq("featured_owner"))
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .id;
    let now = Utc::now();
    let video = code_video::ActiveModel {
        status: Set(code_video::CodeVideoStatus::Finished),
        prompt: Set("二分查找边界处理".to_owned()),
        object_key: Set(Some("code-videos/featured.mp4".to_owned())),
        public: Set(true),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&db)
    .await
    .unwrap();
    user_code_video_link::ActiveModel {
        code_video_id: Set(video.id),
        user_id: Set(owner_id),
        created_at: Set(now),
    }
    .insert(&db)
    .await
    .unwrap();
    let catalog = recommendation_resource::ActiveModel {
        resource_kind: Set(recommendation_resource::RecommendationResourceKind::CodeVideo),
        resource_id: Set(video.id),
        curriculum_node_id: Set(None),
        creator_user_id: Set(Some(owner_id)),
        title: Set("二分查找边界处理".to_owned()),
        summary: Set("跟随代码执行理解边界更新。".to_owned()),
        quality_status: Set(recommendation_resource::RecommendationQualityStatus::Passed),
        featured: Set(true),
        display_priority: Set(1),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&db)
    .await
    .unwrap();

    let (status, body) = app
        .request("GET", "/api/v1/recommendations/featured?kind=code-video", Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"][0]["catalog_id"], catalog.id);

    let (status, _) = app
        .request("GET", &format!("/api/v1/code-videos/{}", video.id), Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    for _ in 0..2 {
        let (status, body) = app
            .request("POST", &format!("/api/v1/recommendation-resources/{}/open", catalog.id), Some(&token), None)
            .await;
        assert_eq!(status, StatusCode::CREATED, "open response: {body}");
    }
    let opens = recommendation_resource_learning::Entity::find()
        .filter(recommendation_resource_learning::Column::RecommendationResourceId.eq(catalog.id))
        .filter(recommendation_resource_learning::Column::UserId.eq(
            user::Entity::find().filter(user::Column::Username.eq("featured_viewer")).one(&db).await.unwrap().unwrap().id,
        ))
        .all(&db)
        .await
        .unwrap();
    assert_eq!(opens.len(), 1);
    let _ = owner_token;
}

#[tokio::test]
async fn non_owner_cannot_open_catalogued_resource_without_object_key() {
    let app = TestApp::new().await;
    let viewer_token = app
        .create_user_and_login("empty_resource_viewer", "password123")
        .await;
    let _owner_token = app
        .create_user_and_login("empty_resource_owner", "password123")
        .await;
    let db = app.db().await;
    let owner_id = user::Entity::find()
        .filter(user::Column::Username.eq("empty_resource_owner"))
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .id;
    let (_template_id, node_id) = published_node(&app).await;
    let now = Utc::now();
    let video = knowledge_video::ActiveModel {
        status: Set(knowledge_video::KnowledgeVideoStatus::Finished),
        prompt: Set("空对象键测试".to_owned()),
        object_key: Set(Some("   ".to_owned())),
        public: Set(true),
        bookmarked: Set(false),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&db)
    .await
    .unwrap();
    user_knowledge_video_link::ActiveModel {
        knowledge_video_id: Set(video.id),
        user_id: Set(owner_id),
        created_at: Set(now),
    }
    .insert(&db)
    .await
    .unwrap();
    let catalog = recommendation_resource::ActiveModel {
        resource_kind: Set(recommendation_resource::RecommendationResourceKind::KnowledgeVideo),
        resource_id: Set(video.id),
        curriculum_node_id: Set(Some(node_id)),
        creator_user_id: Set(Some(owner_id)),
        title: Set("空对象键测试".to_owned()),
        summary: Set("不可打开的资源不应被推荐。".to_owned()),
        quality_status: Set(recommendation_resource::RecommendationQualityStatus::Pending),
        featured: Set(false),
        display_priority: Set(0),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&db)
    .await
    .unwrap();

    let (status, _) = app
        .request(
            "GET",
            &format!("/api/v1/knowledge-videos/{}", video.id),
            Some(&viewer_token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .request(
            "POST",
            &format!("/api/v1/recommendation-resources/{}/open", catalog.id),
            Some(&viewer_token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn chat_context_hides_single_user_questions_and_returns_suggestions() {
    let app = TestApp::new().await;
    let token = app.create_user_and_login("chat_user_one", "password123").await;
    let _second_token = app.create_user_and_login("chat_user_two", "password123").await;
    let db = app.db().await;
    let user_one = user::Entity::find().filter(user::Column::Username.eq("chat_user_one")).one(&db).await.unwrap().unwrap().id;
    let user_two = user::Entity::find().filter(user::Column::Username.eq("chat_user_two")).one(&db).await.unwrap().unwrap().id;
    let (template_id, node_id) = published_node(&app).await;
    let (_subject_id, task_id) = insert_task(&app, user_one, template_id, node_id).await;
    let now = Utc::now();
    for (user_id, question) in [(user_one, "二叉搜索树删除两个子节点怎么办？"), (user_two, "删除两个子节点怎么处理？"), (user_one, "只有我自己看到的问题") ] {
        chat_question::ActiveModel {
            study_task_id: Set(task_id),
            curriculum_node_id: Set(Some(node_id)),
            user_id: Set(user_id),
            question: Set(question.to_owned()),
            normalized_question: Set(question.replace('？', "").replace('?', "").replace(' ', "").to_lowercase()),
            created_at: Set(now),
            ..Default::default()
        }
        .insert(&db)
        .await
        .unwrap();
    }
    let (status, body) = app
        .request("GET", &format!("/api/v1/study-tasks/{task_id}/chat-context"), Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(!body["data"]["suggested_questions"].as_array().unwrap().is_empty());
    let popular = body["data"]["popular_questions"].as_array().unwrap();
    assert_eq!(popular.len(), 1);
    assert_eq!(popular[0]["learner_count"], 2);
}

#[tokio::test]
async fn plan_recommendations_are_gated_and_reuse_one_draft_per_state() {
    let app = TestApp::new().await;
    let token = app
        .create_user_and_login("plan_recommendation_user", "password123")
        .await;
    let db = app.db().await;
    let user_id = user::Entity::find()
        .filter(user::Column::Username.eq("plan_recommendation_user"))
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .id;
    let (template_id, _) = published_node(&app).await;
    let template = curriculum_template::Entity::find_by_id(template_id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let now = Utc::now();

    let initial = study_subject::ActiveModel {
        user_id: Set(user_id),
        subject: Set("Python 基础".to_owned()),
        status: Set(study_subject::StudySubjectStatus::PretestReady),
        total_stages: Set(2),
        finished_stages: Set(0),
        diamond_cost: Set(10),
        language: Set(template.language.clone()),
        target: Set("掌握基础语法".to_owned()),
        curriculum_template_id: Set(Some(template_id)),
        failure_code: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&db)
    .await
    .unwrap();

    let (status, first_body) = app
        .request(
            "GET",
            &format!("/api/v1/study-subjects/{}/plan-recommendation", initial.id),
            Some(&token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let draft_id = first_body["data"]["id"].as_i64().unwrap();
    assert!(first_body["data"]["stage_count"].as_i64().unwrap() >= 1);

    let (status, second_body) = app
        .request(
            "GET",
            &format!("/api/v1/study-subjects/{}/plan-recommendation", initial.id),
            Some(&token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(second_body["data"]["id"].as_i64().unwrap(), draft_id);

    let (status, _) = app
        .request(
            "GET",
            &format!("/api/v1/study-subjects/{}/next-plan-recommendation", initial.id),
            Some(&token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let finished = study_subject::ActiveModel {
        user_id: Set(user_id),
        subject: Set("Python 基础".to_owned()),
        status: Set(study_subject::StudySubjectStatus::Finished),
        total_stages: Set(2),
        finished_stages: Set(2),
        diamond_cost: Set(10),
        language: Set(template.language),
        target: Set("掌握基础语法".to_owned()),
        curriculum_template_id: Set(Some(template_id)),
        failure_code: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&db)
    .await
    .unwrap();

    let (status, next_body) = app
        .request(
            "GET",
            &format!("/api/v1/study-subjects/{}/next-plan-recommendation", finished.id),
            Some(&token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_ne!(next_body["data"]["id"].as_i64().unwrap(), draft_id);
    assert!(next_body["data"]["task_count"].as_i64().unwrap() >= 1);
}
