# Code2Video API 接入文档

> **编程题目讲解视频自动生成服务** —— 传入编程题目描述和标准答案代码，自动生成 Manim 动画讲解视频。

---

## 📌 基本信息

| 项目 | 值 |
|------|-----|
| **Base URL** | `http://{server}:8081`（可通过 `API_PORT` 修改） |
| **协议** | HTTP |
| **数据格式** | JSON |
| **认证方式** | 请求头 `X-API-Key` |
| **API 文档** | `http://{server}:8081/docs`（Swagger UI） |

---

## 🔑 认证

所有 `/api/v1/*` 接口需要在请求头中携带 API Key：

```
X-API-Key: dev-api-key-12345
```

> 生产环境请联系后端获取正式 API Key。

---

## 📋 接口总览

| 接口 | 方法 | 认证 | 说明 |
|------|------|:----:|------|
| `/health` | GET | ❌ | 健康检查 |
| `/docs` | GET | ❌ | Swagger API 文档 |
| `/api/v1/generate-video` | POST | ✅ | 生成视频（**SSE 流式返回**） |
| `/api/v1/tasks/{task_id}` | GET | ✅ | 查询任务状态 |
| `/api/v1/files/{filename}` | GET | ✅ | 下载视频文件（支持断点续传） |
| `/api/v1/files/{filename}` | HEAD | ✅ | 获取文件信息（不返回内容） |
| `/api/v1/files/{filename}/metadata` | GET | ✅ | 获取视频元信息 |

---

## 🎬 核心接口：生成视频

### `POST /api/v1/generate-video`

提交编程题目和标准答案代码，服务端异步生成讲解视频，通过 **SSE（Server-Sent Events）** 流式返回进度和结果。

### 请求格式

**Content-Type**: `application/json`

**请求体字段说明**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|:----:|--------|------|
| `problem_description` | string | ✅ | - | 编程题目完整描述（含题目名称、描述、示例、提示等） |
| `solution_code` | string | ✅ | - | 标准答案代码（原封不动展示在视频中，不可修改） |
| `age` | int | ❌ | null | 用户年龄（1-120），影响讲解风格 |
| `gender` | string | ❌ | null | 用户性别（"男"/"女"） |
| `language` | string | ❌ | `"Python"` | 编程语言（Python/Java/C++/JavaScript 等） |
| `duration` | int/null | ❌ | `null` | 手动目标时长支持 5-15 分钟；不传时由 AI 在 5-8 分钟内选择 |
| `render_profile` | string | ❌ | `"4k30"` | 原生规格：`"1080p30"` / `"4k30"` / `"4k60"` |
| `difficulty` | string | ❌ | `"medium"` | 内容难度：`"simple"` / `"medium"` / `"hard"` |
| `extra_info` | string | ❌ | null | 用户补充信息（自然语言描述，如学习背景、目标等） |
| `use_feedback` | bool | ❌ | `true` | 是否使用 MLLM 反馈优化视频质量 |
| `use_assets` | bool | ❌ | `true` | 是否使用外部素材增强动画 |
| `api_model` | string | ❌ | 服务端配置 | 指定 GPT 通道：推荐 `"gpt-5"`，兼容 `"gpt-4o"` / `"gpt-41"` / `"gpt-o4mini"` |

生成结果不显示逐句旁白字幕或底部字幕框。画面教学文字与 TTS 旁白分离；最终文件会按所选规格校验分辨率、帧率、H.264、yuv420p、AAC、音轨、5–15 分钟物理时长以及超过 3.5 秒的异常静音。

### 请求示例

**完整 JSON 请求体**（参考 `request.json`）：

```json
{
  "problem_description": "正则表达式匹配-给你一个字符串 s 和一个字符规律 p，请你来实现一个支持 '.' 和 '*' 的正则表达式匹配。\n\n'.' 匹配任意单个字符\n'*' 匹配零个或多个前面的那一个元素\n所谓匹配，是要涵盖 整个 字符串 s 的，而不是部分字符串。\n\n示例 1：\n输入：s = \"aa\", p = \"a\"\n输出：false\n解释：\"a\" 无法匹配 \"aa\" 整个字符串。\n\n示例 2:\n输入：s = \"aa\", p = \"a*\"\n输出：true\n\n提示：\n1 <= s.length <= 20\n1 <= p.length <= 20",
  "solution_code": "class Solution:\n    def isMatch(self, s: str, p: str) -> bool:\n        m, n = len(s), len(p)\n\n        def matches(i: int, j: int) -> bool:\n            if i == 0:\n                return False\n            if p[j - 1] == '.':\n                return True\n            return s[i - 1] == p[j - 1]\n\n        f = [[False] * (n + 1) for _ in range(m + 1)]\n        f[0][0] = True\n        for i in range(m + 1):\n            for j in range(1, n + 1):\n                if p[j - 1] == '*':\n                    f[i][j] |= f[i][j - 2]\n                    if matches(i, j - 1):\n                        f[i][j] |= f[i - 1][j]\n                else:\n                    if matches(i, j):\n                        f[i][j] |= f[i - 1][j - 1]\n        return f[m][n]",
  "age": 20,
  "language": "Python",
  "duration": 10,
  "render_profile": "4k30",
  "difficulty": "simple",
  "extra_info": "我是大学生，有一定的python编程基础，想要预习数据结构与算法，目标是通过暑假系统学习并掌握相关知识。"
}
```

**curl 命令**（使用 JSON 文件）：

```bash
curl -N -X POST http://localhost:8081/api/v1/generate-video \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key-12345" \
  -d @request.json
```

**curl 命令**（最简请求，仅必填字段）：

```bash
curl -N -X POST http://localhost:8081/api/v1/generate-video \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key-12345" \
  -d '{
    "problem_description": "给定一个排序数组和一个目标值，在数组中找到目标值并返回其索引。",
    "solution_code": "def searchInsert(nums, target):\n    left, right = 0, len(nums) - 1\n    while left <= right:\n        mid = (left + right) // 2\n        if nums[mid] == target:\n            return mid\n        elif nums[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return left"
  }'
```

### SSE 响应格式

响应为 `text/event-stream`，前端需要使用 EventSource 或 fetch + ReadableStream 来处理。

**SSE 事件类型**：

| 事件类型 | 说明 |
|----------|------|
| `running` | 任务进行中（可能有多条） |
| `finished` | 某个子步骤完成 |
| `failed` | 任务失败 |
| `result` | **最终结果**（包含视频文件名） |

**响应流示例**：

```
event: running
data: {"task_id":"uuid-xxx","message":"正在解析用户画像。"}

event: finished
data: {"task_id":"uuid-xxx","message":"用户画像解析成功。"}

event: running
data: {"task_id":"uuid-xxx","message":"正在生成视频大纲..."}

event: finished
data: {"task_id":"uuid-xxx","message":"大纲生成成功。"}

event: running
data: {"task_id":"uuid-xxx","message":"正在生成 Manim 代码..."}

event: running
data: {"task_id":"uuid-xxx","message":"正在渲染视频..."}

event: result
data: {"message":"视频生成成功。","data":{"video_file":"a1b2c3d4e5f6...sha256.mp4"}}
```

**失败响应**：

```
event: failed
data: {"task_id":"uuid-xxx","message":"视频渲染失败: 内存不足"}
```

> **重要**：收到 `result` 或 `failed` 事件后，SSE 连接会自动关闭。`data` 中的 `video_file` 字段是视频文件名，用于后续下载。

### 响应头

| Header | 说明 |
|--------|------|
| `X-Task-ID` | Celery 任务 ID（可用于断线重连后查询状态） |

---

## 🔍 查询任务状态

### `GET /api/v1/tasks/{task_id}`

用于 SSE 断线重连后查询任务的最终状态。`task_id` 从生成视频接口的响应头 `X-Task-ID` 获取。

**请求示例**：

```bash
curl -H "X-API-Key: dev-api-key-12345" \
  http://localhost:8081/api/v1/tasks/{task_id}
```

**响应示例**：

```json
{
  "task_id": "abc123-def456-...",
  "status": "SUCCESS",
  "result": {
    "video_file": "a1b2c3d4e5f6...sha256.mp4"
  },
  "error": null
}
```

**任务状态**：

| 状态 | 说明 |
|------|------|
| `PENDING` | 等待执行 |
| `STARTED` | 正在执行 |
| `SUCCESS` | 执行成功（`result` 字段有值） |
| `FAILURE` | 执行失败（`error` 字段有值） |

---

## 📥 下载视频文件

### `GET /api/v1/files/{filename}`

下载生成的视频文件。`filename` 从生成视频接口的 `result` 事件中获取。

支持 **Range 请求**（断点续传）。

**请求示例**：

```bash
# 下载完整文件
curl -H "X-API-Key: dev-api-key-12345" \
  http://localhost:8081/api/v1/files/a1b2c3...sha256.mp4 \
  -o video.mp4

# 断点续传（Range 请求）
curl -H "X-API-Key: dev-api-key-12345" \
  -H "Range: bytes=0-1048575" \
  http://localhost:8081/api/v1/files/a1b2c3...sha256.mp4 \
  -o video_part.mp4
```

**响应状态码**：

| 状态码 | 说明 |
|--------|------|
| 200 | 完整文件 |
| 206 | 部分内容（Range 请求） |
| 404 | 文件不存在 |
| 416 | Range 范围无效 |

---

## 📄 获取文件信息

### `HEAD /api/v1/files/{filename}`

检查文件是否存在、获取文件大小。不返回文件内容。

```bash
curl -I -H "X-API-Key: dev-api-key-12345" \
  http://localhost:8081/api/v1/files/a1b2c3...sha256.mp4
```

**响应头**：

```
HTTP/1.1 200 OK
Content-Type: video/mp4
Content-Length: 12345678
Accept-Ranges: bytes
```

---

## 📊 获取视频元信息

### `GET /api/v1/files/{filename}/metadata`

获取视频的生成参数、Token 使用量等元信息。

```bash
curl -H "X-API-Key: dev-api-key-12345" \
  http://localhost:8081/api/v1/files/a1b2c3...sha256.mp4/metadata
```

**响应示例**：

```json
{
  "problem_description": "正则表达式匹配-给你一个字符串 s 和一个字符规律 p...",
  "solution_code": "class Solution:\n    def isMatch(self, s: str, p: str) -> bool:\n        ...",
  "language": "Python",
  "duration": 10,
  "duration_source": "manual",
  "actual_duration_seconds": 603.21,
  "actual_narration_seconds": 590.84,
  "render_profile": "4k30",
  "physical_media": {
    "width": 3840,
    "height": 2160,
    "fps": 30.0,
    "video_codec": "h264",
    "pixel_format": "yuv420p",
    "audio_codec": "aac"
  },
  "long_silence_count": 0,
  "auto_removed_silence_seconds": 0,
  "visual_quality": {
    "all_sections_rendered": true,
    "sections": {}
  },
  "token_usage": {
    "prompt_tokens": 10000,
    "completion_tokens": 5000,
    "total_tokens": 15000
  },
  "created_at": "2024-01-01T12:00:00"
}
```

---

## ❤️ 健康检查

### `GET /health`

无需认证。用于监控服务是否正常运行。

```bash
curl http://localhost:8081/health
```

**响应示例**：

```json
{
  "status": "ok",
  "redis": "connected",
  "workers": 4,
  "version": "1.0.0"
}
```

---

## 🖥️ 前端接入指南

### 完整调用流程

```
┌──────────┐                           ┌──────────────┐
│  前端     │                           │  Code2Video  │
│          │   POST /generate-video     │    API       │
│          │ ─────────────────────────> │              │
│          │                           │              │
│          │   SSE: event: running      │              │
│          │ <───────────────────────── │  正在解析...  │
│          │                           │              │
│          │   SSE: event: finished     │              │
│          │ <───────────────────────── │  大纲完成     │
│          │                           │              │
│          │   SSE: event: running      │              │
│          │ <───────────────────────── │  渲染中...    │
│          │                           │              │
│          │   SSE: event: result       │              │
│          │ <───────────────────────── │  视频完成!    │
│          │                           │              │
│          │   GET /files/{filename}    │              │
│          │ ─────────────────────────> │              │
│          │                           │              │
│          │   video/mp4 文件           │              │
│          │ <───────────────────────── │              │
└──────────┘                           └──────────────┘
```

### 断线重连处理

如果 SSE 连接中断，可以通过 `X-Task-ID`（响应头获取）查询任务状态：

```javascript
async function checkTaskStatus(taskId) {
  const response = await fetch(`http://localhost:8081/api/v1/tasks/${taskId}`, {
    headers: { 'X-API-Key': 'dev-api-key-12345' },
  });
  const result = await response.json();
  
  if (result.status === 'SUCCESS') {
    // 任务已完成，直接下载
    downloadVideo(result.result.video_file);
  } else if (result.status === 'FAILURE') {
    console.error('任务失败:', result.error);
  } else {
    // 任务还在执行中，轮询等待
    setTimeout(() => checkTaskStatus(taskId), 5000);
  }
}
```

---

## ⚠️ 注意事项

1. **视频生成耗时较长**：一个 5 分钟的讲解视频通常需要 3-10 分钟生成，请在 UI 上做好进度展示
2. **SSE 连接保活**：服务端会定期发送心跳（`: heartbeat`），前端无需处理
3. **SSE 超时**：连接超过 1 小时未完成会自动断开
4. **文件有效期**：生成的视频文件会保存在服务端，建议前端在用户下载后不再依赖服务端存储
5. **并发限制**：单个 Worker 同一时间只处理 1 个视频生成任务，多个请求会排队

---

## 🔧 后端部署参考

> 以下内容供需要自行部署后端服务的人员参考。

### 前置要求

- Docker 20.10+
- Docker Compose 2.0+
- 至少 4GB 内存
- 至少 10GB 磁盘空间

### 快速启动

```bash
# 1. 克隆项目
git clone https://github.com/dxy831/code2video.git
cd code2video

# 2. 配置 LLM API 密钥
#    推荐在 .env 中配置 DMX_BASE_URL、DMX_API_KEY、LOGIC_MODEL、CODE_MODEL；
#    也可复制 src/api_config.example.json 为 src/api_config.json 后填写

# 3. 配置环境变量（可选）
cp .env.example .env
# 编辑 .env 修改配置

> 🚨 物理防撞警示：启动前必须在 .env 文件中强行注入以下变量，以建立与 K2V 绝对隔离的命名空间与端口：
> API_PORT=8081
> REDIS_PORT=6380
> COMPOSE_PROJECT_NAME=c2v_backend

# 4. 构建并启动
docker compose up -d --build

# 5. 验证服务
curl http://localhost:8081/health
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `API_KEYS` | API 认证密钥 | `dev-api-key-12345` |
| `DEFAULT_API` | 默认 LLM 模型 | `gpt-5` |
| `API_PORT` | API 服务端口 | `8081` |
| `REDIS_PORT` | Redis宿主机映射端口 | `6380` |
| `C2V_RENDER_WORKERS` | Manim 章节并发；4K 留空时自动使用 1 | - |
| `VIDEO_TASK_TIMEOUT_SECONDS` | 整体任务超时 | `43200` |
| `MAX_WORKERS` | 最大并行工作进程数（留空自动检测） | - |
| `DEBUG` | 调试模式 | `false` |

> ⚠️ **端口说明**：Compose 默认映射 API 到 `8081`、Redis 到 `6380`，可在 `.env` 中覆盖。

### 架构

```
┌─────────────────────────────────────────────────┐
│                Docker Compose                    │
│                                                  │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │    API     │  │  Worker   │  │   Redis   │   │
│  │ (FastAPI)  │  │ (Celery)  │  │  (队列)   │   │
│  │ c2v-api    │  │ c2v-worker│  │ c2v-redis │   │
│  │   :8081    │  │           │  │  :6380    │   │
│  └─────┬─────┘  └─────┬─────┘  └───────────┘   │
│        │               │                        │
│        └───────┬───────┘                        │
│           ┌────┴─────┐                          │
│           │ 共享存储  │                          │
│           │ /app/data │                          │
│           └──────────┘                          │
└─────────────────────────────────────────────────┘
```

### 运维命令

```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f          # 全部
docker compose logs -f api      # 仅 API
docker compose logs -f worker   # 仅 Worker

# 重启
docker compose restart

# 停止
docker compose down

# 清理所有数据（会删除已生成的视频！）
docker compose down -v

# 更新部署
git pull && docker compose up -d --build
```
