# Knowledge2Video

Knowledge2Video 是智映通学的知识视频生成服务。它根据学习任务、知识点、难度和学习者画像生成教学大纲、连续旁白、Manim 动画与最终 MP4，并通过当前单仓库的 RabbitMQ、Celery、MinIO 和后端内部回调接入学习任务页。

本目录同时保留原生 FastAPI/SSE 接口，方便单独调试生成管线；平台正常业务链路不要求前端直接调用该 API。

## 在单仓库中的职责

根目录 Compose 使用同一镜像启动三个进程：

| Compose 服务 | 入口 | 职责 |
|---|---|---|
| `knowledge-video-bridge` | `python -m src.integration_worker` | 消费 RabbitMQ 平台任务、提交 Celery、上传 MinIO、回调 backend |
| `knowledge-video-worker` | Celery worker | 执行 GPT 规划、TTS、Manim/FFmpeg 渲染和结果落盘 |
| `knowledge-video-api` | FastAPI/Uvicorn | 提供原生 SSE、状态查询和文件接口，主要用于独立调试 |

集成链路如下：

```text
Frontend
  -> Backend
  -> RabbitMQ: zhiying.knowledge_video / zhiying.knowledge_video.generate
  -> knowledge-video-bridge
  -> Redis/Celery: video_generation
  -> knowledge-video-worker
  -> MinIO: knowledge-videos/<task-id>-<uuid>.mp4
  -> Backend internal callback
  -> Frontend /storage proxy
```

Bridge 使用 `zhiying-knowledge-video-<task_id>` 作为稳定 Celery task ID，并在 Redis 中记录已提交任务。Bridge 进程中断、消息重新投递且原任务记录仍有效时，会继续等待原 Celery 任务，而不是重复启动一条昂贵的视频生成管线；生成链路抛出异常时会释放记录，允许后续重新生成。

## 当前能力

- OpenAI-compatible LLM 完成大纲、教学逻辑、旁白与 Manim 代码生成；
- vivo 蓝心 TTS，屏幕教学文字与自然旁白分离；
- 封面、概述、章节动画、音频物理测时和最终时间轴回灌；
- `1080p30`、`4k30`、`4k60` 渲染配置，平台默认使用 `1080p30`；
- 连续视觉抽样、局部章节返工和成功章节复用；
- FastAPI SSE 进度、Celery 状态查询、Range 下载与生成元数据；
- 平台集成模式下把最终视频上传到共享 S3-compatible 对象存储。

更细的音视频实现与验证原则见 [`PROJECT.md`](./PROJECT.md)，平台端到端验收见 [`../../docs/MULTIMODAL_LOCAL_VALIDATION.md`](../../docs/MULTIMODAL_LOCAL_VALIDATION.md)。

## 从仓库根目录启动

前置要求：

- Docker 24+ 与 Docker Compose v2；
- 可访问配置的 OpenAI-compatible LLM；
- 可用的 vivo TTS `APP_ID` 与 `APP_KEY`；
- 建议至少 8 核 CPU、16 GB 内存和充足临时磁盘。首次构建会安装 FFmpeg、中文字体、LaTeX、Manim 和科学计算依赖，耗时明显长于普通服务。

在仓库根目录复制并填写环境变量：

```powershell
Copy-Item .env.example .env
```

知识视频相关的关键配置：

```dotenv
# Bridge 回调 backend，必须与 backend 使用相同值并以 sk- 开头
KNOWLEDGE_VIDEO_API_KEY=sk-change-knowledge-video

# 原生 FastAPI 的 X-API-Key；平台内部生成链路不使用它
KNOWLEDGE_VIDEO_SERVICE_API_KEY=replace-with-random-api-key

# 复用根配置中的 LLM_BASE_URL、LLM_API_KEY，可单独选择逻辑/代码模型
K2V_LOGIC_MODEL=gpt-5.6-terra
K2V_CODE_MODEL=gpt-5.6-sol
K2V_RENDER_PROFILE=1080p30

VIVO_TTS_APP_ID=replace-me
VIVO_TTS_APP_KEY=replace-me

STORAGE_ACCESS_KEY=zhiying-storage
STORAGE_SECRET_KEY=please-change-to-a-long-random-secret
STORAGE_BUCKET=zhiying-content
STORAGE_PUBLIC_BASE=http://127.0.0.1:3080/storage
```

启动完整本地链路：

```powershell
docker compose --env-file .env -f compose.yaml -f compose.local.yaml up -d --build
```

检查状态与日志：

```powershell
docker compose --env-file .env -f compose.yaml -f compose.local.yaml ps
docker compose --env-file .env -f compose.yaml -f compose.local.yaml logs -f --tail 200 knowledge-video-bridge knowledge-video-worker
```

本地端口由 `compose.local.yaml` 暴露：

| 服务 | 地址 |
|---|---|
| Knowledge2Video Swagger | `http://127.0.0.1:8080/docs` |
| MinIO API | `http://127.0.0.1:9100` |
| MinIO 管理台 | `http://127.0.0.1:9101` |

## 平台任务契约

Bridge 消费：

- exchange：`zhiying.knowledge_video`；
- queue：`zhiying.knowledge_video.generate`；
- routing key：`generate`；
- 默认 prefetch：`1`，可通过 `KNOWLEDGE_VIDEO_WORKER_PREFETCH` 调整。

消息必须包含 `task_id`，其余学习者画像由 [`src/integration_payload.py`](./src/integration_payload.py) 转换为原生视频请求。状态通过以下内部接口回调：

```text
PATCH /internal/knowledge-videos/<task_id>
Authorization: Bearer <KNOWLEDGE_VIDEO_API_KEY>
```

状态流转为 `GENERATING -> FINISHED` 或 `GENERATING -> FAILED`。成功回调的 `object_key` 指向 MinIO 中的 `knowledge-videos/` 前缀。

## 独立 API 调试

根 Compose 启动后可以直接验证健康状态：

```powershell
curl.exe http://127.0.0.1:8080/health
```

除 `/`、`/health` 和 `/docs` 外，`/api/v1/*` 需要请求头：

```text
X-API-Key: <KNOWLEDGE_VIDEO_SERVICE_API_KEY>
```

提交一个低成本冒烟任务：

```powershell
curl.exe -N -X POST http://127.0.0.1:8080/api/v1/generate-video `
  -H "Content-Type: application/json" `
  -H "X-API-Key: replace-with-random-api-key" `
  -d '{"knowledge_point":"二分搜索","language":"Python","difficulty":"medium","duration":5,"render_profile":"1080p30","use_feedback":false}'
```

接口返回 `text/event-stream`，响应头 `X-Task-ID` 是 Celery task ID。SSE 断开不等于后台任务停止，可继续查询：

```text
GET /api/v1/tasks/<task-id>
```

## 验证

根据本目录 [`AGENTS.md`](./AGENTS.md) 的执行隔离要求，核心渲染和 Python 测试必须在 Docker 容器内运行，不要在宿主机直接安装依赖或执行管线。

仅验证 Compose 配置：

```powershell
docker compose --env-file .env -f compose.yaml -f compose.local.yaml config --quiet
```

运行 Python 测试：

```powershell
docker compose run --rm --no-deps `
  -v "${PWD}/services/knowledge2video:/workspace" `
  -w /workspace `
  -e PYTHONPATH=/workspace `
  knowledge-video-api python -m pytest -q tests
```

完整视频验收不能只检查任务状态或 MP4 是否存在，还应使用 `ffprobe` 核对分辨率、帧率、时长和音视频轨，并按 `AGENTS.md` 对旁白做局部静音检测。

## 目录

| 路径 | 用途 |
|---|---|
| `src/integration_worker.py` | 平台 RabbitMQ/Celery/MinIO/backend 适配层 |
| `src/integration_payload.py` | 平台学习任务到原生视频请求的字段映射 |
| `src/api/` | FastAPI、Celery、SSE、状态与文件接口 |
| `src/agent.py` | 视频生成主调度与章节生命周期 |
| `src/audio_steps.py` | TTS、音频规范化、物理测时和时间轴数据 |
| `src/rendering.py` | Manim/FFmpeg 渲染与合并 |
| `prompts/` | 教学规划和 Manim 代码生成模板 |
| `tests/` | 契约、音频、渲染和教学逻辑测试 |
| `docker-compose.yml` | 原项目独立调试编排；单仓库运行以根 Compose 为准 |

## 运维注意事项

- `knowledge-video-worker` 默认 `--pool=solo --concurrency=1`，扩容前需要评估 CPU、内存、临时磁盘和共享输出目录；
- `VIDEO_TASK_SOFT_TIME_LIMIT_SECONDS` 必须小于 `VIDEO_TASK_TIME_LIMIT_SECONDS`；
- 不要把 Redis 端口直接暴露到公网；
- 生产环境必须替换所有开发密钥，并为 API 配置 HTTPS、限流和 SSE 超时；
- LLM/TTS 网络异常时检查代理配置，`NO_PROXY`/`no_proxy` 应包含 `api-ai.vivo.com.cn`；
- 视频任务耗时长，调用方必须支持排队、断线恢复和幂等重投；
- MinIO 与 Celery 输出卷需要配置容量监控、保留周期和备份策略。
