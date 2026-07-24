# Education2D

Education2D 使用 LLM、结构化可视化协议和版本存储生成可播放、可缩放、可通过自然语言继续编辑的 2D 教学内容。根目录 `compose.yaml` 已将其接入 RabbitMQ 和主后端；比赛评审应按 [`../../USER_MANUAL.md`](../../USER_MANUAL.md) 从仓库根目录启动。

主要目录：

- `src/shared/`：Zod 协议、校验、Patch、运行状态、组件目录与内置演示；
- `src/server/`：Express API、LangGraph Agent、版本存储和消息队列 Worker；
- `src/client/`：React UI、SVG 组件渲染、D3 布局和设计令牌。

服务默认复用根目录 `.env` 中的 `LLM_BASE_URL`、`LLM_API_KEY` 和 `LLM_MODEL`。源码及示例配置不包含可用密钥。
