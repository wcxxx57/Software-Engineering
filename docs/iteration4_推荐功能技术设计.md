# Iteration4 推荐功能技术设计与联调契约

本文档是 Iteration4 推荐功能的前后端契约。推荐不新增页面，所有内容嵌入现有任务页、AI 伴学侧栏、主控台和 K2V/C2V/2D 工具页。

## 1. 固定知识点边界

只有绑定已发布课程大纲的学习计划，才开启任务级资源推荐。任务使用数据库中的 `curriculum_node_id` 作为唯一知识点身份，不能根据标题、prompt 或 AI 生成文本猜测节点。

`study_task` 新增：

- `curriculum_node_id`：唯一固定大纲节点；
- `day_index`：从 1 开始的逻辑学习日，不等同于自然日期。

旧的 `study_task_curriculum_node` 关系表保留兼容历史知识树。迁移只为“恰好关联一个节点”的旧任务回填字段；多节点和无节点任务保持空值，不进入任务级推荐。

新计划回调只接受单个 `knowledge_node_key`。后端通过模板查询节点标准标题写入任务标题，AI 只能生成个性化描述。每天任务数可以因用户而不同，但同一大纲节点的标题和身份对所有用户一致。

生成回调边界还会再次过滤前测高置信度已掌握节点和该用户已完成的同模板节点。某阶段过滤后为空时，后端按“当前弱项 → 最近完成节点 → 大纲最前节点”选择一个固定节点，创建描述为“针对当前掌握情况的复习”的复习任务，避免产生空阶段。

## 2. 资源目录与访问

`recommendation_resource` 是统一目录：

- `resource_kind`：`KNOWLEDGE_VIDEO`、`CODE_VIDEO`、`INTERACTIVE_HTML`；
- `resource_id`：原有 K2V/C2V/2D 资源 ID；
- `curriculum_node_id`：任务级推荐必须有值，独立精品可以为空；
- `creator_user_id`、`title`、`summary`；
- `quality_status`：`PENDING`、`PASSED`、`REJECTED`；
- `featured`、`display_priority`、时间字段。

`(resource_kind, resource_id)` 唯一，并为节点/类型和精品排序建立索引。任务生成的 K2V/2D 在完成回调时自动写入目录，默认 `PENDING`、非精品；C2V 不自动进入任务级候选，因为知识点任务页没有 C2V 区域。

`recommendation_resource_learning` 以 `(recommendation_resource_id, user_id)` 唯一，记录第一次真实学习行为。K2V/C2V 在视频开始播放时记录，2D 在 iframe 成功加载时记录。人数使用真实去重用户数，文案统一为“已有 N 位学习者学习过”。

非资源所有者只有在资源公开、已完成、有可用对象存储文件且目录满足下列条件之一时才能读取：

1. 有固定 `curriculum_node_id`，属于任务级推荐；或
2. `featured = true` 且 `quality_status = PASSED`，属于独立工具页精品。

私有、未完成、无目录记录的资源仍返回内容不存在。

## 3. 任务级推荐

接口：

```text
GET /api/v1/study-tasks/{task_id}/recommendations
```

响应：

```json
{
  "eligible": true,
  "knowledge_point_title": "大纲标准标题",
  "resources": {
    "knowledge_video": [
      {
        "catalog_id": 12,
        "id": 34,
        "title": "资源标题",
        "summary": "资源摘要",
        "reasons": ["与当前固定知识点匹配", "已有 28 位学习者学习过"],
        "learner_count": 28
      }
    ],
    "interactive_html": []
  }
}
```

候选必须满足：同一 `curriculum_node_id`、同一资源类型、公开、完成、可播放或可加载。任务级推荐不检查 `quality_status` 和 `featured`，只按当前用户与当前知识点的固定规则取前三条：学习目标标签 40%、前测掌握接近度 30%、计划进度接近度 20%、学习语言 10%，再以 70% 相似度与 30% 真实学习人数归一化合成分数。目标标签来自课程模板的受控 aliases，资源排序不由 AI 直接决定。

同分时按学习人数、目录更新时间、目录 ID 稳定排序。理由最多两条，只来自实际规则贡献，不出现“高质量”“人工精选”等标签。

前端行为：

- 任务已有自己的 K2V/2D 时，继续显示原资源，同类型推荐不重复出现；
- 没有自己的资源时，第一条候选直接嵌入原有“沉浸视界”或“2D 可视化操作”结构；
- 不创建独立推荐资源卡，不显示“立即学习”；
- “换一个”只在本类型前三条内轮换，K2V 与 2D 状态互不影响；
- 每个类型始终保留自己的“觉得内容不合适？为当前知识点重新生成”入口；
- 没有绑定大纲、接口 404、请求失败或候选为空时，回到原有生成空态。

## 4. 独立工具页精品

接口：

```text
GET /api/v1/recommendations/featured?kind=knowledge-video|code-video|interactive-html
```

只返回公开、完成、可用、`featured = true` 且 `quality_status = PASSED` 的目录资源。独立页不读取用户画像、不显示个性化理由、学习人数、删除按钮或“已就绪”标签。

前端沿用各工具页现有色系和“生成历史”外框：无资源显示真实空状态框，有资源显示资源卡片列表；点击卡片复用公共播放器/2D 加载入口，即使资源不在当前用户的生成历史中也可以播放。

受控录入使用 `recommendation_seed` 工具或数据库脚本，不在前端伪造资源和人数。

## 5. AI 伴学上下文与真实问题

接口：

```text
GET  /api/v1/study-tasks/{task_id}/chat-context
POST /api/v1/study-tasks/{task_id}/chat-questions
```

上下文按任务固定节点返回课程大纲标准名称、阶段和知识点；前端不在 AI 伴学卡片重复展示课程/阶段/知识点标题。`suggested_questions` 是根据当前标准标题生成的候选问题，和真实热门问题完全分开。

`chat_question` 保存用户原问题、归一化问题、用户 ID、任务和固定节点。上下文按节点聚合相似表达，并按不同用户去重；只有至少两位不同学习者问过的问题进入“大家常问”，不足时整个区域隐藏。不会显示用户身份。AI Chat 的实际回答和消息流仍由 Chat 服务接入，本次后端只提供稳定上下文、问题记录和聚合查询。

## 6. 学习计划推荐与下一阶段

迁移新增：

- `learning_plan_template`：绑定课程模板、受控目标标签、语言、阶段数、预计周期和启用状态；
- `learning_plan_template_stage` / `learning_plan_template_task`：阶段和固定大纲节点任务模板；
- `plan_recommendation_draft`：绑定用户和当前学习计划的推荐草稿，记录 INITIAL/NEXT 类型、阶段摘要、任务数和采用时间。

接口：

```text
GET  /api/v1/study-subjects/{id}/plan-recommendation
GET  /api/v1/study-subjects/{id}/next-plan-recommendation
POST /api/v1/study-subjects/{id}/plan-recommendations/{draft_id}/adopt
```

首次推荐仅在课前测完成、计划处于 `PRETEST_READY` 时返回；当前完整计划未处于 `FINISHED` 时不返回下一阶段推荐。前端始终只渲染一张“下一阶段学习计划”卡片，不同时显示“推荐学习计划”和“下一步建议”。

推荐仍是草稿：预览、继续自定义不会创建正式计划；采用首次草稿后才进入既有计划生成流程；采用下一阶段草稿先创建新的课前测队列，课前测完成后再生成正式任务。推荐生成失败会标记失败并退还本次费用。

## 7. 前端请求状态

Next.js 代理路由和 React Query hook 已覆盖任务推荐、精品推荐、打开记录、Chat 上下文/问题、初始/下一阶段计划推荐和草稿采用。404、空数组、网络失败和未绑定大纲统一渲染为真实空态，不写入演示推荐数据，也不影响原有播放器、生成台、生成历史、计划创建和完成打卡流程。

## 8. 验收命令与场景

已验证：

- 后端 release Docker build 与迁移 `m0001`–`m0008`；
- 前端 `tsc --noEmit`、`next build` 和 Docker frontend build；
- 任务未绑定节点返回 `eligible=false`；
- 同节点 `PENDING` 资源仍能进入任务候选，最多返回 3 条；
- 精品 K2V/C2V/2D 可被非所有者读取；私有资源返回 404；
- 同一用户重复播放/加载只产生一条学习记录；
- 真实不同用户的问题聚合为“大家常问”，单用户问题隐藏；
- 初始草稿采用进入 `PLAN_QUEUING`，完成计划后的草稿采用创建 `PRETEST_QUEUING`；
- 空阶段回调自动生成固定节点复习任务；
- 本地浏览器静态检查任务页、计划页、K2V、C2V、2D 预览，未再出现服务端组件事件回调导致的 500。

推荐反馈、反馈训练和动态重排不在本版范围。
