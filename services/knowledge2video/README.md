# Knowledge2Video

Knowledge2Video 将知识点和学习画像转换为教学视频。根目录 `compose.yaml` 已将其接入 RabbitMQ、Redis、MinIO 和主后端；比赛评审应按 [`../../USER_MANUAL.md`](../../USER_MANUAL.md) 从仓库根目录启动。

主要模块：

- `src/integration_worker.py`：消费平台任务、提交 Celery 渲染并回调后端；
- `src/integration_payload.py`：将学习任务映射为视频生成请求；
- `src/agent.py`：视频规划和章节生命周期；
- `src/audio_steps.py`：TTS、音频规范化与物理时长测量；
- `src/rendering.py`：Manim/FFmpeg 渲染与合并；
- `src/api/`：FastAPI、SSE、任务状态和文件接口；
- `prompts/`：教学规划与 Manim 代码生成提示模板。

必需配置由根目录 `.env` 统一提供：LLM API、服务内部 API Key、Redis 和对象存储信息。TTS 可选择 `openai`、`dmx` 或 `vivo`；默认 `none` 会生成带静音轨的无声视频，不要求任何 TTS 凭据。源码及示例配置不包含可用密钥。

独立 API 文档在根 Compose 启动后访问 <http://127.0.0.1:8080/docs>。
