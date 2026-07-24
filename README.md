# 智映通学

智映通学是一套面向计算机学习场景的个性化多模态学习系统。系统根据课前测结果和用户画像生成学习计划，并在任务过程中提供深度解析、知识导图、2D 交互内容、知识视频、代码题讲解视频和课后小测。

运行手册请阅读 [`项目运行指南.md`](./项目运行指南.md)。手册包含本地配置初始化、API 填写、一键 Docker 启动、完整体验流程和排错步骤。

## 核心流程

```text
注册 / 登录
  → 创建学习主题
  → 课前测试
  → 个性化学习计划
  → 深度解析 / 知识导图 / 2D 交互 / 知识视频
  → 课后小测
  → 学习进度、错题与资源管理
```

## 技术组成

| 目录 | 作用 | 主要技术 |
|---|---|---|
| `frontend/` | Web 界面与后端代理 | Next.js 16、React 19、TypeScript |
| `backend/` | REST API、认证、学习状态与资源管理 | Rust、Axum、SeaORM |
| `services/core-generation/` | 课前测、计划、解析与小测生成 | Python、RabbitMQ、OpenAI-compatible API |
| `services/education2d/` | 可交互 2D 教学内容生成 | React、Express、LangGraph |
| `services/knowledge2video/` | 知识视频生成 | FastAPI、Celery、Manim、FFmpeg、TTS |
| `services/code2video/` | 代码题讲解视频生成 | FastAPI、Celery、Manim、FFmpeg、TTS |

运行时还会启动 PostgreSQL、RabbitMQ、Redis 和 MinIO。服务之间通过 RabbitMQ 分发异步生成任务，通过后端内部 HTTP 接口回调状态与结果；视频和交互资源保存在 MinIO。

## 快速启动

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\init-env.ps1
# 按 USER_MANUAL.md 填写 LLM API；TTS 可选，不填时生成无声视频
docker compose --env-file .env -f compose.yaml -f compose.local.yaml up -d --build
```

Linux/macOS：

```bash
bash scripts/init-env.sh
# 按 USER_MANUAL.md 填写 LLM API；TTS 可选，不填时生成无声视频
docker compose --env-file .env -f compose.yaml -f compose.local.yaml up -d --build
```

主页面：<http://127.0.0.1:3080>

源码和 `.env.example` 不包含任何可用 Token。初始化脚本只随机生成数据库、JWT、内部回调与对象存储密钥；第三方 API 必须由使用者写入被 Git 忽略的 `.env`。TTS 默认关闭，知识视频和代码讲解视频会使用静音轨继续生成；需要旁白时可选择 OpenAI-compatible、DMX 或 vivo TTS。

## 进一步说明

- 完整本地运行：[`USER_MANUAL.md`](./USER_MANUAL.md)
- Knowledge2Video：[`services/knowledge2video/README.md`](./services/knowledge2video/README.md)
- Code2Video：[`services/code2video/README.md`](./services/code2video/README.md)
- Education2D：[`services/education2d/README.md`](./services/education2d/README.md)
