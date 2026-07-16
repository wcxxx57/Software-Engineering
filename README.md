# Knowledge2Video

Knowledge2Video 是一个面向计算机与编程知识点的个性化讲解视频生成服务。系统根据知识点、编程语言、难度和学习者背景生成教学大纲、连续旁白、Manim 动画与最终视频，并通过 FastAPI、Celery 和 Redis 提供异步 HTTP API。

当前部署分支：[`knowledge2video`](https://github.com/wcxxx57/Software-Engineering/tree/knowledge2video)

文档版本：2026-07-16（适用于 Docker Compose V2、GPT/DMX 和 Vivo TTS 配置）

## 当前能力

- GPT 规划与代码生成，使用 OpenAI 兼容的 DMX 网关。
- Vivo 蓝心 TTS，屏幕教学文字与自然旁白分离。
- 语义分组旁白与整组高亮，不显示逐句字幕或底部字幕框。
- 支持 `1080p30`、`4k30` 和 `4k60` 原生渲染，默认 `4k30`。
- 支持连续视觉抽样、局部章节返工和已成功章节复用。
- 最终文件使用 SHA-256 内容哈希命名，并保存生成元数据。
- API 使用 SSE 返回实时进度；任务状态、视频下载和 Range 请求均有独立接口。

## 系统结构

```text
客户端
  │ POST /api/v1/generate-video（SSE）
  ▼
FastAPI ── Redis Pub/Sub ── Celery Worker
                              │
                              ├─ GPT：大纲、旁白与 Manim 代码
                              ├─ Vivo TTS：旁白音频
                              ├─ Manim / FFmpeg：预览、质检与最终渲染
                              └─ data/outputs：视频和元数据
```

Docker Compose 默认启动三个服务：

| 服务 | 作用 | 默认端口 |
|---|---|---:|
| `api` | FastAPI、SSE、任务查询和文件下载 | `8080` |
| `worker` | Celery 视频生成 Worker，默认一次执行一个任务 | 无宿主机端口 |
| `redis` | Celery Broker、结果存储和 SSE Pub/Sub | `6379` |

## 部署要求

- Docker 20.10+。
- Docker Compose 2.x，命令为 `docker compose`。
- 能访问 DMX LLM 网关与 `api-ai.vivo.com.cn`。
- 最低建议 4 核 CPU、8 GB 内存、20 GB 可用磁盘。
- 生成 4K 长视频时，建议 8 核以上、16 GB 以上内存，并预留更多临时磁盘空间。
- 首次构建需要安装 FFmpeg、中文字体和完整 LaTeX 依赖，镜像构建时间较长。

当前 Compose 是单机部署方案。API 与 Worker 通过宿主机的 `./data/outputs` 共享最终文件；如果拆成多台机器，必须改为共享文件系统或对象存储。

## 快速部署

### 1. 获取指定分支

```bash
git clone --branch knowledge2video --single-branch \
  git@github.com:wcxxx57/Software-Engineering.git
cd Software-Engineering
```

如果已经克隆仓库：

```bash
git fetch origin
git switch knowledge2video
git pull --ff-only
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

部署前必须修改 `.env` 中的占位值：

```dotenv
# 客户端调用 API 时使用。生产环境禁止使用默认开发密钥。
API_KEYS=replace-with-a-long-random-key

# GPT / OpenAI 兼容网关
DEFAULT_API=gpt-5
DMX_BASE_URL=https://your-openai-compatible-gateway.example/v1
DMX_API_KEY=replace-with-real-key
LOGIC_MODEL=gpt-5.6-terra
CODE_MODEL=gpt-5.6-sol

# Vivo 蓝心 TTS
TTS_PROVIDER=vivo
VIVO_TTS_APP_ID=replace-with-real-app-id
VIVO_TTS_APP_KEY=replace-with-real-app-key
VIVO_TTS_BASE_URL=wss://api-ai.vivo.com.cn
VIVO_TTS_ENGINE_ID=tts_humanoid_lam
VIVO_TTS_VOICE=F245_natural
VIVO_TTS_SPEED=50
VIVO_TTS_VOLUME=50

# 服务与任务配置
API_PORT=8080
REDIS_PORT=6379
K2V_RENDER_WORKERS=1
MANIM_RENDER_TIMEOUT_SECONDS=21600
VIDEO_TASK_TIME_LIMIT_SECONDS=43200
VIDEO_TASK_SOFT_TIME_LIMIT_SECONDS=41400
DEBUG=false
```

说明：

- `LOGIC_MODEL` 负责大纲、教学逻辑和旁白规划。
- `CODE_MODEL` 负责 Manim 场景代码生成与视觉返工。
- `F245_natural` 是当前教学视频推荐音色。
- `VIDEO_TASK_SOFT_TIME_LIMIT_SECONDS` 必须小于 `VIDEO_TASK_TIME_LIMIT_SECONDS`。
- `.env` 已被 Git 忽略，禁止将真实密钥写入 `.env.example` 或提交到仓库。

### 3. 构建并启动

> 必须使用 Docker Compose V2 命令 `docker compose`。旧命令 `docker-compose` 已停止在本文档中使用。

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
docker compose logs --tail=100 api worker redis
```

### 4. 验证 API、Redis 和 Worker

```bash
curl http://localhost:8080/health
```

正常响应示例：

```json
{
  "status": "ok",
  "redis": "connected",
  "workers": 16,
  "version": "1.0.0"
}
```

`workers` 当前表示服务根据 CPU 推算的并行数量，不表示在线 Celery Worker 数量。部署验收时还必须执行：

```bash
docker compose exec worker \
  python -m celery -A src.api.tasks.celery_app inspect ping --timeout=10
```

看到 `pong` 才能确认 Worker 已连通。

Swagger 文档：`http://localhost:8080/docs`

## API 认证

除 `/`、`/health` 和 `/docs` 外，`/api/v1/*` 接口需要请求头：

```text
X-API-Key: <API_KEYS 中配置的某一个密钥>
```

## 生成视频

### `POST /api/v1/generate-video`

接口返回 `text/event-stream`，连接中会持续发送生成进度。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|:---:|---|---|
| `knowledge_point` | string | 是 | - | 计算机或编程知识点 |
| `language` | string | 否 | `Python` | 示例代码使用的语言 |
| `difficulty` | string | 否 | `medium` | `simple`、`medium`、`hard` |
| `duration` | integer/null | 否 | `null` | 目标分钟数，范围 `5–12`；为空时由 AI 选择 |
| `render_profile` | string | 否 | `4k30` | `1080p30`、`4k30`、`4k60` |
| `age` | integer/null | 否 | `null` | 学习者年龄，范围 `1–120` |
| `gender` | string/null | 否 | `null` | 可选用户信息 |
| `extra_info` | string/null | 否 | `null` | 学习背景、专业、目标和已有知识 |
| `use_feedback` | boolean | 否 | `true` | 是否启用视觉反馈和局部返工 |
| `use_assets` | boolean | 否 | `true` | 是否允许使用外部素材 |
| `api_model` | string/null | 否 | 环境变量 | 通常不传，使用服务端 GPT 配置 |

推荐请求示例：

```bash
curl -N -X POST http://localhost:8080/api/v1/generate-video \
  -H "Content-Type: application/json" \
  -H "X-API-Key: replace-with-your-api-key" \
  -d '{
    "knowledge_point": "优先队列与二叉堆",
    "language": "Python",
    "difficulty": "medium",
    "duration": 10,
    "render_profile": "4k30",
    "extra_info": "我是经济管理专业学生，没有系统的计算机基础，希望结合电商订单优先级和任务调度理解这个知识点。",
    "use_feedback": true,
    "use_assets": true
  }'
```

首次部署建议先用 `render_profile: "1080p30"` 做契约验证，确认 LLM、TTS、渲染和下载链路全部成功后，再运行 4K 长视频任务。

### SSE 事件

| 事件 | 说明 |
|---|---|
| `running` | 当前步骤正在执行 |
| `finished` | 某个子步骤完成 |
| `failed` | 任务失败 |
| `result` | 最终成功结果，包含 `video_file` |

示例：

```text
event: running
data: {"task_id":"...","message":"正在生成视频大纲..."}

event: result
data: {"message":"视频生成成功。","data":{"video_file":"<sha256>.mp4"}}
```

响应头 `X-Task-ID` 是 Celery 任务 ID。SSE 中断后可用它查询最终状态。

当前 SSE 最长保持 6 小时；Celery 任务硬超时默认 12 小时。如果 SSE 因超时或网络中断关闭，后台任务可能仍在继续，应查询任务状态，不要立刻重复提交。

## 查询任务状态

### `GET /api/v1/tasks/{task_id}`

```bash
curl -H "X-API-Key: replace-with-your-api-key" \
  http://localhost:8080/api/v1/tasks/<task_id>
```

Celery 状态通常为：

- `PENDING`：等待执行，或任务 ID 不存在。
- `STARTED`：正在执行。
- `SUCCESS`：成功，`result.video_file` 可用于下载。
- `FAILURE`：失败，查看 `error` 和 Worker 日志。

## 下载视频和元数据

```bash
# 下载完整视频
curl -H "X-API-Key: replace-with-your-api-key" \
  http://localhost:8080/api/v1/files/<sha256>.mp4 \
  -o video.mp4

# 获取文件响应头
curl -I -H "X-API-Key: replace-with-your-api-key" \
  http://localhost:8080/api/v1/files/<sha256>.mp4

# 获取生成元数据
curl -H "X-API-Key: replace-with-your-api-key" \
  http://localhost:8080/api/v1/files/<sha256>.mp4/metadata
```

视频下载接口支持 HTTP Range 请求，可用于断点续传和播放器拖动。

输出文件保存在：

```text
data/outputs/videos/<sha256>.mp4
data/outputs/metadata/<sha256>.json
```

## 部署验收

交给调用方之前至少完成以下检查：

1. `docker compose config --quiet` 无错误。
2. `docker compose ps` 中 API 与 Redis 为 `healthy`，Worker 为 `Up`。
3. `/health` 返回 `redis: connected`。
4. Celery `inspect ping` 返回 `pong`。
5. 使用无效 `X-API-Key` 调用受保护接口时被拒绝。
6. 提交一次 `1080p30` 冒烟任务，SSE 能收到 `result`。
7. 可以通过返回的哈希文件名下载 MP4 和元数据。
8. 使用 `ffprobe` 校验物理分辨率、帧率、音视频轨和时长。

项目测试必须在 Docker 中运行：

Linux/macOS：

```bash
docker compose run --rm --no-deps \
  -v "$PWD:/workspace" -w /workspace \
  -e PYTHONPATH=/workspace \
  api python -m pytest -q tests
```

PowerShell：

```powershell
docker compose run --rm --no-deps `
  -v "${PWD}:/workspace" -w /workspace `
  -e PYTHONPATH=/workspace `
  api python -m pytest -q tests
```

## 更新与运维

```bash
# 更新 knowledge2video 分支
git fetch origin
git switch knowledge2video
git pull --ff-only
docker compose up -d --build

# 查看日志
docker compose logs -f api
docker compose logs -f worker

# 重启服务
docker compose restart api worker

# 停止服务但保留 Redis Volume 和输出文件
docker compose down
```

危险操作：

```bash
# 会删除 Redis Volume；执行前确认没有仍需查询的任务状态。
docker compose down -v
```

`data/outputs` 是宿主机目录，不会因普通 `docker compose down` 被删除，但仍需自行制定备份和清理策略。

## 生产环境注意事项

当前代码可以用于单机部署和预发布联调。正式对公网提供服务前，还需要完成以下部署侧配置：

1. 将 `API_KEYS` 替换为随机强密钥，禁止保留 `dev-api-key-12345`。
2. 不要将 Redis `6379` 直接暴露到公网；使用防火墙、仅本机绑定或移除宿主机端口映射。
3. 在 API 前配置 HTTPS 反向代理，并关闭 SSE 缓冲、延长读取超时。
4. 限制请求频率和队列长度，防止昂贵的 4K 任务被无限提交。
5. 为 `data/outputs` 配置容量监控、保留周期、备份或对象存储迁移。
6. 监控 API、Redis、Celery Worker、磁盘、内存、任务失败率和外部 LLM/TTS 错误率。
7. 当前固定为单 Worker、`--pool=solo --concurrency=1`；扩容前必须同时评估 CPU、内存、临时磁盘和共享存储。
8. `health.workers` 不是 Celery 在线数量，监控系统应额外执行 Celery ping 或增加专用 Worker 健康检查。

## 常见问题

### 首次构建很慢

镜像需要安装 LaTeX、FFmpeg 和字体包，第一次构建可能下载数 GB 依赖。后续构建会使用 Docker 缓存。

### 中文字体或公式渲染失败

确认使用仓库提供的 Dockerfile，不要直接在宿主机运行 Manim。镜像已安装 `fonts-noto-cjk`、Tex Live 和 `dvisvgm`。

### SSE 没有进度

依次检查 Redis 健康状态、Worker `inspect ping`、API/Worker 日志和反向代理是否启用了响应缓冲。Nginx 需要关闭 `proxy_buffering`。

### 任务成功但下载不到文件

确认 API 与 Worker 都挂载了同一个 `./data/outputs:/app/data/outputs`，并检查宿主机目录权限和剩余空间。

### TTS 请求失败

检查 Vivo AppID/AppKey、服务器时间、网络出口以及 `NO_PROXY/no_proxy` 是否包含 `api-ai.vivo.com.cn`。

### LLM 请求失败

检查 `DMX_BASE_URL` 是否包含正确的 `/v1` 路径、API Key、模型名称和服务器对网关的网络连通性。

## 已知边界

- 首版面向计算机与编程知识点，不保证其他学科的可视化效果。
- 当前输出存储是单机文件系统，不是多节点对象存储方案。
- 视频生成依赖外部 GPT 和 Vivo TTS，外部接口限流或不可用会导致任务失败。
- 4K 长视频属于高耗时任务；调用方必须支持排队、SSE 断线和任务状态查询。
- 视觉反馈会优先复用已生成章节，但仍可能增加调用成本和总耗时。
