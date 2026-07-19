# 生成域服务

`services/` 统一存放需要独立构建、独立运行和独立扩缩容的生成服务。三个目录属于同一个业务域，但不是同一个部署单元：

| 服务 | 职责 | 运行时 | 独立部署原因 |
|---|---|---|---|
| `core-generation/` | 课前测、计划、知识解析/思维导图、课后测 | Python、aio-pika | 轻量结构化 LLM 任务，共享同一套消息与回调模式 |
| `education2d/` | 2D 可视化生成、播放、版本历史和自然语言编辑 | Node.js、React/Vite、Express | 同时提供浏览器应用和持久化版本服务 |
| `knowledge2video/` | 教学规划、分镜、TTS、Manim/FFmpeg 渲染和视频上传 | Python、FastAPI、Celery、Redis、LaTeX、FFmpeg | 镜像和资源消耗远大于文本生成，需要单独扩缩容和故障隔离 |

## 服务边界

适合继续加入 `core-generation` 的能力应同时满足：

- 主要输出是结构化 JSON、Markdown 或短文本；
- 只需要 LLM、RabbitMQ 和 backend 回调；
- 不需要独立 Web UI、版本数据库、GPU/媒体渲染或长时间后台任务；
- 与现有四个消费者可以共享相近的资源限制和发布节奏。

需要浏览器运行时、独立状态存储、媒体工具链或重型计算的能力，应继续作为 `services/` 下的独立服务，通过 RabbitMQ 和 backend 内部回调接入平台。

服务目录只表达源码归属；Compose 中的服务名、exchange、queue、镜像名和后端契约才是稳定的运行边界。移动源码目录不应改变这些外部契约。
