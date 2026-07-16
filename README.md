# Education2D

固定样式、Agent 驱动的计算机与编程知识二维交互可视化。

它不是课程系统，也不是让大模型反复生成 HTML 的代码生成器。大模型只能通过严格工具读取和修改 `VisualizationSpec`；React/SVG 渲染器、设计令牌和组件外观始终由代码固定。

## 为什么这属于 Agent 开发

系统包含两个基于 LangChain `createAgent`（LangGraph runtime）的工具调用 Agent：

1. 可视化创作 Agent：查询固定组件目录，提交完整 Spec，读取校验错误并修复重试。
2. 可视化编辑 Agent：观察当前图，再选择 Patch、整图替换、时间轴、历史或解释工具，并读取工具执行结果。

这两条链路都具备“模型决策 → 调用工具 → 获取 observation → 继续决策/结束”，而不是从回复文本中正则提取 JSON。

```text
知识点 ─→ Author Agent ─→ inspect catalog ─→ submit spec ─→ validate ─→ version store
自然语言 ─→ Editor Agent ─→ inspect scene ─┬→ atomic patch/replace ─→ new version
                                            ├→ playback/history
                                            └→ explain/out_of_scope
版本 Spec ─→ deterministic layout ─→ fixed React/SVG component registry
```

## 快速开始

环境要求：Node.js 20.19+、npm。

```powershell
cd E:\code\AI_study\education2d
npm install
Copy-Item ..\education3d\education3d\.env .env
npm run dev
```

- 前端开发地址：<http://localhost:5173>
- API 服务：<http://localhost:3100>
- 不配置模型也可以点击“打开内置演示”查看固定渲染和运行步骤。

如果不复用原项目配置，可从示例创建：

```powershell
Copy-Item .env.example .env
```

必要变量：

```dotenv
DMX_BASE_URL=https://vip.dmxapi.com/v1
DMX_API_KEY=...
LOGIC_MODEL=...     # 编辑 Agent 默认模型
CODE_MODEL=...      # 创作 Agent 默认模型
AGENT_MODEL=...     # 可选，覆盖 LOGIC_MODEL
AUTHOR_MODEL=...    # 可选，覆盖 CODE_MODEL
```

## 样式不变是怎样保证的

- `VisualizationSpec`、`PatchSet` 和工具输入均使用 Zod strict schema。
- Spec 中不存在 `style`、`className`、颜色、字体、HTML、SVG 或 JavaScript 字段。
- Agent 只能设置 `normal/active/visited/success/error/muted` 语义状态。
- 语义状态由固定 CSS 设计令牌映射为颜色、线宽和动画。
- 修改先在深拷贝上执行；全量引用校验通过后才原子提交。
- 浏览器画布暴露稳定的 `data-theme-version` 和 `data-theme-token-hash`，测试会在结构修改前后比较。

内容、结构、标签、数据、布局、代码和步骤都可修改。整图重构仍然只能组合固定组件。要求换配色/字体时，Agent 会说明样式已锁定；固定组件无法表达的请求会返回 unsupported，绝不退回任意代码生成。

## 版本与运行状态

- 初次创建及每次内容修改都会在 `data/visualizations/<id>/versions/` 产生不可变 JSON 版本。
- 版本 ID 是版本内容的 SHA-256；`index.json` 持久化 current/undo/redo 指针。
- 新编辑会清空 redo 栈，但历史文件仍保留。
- 播放、暂停、步进和临时高亮属于运行状态，不创建版本，刷新后回到第 0 步。
- 请求携带 `baseVersionId`；并发旧请求返回 HTTP/SSE `VERSION_CONFLICT`。
- 没有公开分享、分享令牌、用户系统或远程发布功能。

## API

| Endpoint | 作用 |
| --- | --- |
| `POST /api/visualizations/generate` | SSE：使用创作 Agent 生成可视化 |
| `POST /api/visualizations/demo?fixture=tree` | 创建内置演示，无需模型 |
| `GET /api/visualizations/:id` | 读取当前 Spec 与版本状态 |
| `GET /api/visualizations/:id/versions` | 读取不可变版本记录 |
| `POST /api/visualizations/:id/agent` | SSE：使用编辑 Agent 自然语言操控 |
| `POST /api/visualizations/:id/history` | 确定性 undo/redo |

Agent SSE 只公开进度、工具名、结果状态、运行命令、版本和面向用户的说明，不公开隐藏推理。

## 固定组件

首版组件注册表覆盖：数组、节点、指针、栈、队列、调用栈、内存网格、时间线、流水线、逻辑分组、文本注释、矩形、圆形和菱形。关系支持 edge、arrow、link、flow、dependency；布局支持 manual、row、column、grid、tree、force、timeline 和 pipeline。

内置样例覆盖数组排序、二叉树遍历、图搜索、栈/队列、递归调用栈、TCP 时序和 CPU 流水线。

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

真实 DMX 两轮连续工具调用契约测试默认跳过，以免普通测试产生模型费用：

```powershell
$env:RUN_PROVIDER_CONTRACT='1'
npm run test:provider
```

若这里返回“模型无可用通道”或“token quota 不足”，属于 DMX 模型通道/余额问题；设置一个可用且支持原生 tool calling 的 `AGENT_MODEL` 后重试。系统不会降级到文本 JSON 解析。

测试覆盖 strict schema、非法引用、样式字段拒绝、Patch 原子性、版本冲突、持久化 undo/redo、LangChain 模拟多轮工具调用、固定主题哈希及 Playwright 浏览器闭环。

## 目录

```text
src/shared/    Zod 协议、校验、Patch、运行状态、组件目录、样例
src/server/    Express API、LangChain Agents、版本存储、审计日志
src/client/    React UI、SVG 组件渲染、D3 布局、固定设计令牌
tests/         单元、API、Agent、Provider contract 与 Playwright 测试
data/          本地版本和 Agent 工具审计（git ignored）
```
