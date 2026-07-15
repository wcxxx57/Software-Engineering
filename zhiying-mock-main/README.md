# zhiying-mocks

`zhiying-tutor` 7 个微服务的 mock 实现。从 RabbitMQ 消费 dispatch 消息，按延迟先回 `GENERATING`、再回 `FINISHED`（或按失败率回 `FAILED`），用于本地联调，不调用真实大模型。

覆盖的微服务：

| 服务 | exchange | callback |
|---|---|---|
| knowledge_video | `zhiying.knowledge_video` | `PATCH /internal/knowledge-videos/{id}` |
| code_video | `zhiying.code_video` | `PATCH /internal/code-videos/{id}` |
| interactive_html | `zhiying.interactive_html` | `PATCH /internal/interactive-htmls/{id}` |
| knowledge_explanation | `zhiying.knowledge_explanation` | `PATCH /internal/knowledge-explanations/{id}` |
| pretest | `zhiying.pretest` | `POST /internal/study-subjects/{id}` |
| plan | `zhiying.plan` | `POST /internal/study-subjects/{id}` |
| quiz | `zhiying.quiz` | `POST /internal/study-quizzes/{id}` |

## 启动

依赖：
- `uv`（Python 3.13）
- `zhiying-infra` 提供的 RabbitMQ（`localhost:5672`，dev/dev）
- `zhiying-backend` 监听在 `localhost:9000`（接收 callback）

```bash
cd zhiying-infra && docker compose up -d
cd zhiying-backend && cargo run         # 另一个终端
cd zhiying-mocks
cp .env.example .env                    # 按需调整
uv sync
uv run zhiying-mocks                    # 等价 uv run python -m zhiying_mocks
```

启动后会幂等声明 7 组 exchange/queue/binding 并并发消费。

## 配置

全部环境变量见 [`.env.example`](./.env.example)。常用调节：

- `MOCK_GENERATING_DELAY_MS` / `MOCK_FINISHED_DELAY_MS`：两段延迟，毫秒。
- `MOCK_FAILURE_RATE`：0.0~1.0，命中后整条消息回 `FAILED`，触发后端退款逻辑。
- `MOCK_<SERVICE>_GENERATING_DELAY_MS` / `MOCK_<SERVICE>_FINISHED_DELAY_MS` / `MOCK_<SERVICE>_FAILURE_RATE`：按服务覆盖（`<SERVICE>` 取大写下划线名，如 `PRETEST`、`KNOWLEDGE_VIDEO`）。
- API Key 默认值与 `zhiying-backend/.env.example` 完全一致；自定义后端的 key 时记得两侧同改。

## 行为约定

- 消息一到立即 ack，**不重试**；解析失败的消息也直接丢弃并 warn。
- FINISHED 时按服务返回固定 mock payload：
  - 视频/互动 HTML 服务返回环境变量里的 `object_key`（默认指向 `zhiying-content` bucket 内的占位路径）；前端拿 key 后通过 `/api/v1/config` 暴露的 `storage.public_base + bucket` 拼出可访问 URL。
  - 讲解返回 markdown + JSON 思维导图（嵌入 task detail，不走对象存储）。
  - pretest/quiz 返回 N 道四选一题；plan 按 `total_stages × MOCK_PLAN_TASKS_PER_STAGE` 生成阶段树。
- FAILED 时只发 `{"status":"FAILED"}`，让后端按记录上的 `cost` 字段退款。

## 占位资源 (E2E 视频/HTML 播放)

mock 默认返回的 `object_key` 不会自动上传文件到 MinIO。如果想走通"前端真的能播 mock 视频 / 加载 mock 互动 HTML"，手动一次性上传到 `zhiying-infra` 启动的 MinIO：

```bash
# 任意小 mp4 + 简单 html 即可
docker compose -f ../zhiying-infra/compose.yaml exec minio-init \
  mc cp /etc/hosts local/zhiying-content/knowledge-videos/mock-placeholder.mp4
docker compose -f ../zhiying-infra/compose.yaml exec minio-init \
  mc cp /etc/hosts local/zhiying-content/code-videos/mock-placeholder.mp4
docker compose -f ../zhiying-infra/compose.yaml exec minio-init \
  mc cp /etc/hosts local/zhiying-content/interactive-html/mock-placeholder/index.html
```

## 不做的事

- 不实现真实大模型调用；不持久化历史消息。
- 不做重试 / DLQ。
- 不做 metrics；只输出 structlog 控制台日志。
- 不打镜像、不入 `zhiying-infra/compose.yaml`。
