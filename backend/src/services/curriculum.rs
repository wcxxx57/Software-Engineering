use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseConnection,
    EntityTrait, QueryFilter, QueryOrder, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    entities::{curriculum_node, curriculum_source, curriculum_template},
    error::AppError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutlineNode {
    pub node_key: String,
    pub parent_node_key: Option<String>,
    pub title: String,
    pub description: String,
    pub depth: i32,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutlineSnapshot {
    pub template_id: i32,
    pub canonical_name: String,
    pub version: i32,
    pub sources: Vec<OutlineSource>,
    pub nodes: Vec<OutlineNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutlineSource {
    pub platform: String,
    pub institution: String,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurriculumTemplateSummary {
    pub template_id: i32,
    pub canonical_name: String,
    pub version: i32,
    pub language: String,
    pub aliases: Vec<String>,
    pub knowledge_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcquiredCurriculum {
    pub canonical_name: String,
    pub slug: String,
    pub language: String,
    pub aliases: Vec<String>,
    pub platform: String,
    pub institution: String,
    pub instructor: Option<String>,
    pub source_url: String,
    pub content_hash: String,
    pub raw_outline: String,
    pub match_score: f64,
    pub nodes: Vec<OutlineNode>,
}

struct CatalogEntry {
    name: &'static str,
    slug: &'static str,
    language: &'static str,
    aliases: &'static [&'static str],
    topics: &'static [&'static str],
}

const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        name: "Python 语言基础",
        slug: "python-basics",
        language: "PYTHON",
        aliases: &[
            "python",
            "python基础",
            "python入门",
            "零基础学python",
            "python basics",
        ],
        topics: &[
            "开发环境与程序结构",
            "变量、类型与运算",
            "分支与循环",
            "函数与模块",
            "容器与文件处理",
        ],
    },
    CatalogEntry {
        name: "Python 进阶与项目实践",
        slug: "python-advanced",
        language: "PYTHON",
        aliases: &["python进阶", "python项目", "python高级", "python工程实践"],
        topics: &[
            "面向对象设计",
            "异常与测试",
            "迭代器与生成器",
            "并发与异步",
            "项目组织与发布",
        ],
    },
    CatalogEntry {
        name: "Java 语言基础",
        slug: "java-basics",
        language: "JAVA",
        aliases: &[
            "java",
            "java基础",
            "java入门",
            "零基础学java",
            "java basics",
        ],
        topics: &[
            "开发环境与基本语法",
            "类型与运算",
            "流程控制",
            "数组与字符串",
            "类与对象基础",
        ],
    },
    CatalogEntry {
        name: "Java 面向对象与项目实践",
        slug: "java-advanced",
        language: "JAVA",
        aliases: &["java进阶", "java面向对象", "java项目", "java高级"],
        topics: &[
            "封装、继承与多态",
            "集合与泛型",
            "异常与测试",
            "并发编程",
            "工程构建与项目实践",
        ],
    },
    CatalogEntry {
        name: "C++ 语言基础",
        slug: "cpp-basics",
        language: "CPP",
        aliases: &["c++", "cpp", "c++基础", "c++入门", "cpp basics"],
        topics: &[
            "编译环境与程序结构",
            "类型、指针与引用",
            "流程控制",
            "函数与作用域",
            "类与对象基础",
        ],
    },
    CatalogEntry {
        name: "C++ STL 与项目实践",
        slug: "cpp-advanced",
        language: "CPP",
        aliases: &["c++进阶", "cpp进阶", "c++ stl", "c++项目"],
        topics: &[
            "对象生命周期",
            "模板与泛型",
            "STL容器",
            "算法与迭代器",
            "现代C++工程实践",
        ],
    },
    CatalogEntry {
        name: "Go 语言基础",
        slug: "go-basics",
        language: "GO",
        aliases: &["golang", "go语言", "go基础", "go入门", "golang basics"],
        topics: &[
            "工具链与程序结构",
            "类型与控制流",
            "函数与错误处理",
            "结构体与接口",
            "包与测试",
        ],
    },
    CatalogEntry {
        name: "Go 并发与服务开发",
        slug: "go-advanced",
        language: "GO",
        aliases: &["go进阶", "golang进阶", "go并发", "go服务开发"],
        topics: &[
            "Goroutine",
            "Channel与同步",
            "Context与错误传播",
            "HTTP服务",
            "工程化与性能分析",
        ],
    },
    CatalogEntry {
        name: "Rust 语言基础",
        slug: "rust-basics",
        language: "RUST",
        aliases: &[
            "rust",
            "rust基础",
            "rust入门",
            "零基础学rust",
            "rust basics",
        ],
        topics: &[
            "工具链与基本语法",
            "所有权与借用",
            "结构体与枚举",
            "模式匹配",
            "错误处理与模块",
        ],
    },
    CatalogEntry {
        name: "Rust 所有权、并发与项目实践",
        slug: "rust-advanced",
        language: "RUST",
        aliases: &["rust进阶", "rust并发", "rust项目", "rust高级"],
        topics: &[
            "生命周期",
            "Trait与泛型",
            "智能指针",
            "无畏并发",
            "Cargo工程与测试",
        ],
    },
    CatalogEntry {
        name: "数据结构与算法",
        slug: "data-structures-algorithms",
        language: "GENERAL",
        aliases: &["数据结构", "算法", "数据结构与算法", "dsa"],
        topics: &[
            "复杂度分析",
            "线性表、栈与队列",
            "树与图",
            "查找与排序",
            "动态规划与贪心",
        ],
    },
    CatalogEntry {
        name: "计算机网络",
        slug: "computer-networks",
        language: "GENERAL",
        aliases: &["计算机网络", "网络原理", "computer networks"],
        topics: &[
            "网络体系结构",
            "数据链路层",
            "网络层与路由",
            "传输层",
            "应用层与网络安全",
        ],
    },
    CatalogEntry {
        name: "操作系统",
        slug: "operating-systems",
        language: "GENERAL",
        aliases: &["操作系统", "os原理", "operating systems"],
        topics: &[
            "进程与线程",
            "调度与同步",
            "内存管理",
            "文件系统",
            "I/O与虚拟化",
        ],
    },
    CatalogEntry {
        name: "数据库原理",
        slug: "database-systems",
        language: "GENERAL",
        aliases: &["数据库", "数据库原理", "database", "sql原理"],
        topics: &[
            "关系模型",
            "SQL与关系代数",
            "数据库设计",
            "事务与并发控制",
            "索引与查询优化",
        ],
    },
    CatalogEntry {
        name: "计算机组成原理",
        slug: "computer-organization",
        language: "GENERAL",
        aliases: &["计算机组成", "计算机组成原理", "计算机体系结构"],
        topics: &[
            "数据表示与运算",
            "指令系统",
            "处理器",
            "存储层次",
            "总线与输入输出",
        ],
    },
    CatalogEntry {
        name: "软件工程",
        slug: "software-engineering",
        language: "GENERAL",
        aliases: &["软件工程", "软件开发流程", "software engineering"],
        topics: &[
            "需求工程",
            "软件设计",
            "版本管理与协作",
            "测试与质量保障",
            "部署、维护与演化",
        ],
    },
];

pub async fn seed_catalog(db: &DatabaseConnection) -> Result<(), sea_orm::DbErr> {
    let now = Utc::now();
    for entry in CATALOG {
        let exists = curriculum_template::Entity::find()
            .filter(curriculum_template::Column::Slug.eq(entry.slug))
            .filter(curriculum_template::Column::Version.eq(1))
            .one(db)
            .await?;
        if exists.is_some() {
            continue;
        }

        let tx = db.begin().await?;
        let template = curriculum_template::ActiveModel {
            canonical_name: Set(entry.name.to_owned()),
            slug: Set(entry.slug.to_owned()),
            version: Set(1),
            language: Set(entry.language.to_owned()),
            status: Set(curriculum_template::CurriculumTemplateStatus::Published),
            aliases: Set(json!(entry.aliases)),
            created_at: Set(now),
            published_at: Set(Some(now)),
            ..Default::default()
        }
        .insert(&tx)
        .await?;

        curriculum_source::ActiveModel {
            curriculum_template_id: Set(template.id),
            platform: Set("CURATED".to_owned()),
            institution: Set("智映通学课程组".to_owned()),
            instructor: Set(None),
            source_url: Set("https://www.icourse163.org/".to_owned()),
            content_hash: Set(format!("seed-{}-v1", entry.slug)),
            raw_outline: Set(entry.topics.join("\n")),
            validation_failures: Set(json!([])),
            match_score: Set(1.0),
            status: Set(curriculum_source::CurriculumSourceStatus::Published),
            captured_at: Set(now),
            ..Default::default()
        }
        .insert(&tx)
        .await?;

        curriculum_node::ActiveModel {
            curriculum_template_id: Set(template.id),
            node_key: Set("root".to_owned()),
            parent_node_key: Set(None),
            title: Set(entry.name.to_owned()),
            description: Set(format!("{}完整课程知识结构", entry.name)),
            depth: Set(0),
            sort_order: Set(0),
            ..Default::default()
        }
        .insert(&tx)
        .await?;
        for (index, topic) in entry.topics.iter().enumerate() {
            curriculum_node::ActiveModel {
                curriculum_template_id: Set(template.id),
                node_key: Set(format!("topic-{}", index + 1)),
                parent_node_key: Set(Some("root".to_owned())),
                title: Set((*topic).to_owned()),
                description: Set(format!("学习并掌握{topic}")),
                depth: Set(1),
                sort_order: Set((index + 1) as i32),
                ..Default::default()
            }
            .insert(&tx)
            .await?;
        }
        tx.commit().await?;
    }
    Ok(())
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Compatibility only for pre-migration subjects that already reached PRETEST_READY.
/// New subjects always use the curriculum worker's semantic AI selection.
pub async fn match_legacy_template<C: ConnectionTrait>(
    db: &C,
    subject: &str,
    language: &str,
) -> Result<Option<curriculum_template::Model>, sea_orm::DbErr> {
    let query = normalize(subject);
    let templates = curriculum_template::Entity::find()
        .filter(
            curriculum_template::Column::Status
                .eq(curriculum_template::CurriculumTemplateStatus::Published),
        )
        .order_by_desc(curriculum_template::Column::Version)
        .all(db)
        .await?;
    let mut best: Option<(usize, curriculum_template::Model)> = None;
    for template in templates {
        if template.language != "GENERAL" && template.language != language {
            continue;
        }
        let mut terms = vec![template.canonical_name.clone()];
        if let Some(aliases) = template.aliases.as_array() {
            terms.extend(aliases.iter().filter_map(|v| v.as_str().map(str::to_owned)));
        }
        let score = terms
            .into_iter()
            .map(|term| {
                let term = normalize(&term);
                if term.is_empty() {
                    0
                } else if query == term {
                    10_000 + term.len()
                } else if query.contains(&term) || term.contains(&query) {
                    term.len()
                } else {
                    0
                }
            })
            .max()
            .unwrap_or(0);
        if score > 0 && best.as_ref().is_none_or(|(current, _)| score > *current) {
            best = Some((score, template));
        }
    }
    Ok(best.map(|(_, template)| template))
}

pub async fn list_published_summaries(
    db: &DatabaseConnection,
) -> Result<Vec<CurriculumTemplateSummary>, sea_orm::DbErr> {
    let templates = curriculum_template::Entity::find()
        .filter(
            curriculum_template::Column::Status
                .eq(curriculum_template::CurriculumTemplateStatus::Published),
        )
        .order_by_asc(curriculum_template::Column::CanonicalName)
        .all(db)
        .await?;
    let mut summaries = Vec::with_capacity(templates.len());
    for template in templates {
        let knowledge_points = curriculum_node::Entity::find()
            .filter(curriculum_node::Column::CurriculumTemplateId.eq(template.id))
            .filter(curriculum_node::Column::Depth.gt(0))
            .order_by_asc(curriculum_node::Column::SortOrder)
            .all(db)
            .await?
            .into_iter()
            .map(|node| node.title)
            .collect();
        let aliases = template
            .aliases
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|value| value.as_str().map(str::to_owned))
            .collect();
        summaries.push(CurriculumTemplateSummary {
            template_id: template.id,
            canonical_name: template.canonical_name,
            version: template.version,
            language: template.language,
            aliases,
            knowledge_points,
        });
    }
    Ok(summaries)
}

pub async fn load_outline(
    db: &DatabaseConnection,
    template_id: i32,
) -> Result<OutlineSnapshot, AppError> {
    let template = curriculum_template::Entity::find_by_id(template_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::internal("curriculum template missing"))?;
    let nodes = curriculum_node::Entity::find()
        .filter(curriculum_node::Column::CurriculumTemplateId.eq(template_id))
        .order_by_asc(curriculum_node::Column::SortOrder)
        .all(db)
        .await?;
    let sources = curriculum_source::Entity::find()
        .filter(curriculum_source::Column::CurriculumTemplateId.eq(template_id))
        .filter(
            curriculum_source::Column::Status
                .eq(curriculum_source::CurriculumSourceStatus::Published),
        )
        .all(db)
        .await?;
    Ok(OutlineSnapshot {
        template_id,
        canonical_name: template.canonical_name,
        version: template.version,
        nodes: nodes
            .into_iter()
            .map(|node| OutlineNode {
                node_key: node.node_key,
                parent_node_key: node.parent_node_key,
                title: node.title,
                description: node.description,
                depth: node.depth,
                sort_order: node.sort_order,
            })
            .collect(),
        sources: sources
            .into_iter()
            .map(|source| OutlineSource {
                platform: source.platform,
                institution: source.institution,
                source_url: source.source_url,
            })
            .collect(),
    })
}

pub fn validate_generated(payload: &AcquiredCurriculum) -> Result<(), &'static str> {
    if payload.source_url != "ai://generated" || payload.platform != "AI_GENERATED" {
        return Err("CURRICULUM_SOURCE_INVALID");
    }
    if payload.canonical_name.trim().is_empty()
        || payload.platform.trim().is_empty()
        || payload.institution.trim().is_empty()
        || payload.raw_outline.trim().len() < 50
    {
        return Err("CURRICULUM_METADATA_INCOMPLETE");
    }
    let outline_lower = payload.raw_outline.to_lowercase();
    if !["课程大纲", "授课大纲", "教学大纲", "syllabus"]
        .iter()
        .any(|heading| outline_lower.contains(heading))
    {
        return Err("CURRICULUM_SYLLABUS_SECTION_MISSING");
    }
    if payload.nodes.len() < 6
        || payload.nodes.iter().filter(|node| node.depth == 0).count() != 1
        || !payload.nodes.iter().any(|node| node.depth > 0)
    {
        return Err("CURRICULUM_INCOMPLETE");
    }
    let by_key: std::collections::HashMap<_, _> = payload
        .nodes
        .iter()
        .map(|node| (node.node_key.as_str(), node))
        .collect();
    if by_key.len() != payload.nodes.len()
        || payload.nodes.iter().any(|node| {
            node.node_key.trim().is_empty()
                || node.title.trim().is_empty()
                || (node.depth == 0 && node.parent_node_key.is_some())
                || (node.depth > 0 && node.parent_node_key.is_none())
                || node
                    .parent_node_key
                    .as_ref()
                    .is_some_and(|parent| !by_key.contains_key(parent.as_str()))
                || node.parent_node_key.as_ref().is_some_and(|parent| {
                    by_key
                        .get(parent.as_str())
                        .is_some_and(|parent_node| parent_node.depth + 1 != node.depth)
                })
        })
    {
        return Err("CURRICULUM_INVALID_TREE");
    }
    for node in &payload.nodes {
        let mut seen = std::collections::HashSet::new();
        let mut current = Some(node);
        while let Some(candidate) = current {
            if !seen.insert(candidate.node_key.as_str()) {
                return Err("CURRICULUM_INVALID_TREE");
            }
            current = candidate
                .parent_node_key
                .as_ref()
                .and_then(|parent| by_key.get(parent.as_str()).copied());
        }
    }
    Ok(())
}

pub async fn persist_acquired(
    db: &DatabaseConnection,
    payload: &AcquiredCurriculum,
) -> Result<i32, AppError> {
    if let Some(existing) = curriculum_source::Entity::find()
        .filter(curriculum_source::Column::ContentHash.eq(&payload.content_hash))
        .one(db)
        .await?
    {
        return Ok(existing.curriculum_template_id);
    }
    let latest = curriculum_template::Entity::find()
        .filter(curriculum_template::Column::Slug.eq(&payload.slug))
        .order_by_desc(curriculum_template::Column::Version)
        .one(db)
        .await?;
    if let Some(template) = latest.as_ref().filter(|template| {
        template.status == curriculum_template::CurriculumTemplateStatus::Published
    }) {
        let existing_nodes = curriculum_node::Entity::find()
            .filter(curriculum_node::Column::CurriculumTemplateId.eq(template.id))
            .order_by_asc(curriculum_node::Column::SortOrder)
            .all(db)
            .await?;
        let existing_shape = existing_nodes
            .iter()
            .map(|node| {
                (
                    &node.node_key,
                    &node.parent_node_key,
                    &node.title,
                    node.depth,
                )
            })
            .collect::<Vec<_>>();
        let mut new_nodes = payload.nodes.iter().collect::<Vec<_>>();
        new_nodes.sort_by_key(|node| node.sort_order);
        let new_shape = new_nodes
            .into_iter()
            .map(|node| {
                (
                    &node.node_key,
                    &node.parent_node_key,
                    &node.title,
                    node.depth,
                )
            })
            .collect::<Vec<_>>();
        if existing_shape == new_shape {
            curriculum_source::ActiveModel {
                curriculum_template_id: Set(template.id),
                platform: Set(payload.platform.clone()),
                institution: Set(payload.institution.clone()),
                instructor: Set(payload.instructor.clone()),
                source_url: Set(payload.source_url.clone()),
                content_hash: Set(payload.content_hash.clone()),
                raw_outline: Set(payload.raw_outline.clone()),
                validation_failures: Set(json!([])),
                match_score: Set(payload.match_score),
                status: Set(curriculum_source::CurriculumSourceStatus::Published),
                captured_at: Set(Utc::now()),
                ..Default::default()
            }
            .insert(db)
            .await?;
            return Ok(template.id);
        }
    }
    let version = latest.map_or(1, |template| template.version + 1);
    let now = Utc::now();
    let tx = db.begin().await?;
    let template = curriculum_template::ActiveModel {
        canonical_name: Set(payload.canonical_name.clone()),
        slug: Set(payload.slug.clone()),
        version: Set(version),
        language: Set(payload.language.clone()),
        status: Set(curriculum_template::CurriculumTemplateStatus::Published),
        aliases: Set(json!(payload.aliases)),
        created_at: Set(now),
        published_at: Set(Some(now)),
        ..Default::default()
    }
    .insert(&tx)
    .await?;
    curriculum_source::ActiveModel {
        curriculum_template_id: Set(template.id),
        platform: Set(payload.platform.clone()),
        institution: Set(payload.institution.clone()),
        instructor: Set(payload.instructor.clone()),
        source_url: Set(payload.source_url.clone()),
        content_hash: Set(payload.content_hash.clone()),
        raw_outline: Set(payload.raw_outline.clone()),
        validation_failures: Set(json!([])),
        match_score: Set(payload.match_score),
        status: Set(curriculum_source::CurriculumSourceStatus::Published),
        captured_at: Set(now),
        ..Default::default()
    }
    .insert(&tx)
    .await?;
    for node in &payload.nodes {
        curriculum_node::ActiveModel {
            curriculum_template_id: Set(template.id),
            node_key: Set(node.node_key.clone()),
            parent_node_key: Set(node.parent_node_key.clone()),
            title: Set(node.title.clone()),
            description: Set(node.description.clone()),
            depth: Set(node.depth),
            sort_order: Set(node.sort_order),
            ..Default::default()
        }
        .insert(&tx)
        .await?;
    }
    tx.commit().await?;
    Ok(template.id)
}

pub async fn published_template_id_by_hash(
    db: &DatabaseConnection,
    content_hash: &str,
) -> Result<Option<i32>, sea_orm::DbErr> {
    let Some(source) = curriculum_source::Entity::find()
        .filter(curriculum_source::Column::ContentHash.eq(content_hash))
        .one(db)
        .await?
    else {
        return Ok(None);
    };
    let published = curriculum_template::Entity::find_by_id(source.curriculum_template_id)
        .filter(
            curriculum_template::Column::Status
                .eq(curriculum_template::CurriculumTemplateStatus::Published),
        )
        .one(db)
        .await?;
    Ok(published.map(|template| template.id))
}

pub async fn persist_pending_review(
    db: &DatabaseConnection,
    payload: &AcquiredCurriculum,
    failure_code: &str,
) -> Result<i32, AppError> {
    if let Some(existing) = curriculum_source::Entity::find()
        .filter(curriculum_source::Column::ContentHash.eq(&payload.content_hash))
        .one(db)
        .await?
    {
        return Ok(existing.curriculum_template_id);
    }

    let latest = curriculum_template::Entity::find()
        .filter(curriculum_template::Column::Slug.eq(&payload.slug))
        .order_by_desc(curriculum_template::Column::Version)
        .one(db)
        .await?;
    let version = latest.map_or(1, |template| template.version + 1);
    let now = Utc::now();
    let tx = db.begin().await?;
    let template = curriculum_template::ActiveModel {
        canonical_name: Set(payload.canonical_name.clone()),
        slug: Set(payload.slug.clone()),
        version: Set(version),
        language: Set(payload.language.clone()),
        status: Set(curriculum_template::CurriculumTemplateStatus::PendingReview),
        aliases: Set(json!(payload.aliases)),
        created_at: Set(now),
        published_at: Set(None),
        ..Default::default()
    }
    .insert(&tx)
    .await?;
    curriculum_source::ActiveModel {
        curriculum_template_id: Set(template.id),
        platform: Set(payload.platform.clone()),
        institution: Set(payload.institution.clone()),
        instructor: Set(payload.instructor.clone()),
        source_url: Set(payload.source_url.clone()),
        content_hash: Set(payload.content_hash.clone()),
        raw_outline: Set(payload.raw_outline.clone()),
        validation_failures: Set(json!([failure_code])),
        match_score: Set(payload.match_score),
        status: Set(curriculum_source::CurriculumSourceStatus::PendingReview),
        captured_at: Set(now),
        ..Default::default()
    }
    .insert(&tx)
    .await?;

    let mut seen = std::collections::HashSet::new();
    for node in &payload.nodes {
        if node.node_key.trim().is_empty()
            || node.title.trim().is_empty()
            || !seen.insert(node.node_key.as_str())
        {
            continue;
        }
        curriculum_node::ActiveModel {
            curriculum_template_id: Set(template.id),
            node_key: Set(node.node_key.clone()),
            parent_node_key: Set(node.parent_node_key.clone()),
            title: Set(node.title.clone()),
            description: Set(node.description.clone()),
            depth: Set(node.depth),
            sort_order: Set(node.sort_order),
            ..Default::default()
        }
        .insert(&tx)
        .await?;
    }
    tx.commit().await?;
    Ok(template.id)
}
