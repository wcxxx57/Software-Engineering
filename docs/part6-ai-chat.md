# Part 6：个性化 AI 伴学

Part 6 将 Linux RTX 4090 上的 `cloudops-cloud-assistant` 接入主页、知识点页面和全屏 `/ai-chat` 页面。

## 本地启动

先确保 vLLM 已经以 `cloudops-cloud-assistant` 作为 served model 启动，然后在 macOS 上建立隧道：

```bash
ssh -N -L 8000:127.0.0.1:8000 tyj@100.127.190.81
```

在前端目录的 `frontend/.env.local` 中配置（根目录 `.env` 仅供 Compose 使用）：

```env
BACKEND_API_URL=http://127.0.0.1:9000
AI_CHAT_BASE_URL=http://127.0.0.1:8000/v1
AI_CHAT_MODEL=cloudops-cloud-assistant
AI_CHAT_API_KEY=
AI_CHAT_TIMEOUT_MS=120000
AI_CHAT_MAX_TOKENS=512
```

如果本地已经存在旧版 `CLOUDOPS_AI_BASE_URL`、`CLOUDOPS_AI_MODEL`、`CLOUDOPS_AI_API_KEY` 配置，前端会自动兼容读取；新配置优先级更高。

随后启动后端和前端，登录后访问：

```text
http://localhost:3000/dashboard
http://localhost:3000/ai-chat
http://localhost:3000/ai-chat?taskId=<当前任务 ID>
```

## Docker 部署

Compose 已为前端添加 `host.docker.internal:host-gateway`。Linux 宿主机上的 vLLM 需要监听 Docker 网桥可访问的地址，并开启 API Key；不要把 vLLM 的 8000 端口交给 Nginx 或直接暴露到公网。生产环境 `.env` 可使用：

```env
AI_CHAT_BASE_URL=http://host.docker.internal:8000/v1
AI_CHAT_MODEL=cloudops-cloud-assistant
AI_CHAT_API_KEY=<与 vLLM 一致的密钥>
```

如果 vLLM 仍只绑定 `127.0.0.1`，容器无法访问它。可以将服务绑定到受防火墙保护的私网接口，或者让前端运行在宿主机网络中；无论哪种方式，都必须保留 API Key 和 8000 端口的访问控制。

## 个性化上下文

`GET /api/v1/me/learning-profile` 只返回教学所需的压缩画像：课程、语言、目标、进度、测验正确率和错题聚合出的薄弱知识点。密码、金币、钻石、原始出生年份和性别不会发送给模型。

知识点会话还会携带课程、阶段、知识点任务描述，以及当前页面已生成讲解的限长摘要。该机制是结构化页面上下文注入，不是向量数据库 RAG。

桌面端在主页和知识点页显示侧栏聊天框；窄屏会隐藏侧栏并显示右下角的“AI 伴学”浮动入口，点击后打开响应式底部抽屉。每次打开默认开始一段新对话；从小窗进入全屏时会携带当前会话 ID，保证正在进行的对话可以继续。

## 安全边界

每条新问题先经过领域分类，再进入生成模型。模型系统提示再次限制在计算机知识和当前计算机课程范围内。分类失败采用失败关闭；越界问题返回固定拒答，不将内容交给生成模型。

聊天历史现在由后端通过 PostgreSQL 持久化，按用户和场景隔离。浏览器不能直接连接数据库，Next.js
服务端代理会把 JWT 转发给后端的受保护接口：

```text
GET    /api/v1/me/ai-chat/conversations?scope=general
GET    /api/v1/me/ai-chat/messages?scope=general&conversation_id=<会话 ID>
GET    /api/v1/me/ai-chat/messages?scope=task&task_id=<任务 ID>&conversation_id=<会话 ID>
POST   /api/v1/me/ai-chat/messages
DELETE /api/v1/me/ai-chat/messages?scope=...&conversation_id=<会话 ID>
```

后端迁移 `m0009_ai_chat_history` 创建 `ai_chat_message` 表，`m0010_ai_chat_conversations`
增加会话维度。消息使用客户端 ID 做幂等去重，每段会话最多保留最近 50 条，全屏页最多列出最近
30 段会话。任务场景在读写前会再次校验任务归属，避免不同用户互相读取历史。浏览器不读取、迁移或降级保存聊天历史；数据库不可用时只保留当前页面内存中的临时显示，并明确提示本轮不会写入历史记录。

## 验收清单

- 主页侧边栏和移动端 AI 入口可以发送问题并看到流式回答。
- 知识点页面回答会显示当前知识点相关内容；从小窗打开全屏后历史不丢失。
- `/ai-chat` 可选择历史会话继续对话，也可删除、停止、重试和开始新对话。
- 询问娱乐、情感、医疗等非计算机内容时得到固定拒答。
- 刷新页面默认进入新对话；只有显式选择历史会话或携带会话 ID 进入全屏时才会恢复旧对话。
