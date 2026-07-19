# 2D 可视化与知识视频本地验证

本文面向当前 `iteration2` 集成版本。它保留原 `education2d` 与 `knowledge2video` 分支的完整功能代码，并通过现有 RabbitMQ + backend 内部回调契约接入学习任务页。

## 1. 配置

从模板创建本地配置：

```powershell
Copy-Item .env.example .env
```

除原有 PostgreSQL、RabbitMQ、JWT、四核心 LLM 配置外，至少填写：

```dotenv
CORE_FLOW_ONLY=false

INTERACTIVE_HTML_API_KEY=sk-一个随机值
KNOWLEDGE_VIDEO_API_KEY=sk-另一个随机值
KNOWLEDGE_VIDEO_SERVICE_API_KEY=一个随机值

STORAGE_ACCESS_KEY=zhiying-local
STORAGE_SECRET_KEY=一个足够长的随机值
STORAGE_BUCKET=zhiying-content
STORAGE_PUBLIC_BASE=http://127.0.0.1:3080/storage

VIVO_TTS_APP_ID=你的vivo蓝心TTS应用ID
VIVO_TTS_APP_KEY=你的vivo蓝心TTS应用Key
```

2D 默认复用 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`。知识视频也复用同一网关，可用以下变量单独选择规划与代码模型：

```dotenv
K2V_LOGIC_MODEL=gpt-5.6-terra
K2V_CODE_MODEL=gpt-5.6-sol
K2V_RENDER_PROFILE=1080p30
```

不要把 `.env` 提交到 Git，也不要把真实 Key 发到聊天中。

当前集成环境已经具备可用的 LLM 配置，但如果 `.env` 中没有
`VIVO_TTS_APP_ID / VIVO_TTS_APP_KEY`，2D 可视化仍可完整生成和编辑，知识视频则会在语音合成阶段失败。请直接把这两个值写入本机
`E:\zhiying\Software-Engineering\.env`，不要粘贴到聊天或提交到仓库。

## 2. 构建与启动

```powershell
cd E:\zhiying\Software-Engineering

docker compose `
  --env-file .env `
  -f compose.yaml `
  -f compose.local.yaml `
  config --quiet

docker compose `
  --env-file .env `
  -f compose.yaml `
  -f compose.local.yaml `
  up -d --build --remove-orphans
```

首次构建 `knowledge2video` 会安装 FFmpeg、LaTeX、中文字体、Manim 与科学计算依赖，耗时和镜像体积明显大于其他服务。

如果拉取 Docker Hub 基础镜像时反复出现 `EOF` 或代理连接错误，先在 Docker Desktop 的代理设置中使用本机代理：

```text
http://127.0.0.1:7890
```

然后重启 Docker Desktop 再执行构建。不要把代理地址写进生产 Compose。

本机 Windows 的 Docker/Hyper-V 若保留了 `3000` 端口，本项目本地前端使用 `3080`：

```text
前端：http://127.0.0.1:3080
后端：http://127.0.0.1:9000/health
RabbitMQ：http://127.0.0.1:15672
Knowledge2Video API：http://127.0.0.1:8080/docs
MinIO Console：http://127.0.0.1:9101
```

## 3. 状态检查

```powershell
docker compose `
  --env-file .env `
  -f compose.yaml `
  -f compose.local.yaml `
  ps -a
```

应看到以下长期运行服务：

```text
postgres
rabbitmq
redis
minio
backend
core-generation
education2d
knowledge-video-api
knowledge-video-worker
knowledge-video-bridge
frontend
npm
```

`minio-init` 正常状态是 `Exited (0)`，它只负责创建 bucket 和下载策略。

检查消费者：

```powershell
docker exec zhiying-rabbitmq `
  rabbitmqctl -q list_queues `
  name consumers messages_ready messages_unacknowledged
```

以下六个队列应各有 `1` 个消费者：

```text
zhiying.pretest.generate
zhiying.plan.generate
zhiying.knowledge_explanation.generate
zhiying.quiz.generate
zhiying.interactive_html.generate
zhiying.knowledge_video.generate
```

## 4. 浏览器端完整验证

打开：

```text
http://127.0.0.1:3080
```

使用新账户依次验证：

1. 创建学习主题并完成真实课前测；
2. 生成真实学习计划；
3. 打开任意处于 `STUDYING` 的学习任务；
4. 确认思维导图可以滚轮缩放、拖动，并可用 `+ / - / 适应画布`；
5. 在“2D 可视化操作”卡片点击生成；
6. 状态应从 `QUEUING → GENERATING → FINISHED`；
7. 完成后页面嵌入 Education2D Viewer；
8. 验证播放、暂停、上一步、下一步、画布缩放、版本撤销/重做；
9. 在右侧自然语言编辑框输入“换种演示方式”或“增加一个节点”，确认生成新版本；
10. 在“知识视频”卡片点击生成；
11. Backend 会将年龄、性别、自我介绍、经验值、打卡、学习主题、阶段进度、课前测表现和当前任务作为完整画像快照发送给 Knowledge2Video；
12. Bridge 会把结构化画像映射成视频画像文本，视频随后经过用户画像解析、教学大纲、分镜、封面与概述、Manim 代码、渲染、合并、上传；
13. 状态应从 `QUEUING → GENERATING → FINISHED`；
14. 页面出现原生视频播放器，拖动进度条应触发 HTTP Range `206`；
15. 最后完成课后测并打卡。

生成结束后，可检查最新 metadata 中的完整画像快照：

```powershell
docker exec zhiying-knowledge-video-worker python -c @'
from pathlib import Path
import json

path = max(Path("/outputs/metadata").glob("*.json"), key=lambda item: item.stat().st_mtime)
data = json.loads(path.read_text(encoding="utf-8"))
print(json.dumps({
    "duration": data.get("duration"),
    "duration_source": data.get("duration_source"),
    "learner_profile": data.get("learner_profile"),
    "learning_context": data.get("learning_context"),
}, ensure_ascii=False, indent=2))
'@
```

任务页生成的视频应看到非空 `learner_profile`，并在 `learning_context` 中看到学习主题、阶段进度、课前测题数/正确数及当前任务信息。独立 K2V 工具生成的视频应包含 `learner_profile`，其 `learning_context` 可以为空。

知识视频通常需要数分钟到数十分钟，取决于时长、渲染规格、CPU 和模型响应。建议本地首次使用：

```dotenv
K2V_RENDER_PROFILE=1080p30
```

## 5. 日志与排障

```powershell
docker logs -f --tail 200 zhiying-education2d
docker logs -f --tail 200 zhiying-knowledge-video-bridge
docker logs -f --tail 200 zhiying-knowledge-video-worker
docker logs -f --tail 200 zhiying-knowledge-video-api
```

正常启动日志包含：

```text
Education2D worker ready queue=zhiying.interactive_html.generate
Knowledge2Video integration worker ready queue=zhiying.knowledge_video.generate
celery@... ready
```

若知识视频立即失败，优先检查：

- `VIVO_TTS_APP_ID / VIVO_TTS_APP_KEY` 是否填写；
- LLM 网关 URL 是否包含正确的 `/v1`；
- `K2V_LOGIC_MODEL / K2V_CODE_MODEL` 是否被网关支持；
- MinIO `minio-init` 是否 `Exited (0)`；
- 服务器是否有足够 CPU、内存和磁盘。

## 6. 可选的源码回归测试

```powershell
# 原四项真实生成服务
uv venv services\core-generation\.venv --python 3.12
uv pip install --python services\core-generation\.venv\Scripts\python.exe -e services\core-generation pytest
services\core-generation\.venv\Scripts\python.exe -m pytest services\core-generation\tests -q

# Education2D 原分支测试、类型检查和生产构建
Push-Location services\education2d
npm ci
npm run typecheck
npm test
npm run build
Pop-Location

# Knowledge2Video 在真实运行镜像内执行原分支测试
docker run --rm `
  --mount "type=bind,source=$PWD\services\knowledge2video,target=/workspace" `
  --workdir /workspace `
  --entrypoint python `
  zhiying/knowledge2video:local `
  -m pytest -q `
  tests/test_pedagogy.py `
  tests/test_narration_rendering.py `
  tests/test_vivo_tts.py `
  tests/test_docker_media.py
```

当前知识视频画像透传相关回归基线为 Knowledge2Video `23 passed`。

## 7. 停止

```powershell
docker compose `
  --env-file .env `
  -f compose.yaml `
  -f compose.local.yaml `
  down
```

不要使用 `down -v`，否则会删除 PostgreSQL、RabbitMQ、Redis、MinIO、Education2D 版本数据及 NPM 证书卷。
