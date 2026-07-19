# 智映通学核心真实生成服务

本服务实现当前敏捷测试需要的核心文本生成链路：

- `pretest`：根据学习主题、目标、语言生成课前测试；
- `plan`：根据课前测试结果生成个性化学习计划；
- `quiz`：根据学习任务生成课后小测；
- `knowledge_explanation`：为计划中的每个学习任务生成 Markdown 深度解析。

服务消费现有 RabbitMQ 队列，调用 OpenAI 兼容的 Chat Completions API，并按现有内部接口回调 Rust backend。它可以连接 OpenAI、DeepSeek、通义千问兼容模式或其他兼容服务。

生产和本地 Compose 都只启动这一套消费者。若未来拆出新的生成服务，必须确保同一个 RabbitMQ queue 只有目标消费者组处理，避免不同实现竞争同一批任务。

本地运行：

```bash
cp .env.example .env
# 填写 LLM_API_KEY、LLM_BASE_URL 和 LLM_MODEL
uv sync
uv run zhiying-core-generation
```

健康检查在容器内部监听 `9300`，返回 `{"status":"ok"}`。
