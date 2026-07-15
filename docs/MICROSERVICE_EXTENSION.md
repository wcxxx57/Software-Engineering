# 后续生成微服务扩展指南

## 1. 是否直接加入 `core-generation`

判断原则不是“业务名称是否属于智映通学”，而是运行依赖、资源需求、扩缩容方式和故障边界是否相近。

适合直接加入 `core-generation`：

- 纯文本或结构化 JSON 生成；
- 使用同一类 OpenAI 兼容 LLM；
- 单次执行通常在数秒到几分钟；
- 不执行用户代码；
- 不需要 GPU、FFmpeg、浏览器沙盒或大量临时文件；
- 与课前测、计划、小测具有相近的并发和扩容方式。

`knowledge_explanation` 已经作为第 4 个消费者加入当前服务。

不适合直接加入 `core-generation`：

- 知识视频、代码视频；
- TTS、字幕、FFmpeg、Remotion、Manim；
- 需要独立 GPU 的生成任务；
- 需要执行用户代码；
- 需要浏览器/容器沙盒的互动 HTML；
- 单次可能运行几十分钟、占用大量内存或磁盘的任务。

这类能力应建立独立目录和容器，例如：

```text
services/
  video-generation/
  code-video-generation/
  interactive-html-generation/
```

## 2. 在 `core-generation` 中增加文本服务

以 `knowledge_explanation` 为例：

1. 在 `models.py` 增加输入和输出 Pydantic 模型；
2. 在 `generators.py` 增加真实 LLM 生成函数；
3. 在 `worker.py` 的 `specs()` 注册 exchange、queue、回调地址和 API Key；
4. 在 `config.py` 增加对应 API Key 和生成参数；
5. 在根 `.env.example` 与 Compose 中传入配置；
6. 确认 backend 已声明相同 exchange/queue，并接受相同回调 JSON；
7. 为模型输出校验、失败回调和端到端流程增加测试。

现有约定：

```text
exchange: zhiying.{service}
queue: zhiying.{service}.generate
routing key: generate
callback auth: Authorization: Bearer sk-...
status: GENERATING / FINISHED / FAILED
```

## 3. 建立独立微服务

独立服务仍应保持 backend 的 RabbitMQ 与 HTTP 回调契约不变：

```text
backend 发布任务
→ RabbitMQ
→ 独立 worker
→ 生成/上传结果
→ HTTP 回调 backend
```

每个独立服务至少需要：

- 自己的 Dockerfile；
- 自己的配置模型和 `.env.example`；
- RabbitMQ durable exchange/queue；
- 输入消息 Pydantic/JSON Schema 校验；
- backend 回调重试；
- 健康检查；
- 结构化日志；
- 超时、幂等和失败处理；
- 对应 Compose service；
- GitHub Actions 镜像构建项。

## 4. 消费者唯一性规则

同一个 queue 可以运行同一实现的多个副本来横向扩容，但不能让语义不同的实现同时监听。RabbitMQ 会在所有 consumer 之间轮询分配消息，错误的消费者会造成同一功能产生不一致结果。

拆分或替换服务时应先部署新镜像并验证健康，再停止旧消费者，最后确认 queue 的 consumer 数量和实现符合预期。

## 5. 推荐演进顺序

1. 当前 `pretest + plan + quiz`；
2. 已完成：将 `knowledge_explanation` 加入 `core-generation`；
3. 单独实现 `interactive-html-generation`，带浏览器/容器沙盒；
4. 单独实现 `knowledge-video-generation`；
5. 单独实现 `code-video-generation`，所有代码执行必须隔离；
6. 增加 DLQ、幂等表、指标、追踪和任务取消能力。
