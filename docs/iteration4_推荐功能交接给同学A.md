# Iteration4 推荐功能交接文档（AI Chat 接入）

> 交接对象：同学 A  
> 当前分支：`iteration4`  
> 交接日期：2026-08-04  
> 关联设计：[iteration4_推荐功能技术设计.md](./iteration4_推荐功能技术设计.md)

## 1. 交接结论

推荐功能的前端、推荐后端、数据库迁移、固定知识点绑定、推荐排序、真实问题聚合、计划推荐接口和测试已经完成。现在可以交接。

同学 A 本次只需要完成：

1. 将真实 AI Chat 服务接入知识点任务页右侧的 AI 伴学区域；
2. 发送用户问题并渲染真实回答、加载态、失败态和重试；
3. 在问题发送成功后调用“保存用户提问”接口；
4. 使用任务对应的课程、阶段和固定大纲知识点作为 Chat 上下文；
5. 为 AI Chat 接入补充接口/组件测试，并在部署环境联调。

推荐排序、推荐资源访问、精品推荐、计划推荐和“大家常问”的统计逻辑不要重复实现，也不要改成标题字符串匹配。

## 2. 当前已经完成的内容

### 推荐后端

- 任务只通过 `study_task.curriculum_node_id` 绑定固定大纲节点。
- 任务级只推荐 K2V 和可操控 2D，不推荐 C2V。
- 推荐资源必须属于同一个 `curriculum_node_id`，已生成完成、公开且可正常播放/加载。
- 每个类型最多返回 3 条，按固定可解释规则排序。
- “换一个”由前端在返回的候选中轮换，不会重新请求出一套不可解释的结果。
- 独立 K2V/C2V/2D 页面只展示 `featured = true` 且 `quality_status = PASSED` 的精品资源，不读取用户画像。
- 推荐资源的学习人数使用真实去重用户行为，同一用户重复打开只计一次。
- 公共资源访问已增加公开、完成、目录存在和对象文件存在校验。
- 计划推荐和下一阶段推荐都是草稿；采用前不会创建正式学习计划。
- 未完成当前完整计划时不会返回下一阶段推荐；页面只保留一个“下一阶段学习计划”卡片。

### AI Chat 数据后端

- 根据任务的固定 `curriculum_node_id` 获取课程、阶段和知识点标准标题。
- “猜你想问”与“大家常问”分开返回。
- “大家常问”只统计真实历史问题，按不同用户去重。
- 少于 2 个不同用户的问题不会显示为高频问题。
- 后端不返回用户身份和私人信息。
- 问题可由 Chat 服务传入 `normalized_question` 作为聚类键；不传时后端使用保守的规范化逻辑。

### 前端

- AI 伴学已嵌入现有任务页右栏，没有新增页面。
- 不重复显示课程、阶段、当前知识点上下文文字；知识点标题已经在主学习区显示。
- 保留“猜你想问”“大家常问”、消息区、输入框和发送按钮的视觉壳。
- “大家常问”为空时整个区域隐藏。
- 任务级推荐直接嵌入原有“沉浸视界”和“2D 可视化操作”，没有独立资源卡。
- 当前输入框和发送按钮暂时是视觉占位，等待真实 Chat 服务接入后启用。

## 3. AI Chat 接口契约

所有请求都需要使用当前登录用户身份。浏览器侧优先调用 Next.js 代理，不要在组件中直接拼接后端地址。

### 3.1 获取 Chat 上下文和问题区

浏览器侧：

```http
GET /api/study-tasks/{taskId}/chat-context
```

后端实际接口：

```http
GET /api/v1/study-tasks/{taskId}/chat-context
```

返回结构：

```json
{
  "course_title": "Python 基础",
  "stage_title": "树结构",
  "knowledge_point_title": "二叉搜索树",
  "suggested_questions": [
    { "question": "二叉搜索树和普通二叉树有什么区别？" },
    { "question": "为什么查找效率与树的高度有关？" }
  ],
  "popular_questions": [
    {
      "question": "删除有两个子节点的节点时怎么办？",
      "learner_count": 8
    }
  ]
}
```

字段约定：

- `knowledge_point_title` 是大纲节点的标准标题，只用于 Chat 上下文和兼容展示，不要用它反查推荐资源。
- `suggested_questions` 可以由后续 Chat 服务替换为更个性化的问题，但必须和 `popular_questions` 分开渲染。
- `popular_questions` 是真实历史聚合结果，不得由 AI 生成问题填充。
- `popular_questions` 为空时，前端隐藏整个“大家常问”容器。

前端现有查询 hook：

```ts
useTaskChatContext(taskId)
```

位置：`frontend/src/lib/query/recommendations.ts`。

### 3.2 保存用户提问记录

浏览器侧：

```http
POST /api/study-tasks/{taskId}/chat-questions
Content-Type: application/json
```

后端实际接口：

```http
POST /api/v1/study-tasks/{taskId}/chat-questions
```

请求体：

```json
{
  "question": "删除有两个子节点的节点时怎么办？",
  "normalized_question": "删除两个子节点节点怎么办"
}
```

响应：

```json
{
  "saved": true
}
```

说明：

- `question` 必填，长度 2–500 个字符。
- `normalized_question` 可选。如果 Chat 服务有自己的语义聚类结果，可以传入稳定的聚类键；没有就省略。
- 记录接口必须绑定当前任务和当前登录用户，后端会自动写入 `curriculum_node_id`。
- 不要从浏览器传入 `user_id`、课程 ID 或知识点 ID 来覆盖后端上下文。
- 推荐在确认问题已经被 Chat 服务接受后保存；如果产品决定“点击发送即记录”，需要和后端联调时统一口径。

## 4. 建议的 Chat 接入流程

```text
打开固定知识点任务页
        │
        ├─ useTaskChatContext(taskId)
        │       ├─ 渲染猜你想问
        │       └─ 有真实聚合数据时渲染大家常问
        │
用户点击问题或手动输入
        │
校验非空 → 组装固定任务上下文
        │
调用 AI Chat 服务
        │       ├─ 课程
        │       ├─ 阶段
        │       ├─ curriculum_node_id / 标准知识点标题
        │       └─ 当前知识点资料优先
        │
显示用户消息 → 显示加载态 → 显示 AI 回答或错误重试
        │
Chat 服务接受问题后
        └─ POST /api/study-tasks/{taskId}/chat-questions
```

AI Chat 服务的回答检索和模型调用由同学 A 负责。推荐后端只负责提供稳定的任务上下文和真实问题聚合，不负责生成回答。

建议传给 Chat 服务的上下文最少包括：

```ts
{
  taskId: number;
  courseTitle: string;
  stageTitle: string;
  knowledgePointTitle: string;
  curriculumNodeId?: number;
  question: string;
}
```

其中 `curriculumNodeId` 来自后端任务数据或任务推荐上下文，不要根据标题自行查询或模糊匹配。

## 5. 前端需要修改的位置

主要文件：

- `frontend/src/components/learn/task-sidebar.tsx`
  - 将输入框从视觉禁用状态改为由 Chat 接入控制；
  - 发送后追加用户消息和 AI 返回消息；
  - 保留现有“猜你想问”“大家常问”的样式和空态规则；
  - 不再写死示例 AI 回复。
- `frontend/src/lib/query/recommendations.ts`
  - 继续复用 `useTaskChatContext`；如 Chat 服务有独立会话接口，可新增独立 hook，不要修改推荐 hook 的排序和候选数据。
- `frontend/src/lib/api/schemas.ts`
  - 若 Chat 服务返回流式消息或会话 ID，在这里增加独立 schema；不要把 Chat 消息字段塞进推荐资源 schema。
- `frontend/src/app/api/study-tasks/[id]/chat-questions/route.ts`
  - 已有保存问题代理；除非 Chat 服务需要额外字段，否则不要改变现有请求契约。
- `frontend/src/app/api/study-tasks/[id]/chat-context/route.ts`
  - 已有上下文代理；不要在前端自行拼课程、阶段或知识点标题。

如果 AI Chat 服务部署在独立服务，建议新建单独的 Next.js 代理路由，例如 `/api/chat/ask` 或 `/api/chat/stream`，由服务端注入密钥和用户身份。不要把模型密钥放在浏览器端。

## 6. 必须保留的产品规则

- 不新增 AI Chat 独立页面。
- 不在右栏重复显示“课程 / 阶段 / 当前知识点”卡片。
- “猜你想问”是个性化候选，可由 Chat 服务生成或排序；“大家常问”只能来自真实历史问题。
- 不显示用户昵称、头像、账号、具体身份或私人信息。
- 不把“大家常问”中的问题复制为 AI 生成的热门问题。
- 任务页面不添加 C2V 推荐。
- 不把任务级推荐拆成独立资源卡，也不要新增“立即学习”按钮。
- 不修改固定大纲节点绑定，不用标题字符串猜测知识点归属。
- 不在未完成当前完整计划时显示下一阶段计划。
- 不添加“高质量”“精选”“人工筛选”等资源标签。

## 7. 异常、空态和安全要求

| 场景 | 预期行为 |
| --- | --- |
| Chat context 返回 404 | 保留 AI 伴学外框，隐藏没有数据的问题区，不影响主页面 |
| Chat context 请求失败 | 不崩溃、不伪造热门问题，可显示轻量错误或保持空态 |
| `popular_questions` 为空 | 整个“大家常问”区域隐藏 |
| 用户未输入内容 | 不发送请求、不保存空问题 |
| AI 服务超时/失败 | 显示失败态和重试，不伪造 AI 回答 |
| 保存问题失败 | 不影响当前回答展示，但记录错误并允许后续重试/补记 |
| 非本人任务 | 后端返回未找到/无权限，前端不要泄露任务信息 |
| 知识点没有固定大纲节点 | 不向推荐和 Chat 传入猜测的节点 ID |

所有 AI 服务错误都应在服务端日志中记录 request/session 标识，但页面不向用户展示 token、内部 URL 或堆栈。

## 8. 交接验收清单

### 功能

- [ ] 打开一个绑定课程大纲的知识点任务，Chat 能拿到正确课程、阶段、标准知识点标题。
- [ ] 点击“猜你想问”或“大家常问”后，问题进入输入框。
- [ ] 手动发送问题后，页面按“用户消息 → 加载态 → AI 回答”顺序展示。
- [ ] Chat 服务接受问题后，`POST /chat-questions` 成功保存。
- [ ] 同一问题由两个不同账号真实提问后，重新打开任务能看到“大家常问”和去重人数。
- [ ] 只有一个账号提问时，不显示“大家常问”区域。
- [ ] 相似表达传入同一 `normalized_question` 后能合并统计。
- [ ] 热门问题不显示用户身份信息。

### 稳定性

- [ ] Chat 服务 404、超时、500 时页面不白屏。
- [ ] 问题保存失败时不伪造保存成功提示。
- [ ] 刷新页面后不会重复追加同一条本地消息。
- [ ] 桌面端和窄屏下输入区、问题区不溢出。
- [ ] 不影响沉浸视界、2D 可视化操作、推荐资源“换一个”和学习计划卡片。

### 联调

- [ ] 使用部署环境的真实 Chat 服务地址和服务端密钥。
- [ ] 用至少两个真实测试账号生成不同表达的问题。
- [ ] 检查数据库中问题均绑定正确 `study_task_id` / `curriculum_node_id`。
- [ ] 确认生产环境不展示演示页面中的静态示例问题作为真实热门数据。
- [ ] 部署后重新执行前端构建、后端接口冒烟和浏览器验收。

## 9. 本地验证命令

在仓库根目录执行：

```powershell
# 查看当前分支和提交
git checkout iteration4
git log -5 --oneline

# 前端类型检查 / 构建
cd frontend
pnpm exec tsc --noEmit
pnpm build

# 后端单元与推荐集成测试
cd ..\backend
cargo test --lib
cargo test --test recommendations
```

静态视觉预览（不调用真实 Chat 服务）：

```text
http://127.0.0.1:3100/preview/iteration4?view=task
```

生产组件本地联调时，推荐接口和 Chat context 使用真实后端；Chat 回答服务由同学 A 接入后再打开输入发送能力。

## 10. 不在本次交接范围内

- 推荐反馈和基于反馈的重排；
- 重新设计任务页、独立资源页或全局视觉；
- 修改推荐排序、计划模板、数据库迁移和公共资源访问规则；
- 用模拟热门问题替代真实用户提问；
- 在前端硬编码课程、阶段或知识点标题作为后端事实来源。

## 11. 建议交付物

同学 A 完成后请一并提交：

1. AI Chat 服务接口说明（请求字段、响应字段、流式/非流式方式、错误码）；
2. 前端 Chat 接入代码和必要的环境变量说明；
3. 用户提问保存时机说明；
4. 至少一个 Chat 成功、超时、失败和空态测试；
5. 两个测试账号的真实提问联调记录；
6. 部署后的浏览器截图或验收记录。

完成以上内容后，推荐功能即可由“前端 + 推荐后端”进入“完整 AI Chat 联调”阶段。
