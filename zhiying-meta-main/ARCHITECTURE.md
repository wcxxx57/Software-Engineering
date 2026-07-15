# ARCHITECTURE

跨子仓库的技术全景与关键流程。本文件只承载**与代码强相关、不会因 PROGRESS 推进而失效**的内容；端口、命名约定、提交风格等放在本仓库与各子仓库 `AGENTS.md`。

> 数据模型字段、API 路径会随实现演进。本文件给出**形状与关系**，列名/路径请以 `zhiying-backend/src/entities/` 与 `src/routes/` 为准。

## 1. 分层与调用关系

```
┌─────────────────────────────────────────────────────────────┐
│              前端表现层  (Next.js 16 + React 19)            │
│  (auth) 登录注册 │ (app) Dashboard/错题本/设置 │ (learn) 沉浸学习  │
└──────────────────────────┬──────────────────────────────────┘
                           │  HTTP REST  /api/v1/*  (JWT)
┌──────────────────────────▼──────────────────────────────────┐
│             主后端业务层  (Rust Axum + Tokio + SeaORM)      │
│   用户 │ 签到 │ 学习主题/阶段/任务 │ 测验 │ 内容生成         │
│   ── 状态机 / 货币计费 / 退款 / 解锁链                      │
└──────┬─────────────────────────────────────────────┬────────┘
       │  RabbitMQ (dispatch)                        │  HTTP (callback)
       │  exchange=zhiying.{service}, rk=generate    │  /internal/*  (sk-* API Key)
┌──────▼─────────────────────────────────────────────┴────────┐
│                       微服务执行层                          │
│  K2V (Python/Manim) │ C2V (Python/Manim) │ HTML (Node.js)   │
│  knowledge_explanation (Node.js)                            │
│  pretest / plan / quiz  (Go + Gin)                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                       数据 / 资源层                         │
│  PostgreSQL（dev：zhiying-infra）│ SQLite/MySQL（兼容目标） │
│  对象存储（视频 / HTML / 思维导图等生成产物 URL）           │
└─────────────────────────────────────────────────────────────┘
```

7 组 RabbitMQ exchange/queue（dispatch）：`knowledge_video / code_video / interactive_html / knowledge_explanation / pretest / plan / quiz`，每组一个 direct exchange `zhiying.{service}` 绑定 queue `zhiying.{service}.generate`，routing key 固定 `generate`，`durable=true`，`delivery_mode=2`，启用 publisher confirm。

## 2. 数据模型概览

实体与归属关系（详细列定义见 `zhiying-backend/src/entities/`）：

```
User ──┬── UserCheckin                       (按日期联合主键)
       │
       ├── Problem                            (题目归属用户，A/B/C/D 选择题 + explanation + bookmarked)
       │
       ├── KnowledgeVideo / CodeVideo
       │   InteractiveHtml / KnowledgeExplanation
       │       (各自独立表，状态机 4 态，含 cost/url/public)
       │
       └── StudySubject                       (8 状态机，total_stages/finished_stages)
              │
              ├── PretestProblem ─→ Problem   (关联表：sort_order/confidence/chosen_answer)
              │
              └── StudyStage                  (3 状态机 Locked/Studying/Finished, sort_order)
                     │
                     └── StudyTask            (3 状态机, 关联 0/多 个生成内容)
                            │
                            └── StudyQuiz     (5 状态机, cost, total_problems/correct_problems)
                                   │
                                   └── StudyQuizProblem ─→ Problem
```

约定提示：

- 计数字段一律复数：`total_checkins / streak_checkins / total_stages / finished_tasks` 等。
- 业务唯一字段（如 `user.username`）必须在 DB 层加唯一约束。
- 题目归用户，`pretest_problem` / `study_quiz_problem` 是关联表，承载 `sort_order` 和作答信息（`confidence`、`chosen_answer`）。
- 资源所有权校验通过 JOIN 链回溯到 `study_subject.user_id`。
- 统计字段非规范化，状态变更时由后端维护。

文件存储约定：

- 生成产物上传至对象存储，回调里把 URL 写回对应记录的 `url`/`content` 字段。
- 命名建议：`knowledge-videos/{id}.mp4`、`code-videos/{id}.mp4`、`interactive-htmls/{id}.html`。

## 3. 学习主题状态机（8 态）

```
        创建主题（扣 10 钻）
            │
            ▼
     PretestQueuing ─────► PretestGenerating ─────► PretestReady
                                  │                      │ 用户作答完成 → 提交
                                  ▼                      ▼
                                Failed             PlanQueuing
                            （回调失败，退款）           │
                                                        ▼
                                            PlanGenerating ─────► Studying
                                                  │                  │ 所有阶段完成
                                                  ▼                  ▼
                                                Failed            Finished
                                            （回调失败，退款）
```

`PretestGenerating` 与 `PlanGenerating` 的回调通过微服务 API Key 区分来源（`sk-pretest-*` vs `sk-plan-*`），共用同一 `POST /internal/study-subjects/{id}` 端点。

## 4. 任务解锁链

阶段（StudyStage）与任务（StudyTask）各自 3 态：`Locked / Studying / Finished`，按 `sort_order` 强制顺序。

```
function completeTask(task):
    task.status = Finished
    stage = task.stage
    stage.finished_tasks += 1

    # 同阶段：解锁下一个任务
    next_task = findTask(stage, sort_order = task.sort_order + 1)
    if next_task: next_task.status = Studying

    # 跨阶段：当前阶段所有任务完成 → 阶段完成 → 解锁下一阶段首任务
    if stage.finished_tasks == stage.total_tasks:
        stage.status = Finished
        subject = stage.subject
        subject.finished_stages += 1

        if subject.finished_stages == subject.total_stages:
            subject.status = Finished
        else:
            next_stage = findStage(subject, sort_order = stage.sort_order + 1)
            next_stage.status = Studying
            findTask(next_stage, sort_order = 0).status = Studying
```

整段操作必须在事务内原子完成。

## 5. 内容生成异步流程

`knowledge_video` / `code_video` / `interactive_html` / `knowledge_explanation` 四类资源，状态机 `Queuing → Generating → Finished | Failed`：

```
用户请求 ──► 扣货币 ──► 创建记录(status=Queuing, cost=N)
                                │
                                ▼
                     基于 RabbitMQ publish (publisher confirm)
                                │
                  ┌─────────────┴─────────────┐
                  │ broker ack                │ nack / 连接失败
                  ▼                           ▼
              微服务异步处理               BusinessError::ServiceUnavailable
              ──► 回调 PATCH /internal/...     + 退款（事务内还原 cost）
                  ┌──────────┴──────────┐
                  ▼                     ▼
             FINISHED                FAILED
             写 url/content          按记录 cost 字段退款
```

主题流程（pretest/plan/quiz）走 `POST /internal/{resource}/{id}`，逻辑同构。

退款规则：金额一律读资源记录上的 `cost` 字段（不读配置常量），在事务内一次性把货币加回 `user`。

## 6. 货币与游戏化

| 货币 | 用途 |
|---|---|
| 钻石 Diamond | 知识点视频(5)、代码视频(5)、创建学习主题(10) |
| 金币 Gold | 交互式 HTML(10)、文字讲解(10)、额外小测(20) |

- 签到序列默认 `1, 2, 3, 4, 6, 8, 10` 金币，连续签到 7 天后循环（具体序列由后端 `/api/v1/config` 暴露，**前端不要硬编码**）。
- 小测每个任务前 3 次免费，第 4 次起按金币计价。
- EXP 经验值用于用户成长。

## 7. 认证

- 用户 → 后端：JWT Bearer，签发自 `POST /api/v1/tokens`，密码 Argon2 哈希。
- 微服务 → 后端：API Key Bearer，前缀 `sk-`，仅 callback 方向使用，由 `ServiceAuth` 提取器解析 `ServiceKind` 区分来源。dispatch 方向不带 API Key（rabbit 内部）。
- 前端：JWT 存 httpOnly cookie，由 `app/api/auth/*` route handler 代理，浏览器 JS 不接触 token。

## 8. 部署适配

- **后端**：编译为单二进制；启动时跑 SeaORM migration + `declare_topology`。HTTP 触发，可放 Serverless 函数。
- **微服务**：RabbitMQ 触发，天然适合 Serverless 弹性伸缩。
- **前端**：Next.js 静态/SSR，CDN 友好。
- **数据库**：兼容 SQLite（NAS 私有部署） / PostgreSQL / MySQL，由 SeaORM 抽象。
- **对象存储**：本地文件系统或 S3 兼容服务。
