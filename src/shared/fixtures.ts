import type { VisualizationSpec } from "./schema.js";

export const bubbleSortFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "冒泡排序",
  concept: "相邻元素比较与交换",
  description: "较大的元素在每轮比较中逐步移动到数组右侧。",
  language: "Python",
  layout: { type: "manual", direction: "left-to-right", gap: 28 },
  elements: [
    { id: "array", kind: "array", label: "待排序数组", value: [5, 2, 4, 1, 3], state: "normal", visible: true, layout: { x: 550, y: 250, width: 720 } },
    { id: "left", kind: "pointer", label: "i", value: 0, state: "active", visible: true, layout: { x: 250, y: 390 } },
    { id: "right", kind: "pointer", label: "j", value: 1, state: "active", visible: true, layout: { x: 370, y: 390 } },
    { id: "note", kind: "annotation", label: "比较相邻元素", value: "若左值大于右值，则交换", state: "normal", visible: true, layout: { x: 360, y: 90, width: 480 } },
  ],
  relations: [],
  parameters: [{ id: "speed", label: "播放速度", type: "select", default: "normal", options: ["slow", "normal", "fast"] }],
  variants: [{ id: "ascending", label: "升序" }, { id: "descending", label: "降序" }],
  code: {
    language: "python",
    title: "冒泡排序",
    lines: [
      "for i in range(len(a) - 1):",
      "    for j in range(len(a) - 1 - i):",
      "        if a[j] > a[j + 1]:",
      "            a[j], a[j + 1] = a[j + 1], a[j]",
    ],
  },
  steps: [
    { id: "compare", title: "比较 5 和 2", description: "检查第一对相邻元素。", codeLine: 2, operations: [{ type: "setState", targetId: "array", state: "active" }, { type: "focus", targetIds: ["array", "left", "right", "note"] }] },
    { id: "swap", title: "交换", description: "5 大于 2，交换两者。", codeLine: 3, operations: [{ type: "setValue", targetId: "array", value: [2, 5, 4, 1, 3] }, { type: "setState", targetId: "array", state: "success" }] },
    { id: "advance", title: "指针右移", description: "继续比较下一对相邻元素。", codeLine: 1, operations: [{ type: "setValue", targetId: "left", value: 1 }, { type: "setValue", targetId: "right", value: 2 }] },
  ],
};

export const treeTraversalFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "二叉树前序遍历",
  concept: "根节点 → 左子树 → 右子树",
  description: "使用节点、连线和辅助栈展示前序遍历。",
  language: "Python",
  layout: { type: "tree", direction: "top-to-bottom", rootId: "root", gap: 54 },
  elements: [
    { id: "root", kind: "node", label: "根", value: "A", state: "normal", visible: true },
    { id: "left", kind: "node", value: "B", state: "normal", visible: true },
    { id: "right", kind: "node", value: "C", state: "normal", visible: true },
    { id: "leftLeft", kind: "node", value: "D", state: "normal", visible: true },
    { id: "leftRight", kind: "node", value: "E", state: "normal", visible: true },
  ],
  relations: [
    { id: "ab", kind: "edge", from: "root", to: "left", state: "normal", directed: true, visible: true },
    { id: "ac", kind: "edge", from: "root", to: "right", state: "normal", directed: true, visible: true },
    { id: "bd", kind: "edge", from: "left", to: "leftLeft", state: "normal", directed: true, visible: true },
    { id: "be", kind: "edge", from: "left", to: "leftRight", state: "normal", directed: true, visible: true },
  ],
  parameters: [], variants: [{ id: "preorder", label: "前序" }, { id: "inorder", label: "中序" }, { id: "postorder", label: "后序" }],
  steps: [
    { id: "visitRoot", title: "访问根节点 A", description: "前序遍历首先处理根节点。", operations: [{ type: "setState", targetId: "root", state: "active" }] },
    { id: "finishRoot", title: "A 已访问", description: "记录 A，随后进入左子树。", operations: [{ type: "setState", targetId: "root", state: "visited" }, { type: "setState", targetId: "left", state: "active" }] },
  ],
};

export const graphSearchFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "图的广度优先搜索",
  concept: "使用队列逐层探索图节点",
  description: "蓝色表示当前节点，紫色表示已经访问。",
  layout: { type: "force", direction: "left-to-right", gap: 48 },
  elements: ["A", "B", "C", "D", "E"].map((value) => ({ id: `node${value}`, kind: "node" as const, value, state: "normal" as const, visible: true })),
  relations: [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["D", "E"]].map(([from, to]) => ({ id: `edge${from}${to}`, kind: "edge" as const, from: `node${from}`, to: `node${to}`, state: "normal" as const, directed: false, visible: true })),
  parameters: [{ id: "start", label: "起点", type: "select", default: "A", options: ["A", "B", "C", "D", "E"] }],
  variants: [{ id: "bfs", label: "BFS" }, { id: "dfs", label: "DFS" }],
  steps: [
    { id: "enqueueA", title: "A 入队", description: "从 A 开始搜索。", operations: [{ type: "setState", targetId: "nodeA", state: "active" }] },
    { id: "visitA", title: "访问 A", description: "标记 A，并发现 B、C。", operations: [{ type: "setState", targetId: "nodeA", state: "visited" }, { type: "setState", targetId: "nodeB", state: "active" }, { type: "setState", targetId: "nodeC", state: "active" }] },
  ],
};

export const stackQueueFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "栈与队列",
  concept: "LIFO 与 FIFO 的操作差异",
  description: "相同数据进入两种容器后，取出顺序不同。",
  layout: { type: "manual", direction: "left-to-right", gap: 60 },
  elements: [
    { id: "source", kind: "array", label: "输入", value: [1, 2, 3], state: "normal", visible: true, layout: { x: 550, y: 90, width: 420 } },
    { id: "stack", kind: "stack", label: "栈 · LIFO", value: [1, 2, 3], state: "normal", visible: true, layout: { x: 300, y: 380 } },
    { id: "queue", kind: "queue", label: "队列 · FIFO", value: [1, 2, 3], state: "normal", visible: true, layout: { x: 790, y: 380, width: 430 } },
  ],
  relations: [
    { id: "toStack", kind: "flow", from: "source", to: "stack", label: "push", state: "normal", directed: true, visible: true },
    { id: "toQueue", kind: "flow", from: "source", to: "queue", label: "enqueue", state: "normal", directed: true, visible: true },
  ],
  parameters: [], variants: [],
  steps: [
    { id: "pop", title: "栈弹出 3", description: "最后进入的 3 最先离开。", operations: [{ type: "setValue", targetId: "stack", value: [1, 2] }, { type: "setState", targetId: "stack", state: "active" }] },
    { id: "dequeue", title: "队列移出 1", description: "最先进入的 1 最先离开。", operations: [{ type: "setValue", targetId: "queue", value: [2, 3] }, { type: "setState", targetId: "queue", state: "active" }] },
  ],
};

export const callStackFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "递归调用栈",
  concept: "函数调用帧的压栈与返回",
  description: "以 factorial(3) 展示递归深入和逐层返回。",
  layout: { type: "manual", direction: "left-to-right", gap: 60 },
  elements: [
    { id: "frames", kind: "callStack", label: "调用栈", value: ["factorial(3)"], state: "normal", visible: true, layout: { x: 320, y: 340 } },
    { id: "rule", kind: "annotation", label: "递归规则", value: "n × factorial(n - 1)", state: "normal", visible: true, layout: { x: 780, y: 200, width: 380 } },
    { id: "result", kind: "rect", label: "返回值", value: "等待计算", state: "muted", visible: true, layout: { x: 780, y: 430, width: 260 } },
  ],
  relations: [{ id: "returnFlow", kind: "flow", from: "frames", to: "result", label: "return", state: "normal", directed: true, visible: true }],
  parameters: [{ id: "n", label: "输入 n", type: "number", default: 3, min: 0, max: 8 }], variants: [],
  steps: [
    { id: "call2", title: "调用 factorial(2)", description: "新的调用帧压入栈顶。", operations: [{ type: "setValue", targetId: "frames", value: ["factorial(3)", "factorial(2)"] }, { type: "setState", targetId: "frames", state: "active" }] },
    { id: "base", title: "到达基本情况", description: "继续调用直到 factorial(0)。", operations: [{ type: "setValue", targetId: "frames", value: ["factorial(3)", "factorial(2)", "factorial(1)", "factorial(0)"] }] },
    { id: "return", title: "逐层返回", description: "弹出调用帧并累乘得到 6。", operations: [{ type: "setValue", targetId: "frames", value: [] }, { type: "setValue", targetId: "result", value: 6 }, { type: "setState", targetId: "result", state: "success" }] },
  ],
};

export const timelineFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "TCP 三次握手",
  concept: "客户端与服务端建立可靠连接的时序",
  description: "时间轴与消息箭头表示 SYN、SYN-ACK 和 ACK。",
  layout: { type: "manual", direction: "top-to-bottom", gap: 64 },
  elements: [
    { id: "client", kind: "timeline", label: "客户端时间线", value: ["CLOSED", "SYN-SENT", "ESTABLISHED"], state: "normal", visible: true, layout: { x: 550, y: 140, width: 780 } },
    { id: "server", kind: "timeline", label: "服务端时间线", value: ["LISTEN", "SYN-RCVD", "ESTABLISHED"], state: "normal", visible: true, layout: { x: 550, y: 430, width: 780 } },
  ],
  relations: [
    { id: "syn", kind: "flow", from: "client", to: "server", label: "SYN", state: "normal", directed: true, visible: true },
    { id: "synAck", kind: "flow", from: "server", to: "client", label: "SYN + ACK", state: "muted", directed: true, visible: true },
  ],
  parameters: [], variants: [],
  steps: [
    { id: "sendSyn", title: "客户端发送 SYN", description: "客户端请求建立连接并进入 SYN-SENT。", operations: [{ type: "setState", targetId: "syn", state: "active" }, { type: "setState", targetId: "client", state: "active" }] },
    { id: "sendSynAck", title: "服务端响应 SYN-ACK", description: "服务端确认请求，同时发送自己的同步请求。", operations: [{ type: "setState", targetId: "syn", state: "visited" }, { type: "setState", targetId: "synAck", state: "active" }] },
    { id: "connected", title: "连接建立", description: "客户端回送 ACK，双方进入 ESTABLISHED。", operations: [{ type: "setState", targetId: "client", state: "success" }, { type: "setState", targetId: "server", state: "success" }] },
  ],
};

export const pipelineFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "CPU 指令流水线",
  concept: "取指、译码、执行、访存与写回并行推进",
  description: "固定流水线组件展示指令在各阶段间移动。",
  layout: { type: "manual", direction: "left-to-right", gap: 48 },
  elements: [
    { id: "pipeline", kind: "pipeline", label: "五级流水线", value: ["IF", "ID", "EX", "MEM", "WB"], state: "normal", visible: true, layout: { x: 550, y: 230, width: 850 } },
    { id: "registers", kind: "memoryGrid", label: "流水线寄存器", value: ["IF/ID", "ID/EX", "EX/MEM", "MEM/WB"], state: "normal", visible: true, layout: { x: 550, y: 480, width: 600, height: 170 } },
  ],
  relations: [{ id: "latch", kind: "dependency", from: "pipeline", to: "registers", label: "时钟沿锁存", state: "normal", directed: true, visible: true }],
  parameters: [], variants: [],
  steps: [
    { id: "fetch", title: "取指", description: "第一条指令进入 IF。", operations: [{ type: "setState", targetId: "pipeline", state: "active" }] },
    { id: "latchStep", title: "时钟沿锁存", description: "阶段输出写入流水线寄存器。", operations: [{ type: "setState", targetId: "latch", state: "active" }, { type: "setState", targetId: "registers", state: "visited" }] },
  ],
};

export const densePipelineFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "冒泡排序：比较流水线",
  concept: "把相邻元素送入比较、判断、交换和固定流水线",
  description: "重现多行、多宽度流水线元素的布局回归。",
  language: "Python",
  layout: { type: "pipeline", direction: "left-to-right", gap: 36 },
  elements: [
    { id: "inputArray", kind: "array", label: "当前数组", value: [3, 2, 1], state: "normal", visible: true, layout: { row: 0, column: 0, width: 480, height: 82 } },
    { id: "pair", kind: "array", label: "当前相邻对", value: [3, 2], state: "active", visible: true, layout: { row: 1, column: 0, width: 210, height: 82 } },
    { id: "compare", kind: "diamond", label: "左边 > 右边？", value: "3 > 2", state: "active", visible: true, layout: { row: 1, column: 1, width: 180, height: 100 } },
    { id: "swap", kind: "node", label: "交换并让较大值右移", value: "是：交换", state: "normal", visible: true, layout: { row: 2, column: 1, width: 210, height: 82 } },
    { id: "fixed", kind: "array", label: "右侧已固定", value: [], state: "muted", visible: true, layout: { row: 2, column: 2, width: 180, height: 82 } },
  ],
  relations: [
    { id: "rInputPair", kind: "flow", from: "inputArray", to: "pair", label: "取相邻元素", state: "normal", directed: true, visible: true },
    { id: "rPairCompare", kind: "flow", from: "pair", to: "compare", label: "比较", state: "active", directed: true, visible: true },
    { id: "rYes", kind: "flow", from: "compare", to: "swap", label: "是", state: "normal", directed: true, visible: true },
    { id: "rSwapFixed", kind: "flow", from: "swap", to: "fixed", label: "轮末固定", state: "normal", directed: true, visible: true },
  ],
  parameters: [], variants: [],
  steps: [
    { id: "compareFirst", title: "比较第一对", description: "第 1 轮第 1 次比较 3 和 2；3 从索引 0 向右移动。", operations: [
      { type: "setState", targetId: "compare", state: "active" },
    ] },
    { id: "finishRound", title: "完成第一轮", description: "每轮结束时，未排序区的最大值会进入右侧有序区。", operations: [
      { type: "setValue", targetId: "inputArray", value: [2, 1, 3] },
      { type: "setValue", targetId: "fixed", value: [3] },
    ] },
    { id: "earlyStopCheck", title: "检查提前结束", description: "如果一整轮都没有交换，说明数组已经有序，可以直接结束排序。", operations: [{ type: "setState", targetId: "compare", state: "success" }] },
  ],
};

export const blockedRelationFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "连线自动绕开节点",
  concept: "关系路径不能穿过无关元素",
  description: "起点与终点之间存在多个障碍节点，连线应自动绕行。",
  layout: { type: "manual", direction: "left-to-right", gap: 28 },
  elements: [
    { id: "source", kind: "node", label: "起点", value: "A", state: "normal", visible: true, layout: { x: 130, y: 320, width: 120, height: 90 } },
    { id: "blocker", kind: "annotation", label: "中间节点", value: "连线不能从这里穿过", state: "visited", visible: true, layout: { x: 550, y: 320, width: 280, height: 120 } },
    { id: "upper", kind: "rect", label: "上方障碍", value: "B", state: "normal", visible: true, layout: { x: 550, y: 190, width: 180, height: 90 } },
    { id: "target", kind: "node", label: "终点", value: "C", state: "success", visible: true, layout: { x: 970, y: 320, width: 120, height: 90 } },
  ],
  relations: [{ id: "route", kind: "flow", from: "source", to: "target", label: "自动绕行", state: "active", directed: true, visible: true }],
  parameters: [], variants: [], steps: [],
};

export const collisionStressFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "同坐标碰撞消解",
  concept: "多个元素坐标冲突时自动重新排布",
  description: "模拟 Agent 给多个不同尺寸元素生成相同坐标。",
  layout: { type: "manual", direction: "left-to-right", gap: 24 },
  elements: [
    { id: "stressArray", kind: "array", label: "数组", value: [8, 3, 5], state: "normal", visible: true, layout: { x: 550, y: 320, width: 420, height: 100 } },
    { id: "stressNode", kind: "node", label: "节点", value: "A", state: "active", visible: true, layout: { x: 550, y: 320, width: 150, height: 90 } },
    { id: "stressDecision", kind: "diamond", label: "条件", value: "x > 0", state: "normal", visible: true, layout: { x: 550, y: 320, width: 170, height: 110 } },
    { id: "stressNote", kind: "annotation", label: "长说明", value: "这些元素最初位于完全相同的位置", state: "visited", visible: true, layout: { x: 550, y: 320, width: 340, height: 100 } },
    { id: "stressPointer", kind: "pointer", label: "指针", value: 0, state: "normal", visible: true, layout: { x: 550, y: 320, width: 110, height: 70 } },
    { id: "stressQueue", kind: "queue", label: "队列", value: [1, 2, 3], state: "success", visible: true, layout: { x: 550, y: 320, width: 420, height: 100 } },
  ],
  relations: [], parameters: [], variants: [], steps: [],
};

export const denseGroupFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "分组内部碰撞消解",
  concept: "分组中的子元素不能互相覆盖或跑出容器",
  description: "模拟 Agent 在同一分组内连续添加多个同坐标元素。",
  layout: { type: "manual", direction: "left-to-right", gap: 20 },
  elements: [
    { id: "denseGroup", kind: "group", label: "边界情况分组", value: "自动扩展容器并重新排列子元素", state: "normal", visible: true, layout: { x: 550, y: 320, width: 420, height: 320 } },
    ...(["node", "rect", "diamond", "pointer", "annotation", "circle", "node", "rect"] as const).map((kind, index) => ({
      id: `groupChild${index}`,
      kind,
      label: `子元素 ${index + 1}`,
      value: index,
      state: "normal" as const,
      parentId: "denseGroup",
      visible: true,
      layout: { x: 550, y: 320, width: kind === "annotation" ? 210 : 120 + (index % 2) * 30, height: kind === "diamond" ? 100 : 80 },
    })),
  ],
  relations: [], parameters: [], variants: [], steps: [],
};

export const componentGalleryFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "固定组件画廊",
  concept: "分组、几何形状、注释与内存网格",
  description: "用于验证固定组件的层级、连线和边界。",
  layout: { type: "manual", direction: "left-to-right", gap: 36 },
  elements: [
    { id: "shapeGroup", kind: "group", label: "控制流分组", value: "固定容器", state: "normal", visible: true, layout: { x: 240, y: 250, width: 400, height: 350 } },
    { id: "startRect", kind: "rect", label: "开始", value: "输入", state: "normal", parentId: "shapeGroup", visible: true, layout: { x: 130, y: 260, width: 120, height: 80 } },
    { id: "decision", kind: "diamond", label: "条件", value: "x > 0", state: "active", parentId: "shapeGroup", visible: true, layout: { x: 240, y: 260, width: 120, height: 100 } },
    { id: "endCircle", kind: "circle", label: "结束", value: "输出", state: "success", parentId: "shapeGroup", visible: true, layout: { x: 350, y: 260, width: 90, height: 90 } },
    { id: "guide", kind: "annotation", label: "说明", value: "智能助手只能组合固定组件", state: "normal", visible: true, layout: { x: 800, y: 170, width: 400, height: 120 } },
    { id: "memory", kind: "memoryGrid", label: "内存网格", value: ["0x00", 7, "0x01", 9, "0x02", 11], state: "visited", visible: true, layout: { x: 800, y: 430, width: 400, height: 220 } },
  ],
  relations: [
    { id: "startToDecision", kind: "flow", from: "startRect", to: "decision", label: "判断", state: "normal", directed: true, visible: true },
    { id: "decisionToEnd", kind: "flow", from: "decision", to: "endCircle", label: "是", state: "success", directed: true, visible: true },
    { id: "guideToMemory", kind: "dependency", from: "guide", to: "memory", label: "解释", state: "normal", directed: true, visible: true },
  ],
  parameters: [],
  variants: [],
  steps: [
    { id: "focusDecision", title: "聚焦条件", description: "突出条件节点并弱化其他内容。", operations: [{ type: "focus", targetIds: ["decision"] }] },
  ],
};

export const denseLabelFixture: VisualizationSpec = {
  schemaVersion: 1,
  title: "长标签与边界回归",
  concept: "验证多行说明、静默状态和画布边界",
  description: "模拟数组算法中较长的状态说明。",
  layout: { type: "grid", direction: "left-to-right", columns: 3, gap: 28 },
  elements: [
    { id: "cell0", kind: "rect", label: "索引 0", value: 3, state: "normal", visible: true, layout: { row: 0, column: 0, width: 150, height: 90 } },
    { id: "cell1", kind: "rect", label: "索引 1", value: 2, state: "normal", visible: true, layout: { row: 0, column: 1, width: 150, height: 90 } },
    { id: "cell2", kind: "rect", label: "索引 2", value: 1, state: "normal", visible: true, layout: { row: 0, column: 2, width: 150, height: 90 } },
    { id: "pass", kind: "annotation", label: "当前轮次", value: "第 2 轮：i = 1，j = 0", state: "normal", visible: true, layout: { row: 2, column: 0, width: 250, height: 80 } },
    { id: "comparison", kind: "annotation", label: "比较结果与未排序区间", value: "未排序区间：索引 0 到索引 12", state: "normal", visible: true, layout: { row: 2, column: 1, width: 300, height: 80 } },
    { id: "flag", kind: "annotation", label: "本轮是否发生交换", value: false, state: "muted", visible: true, layout: { row: 2, column: 2, width: 200, height: 80 } },
    { id: "sorted", kind: "annotation", label: "已经确定位置的有序区域", value: "右侧有序后缀：[3]", state: "normal", visible: true, layout: { row: 3, column: 1, width: 300, height: 80 } },
  ],
  relations: [], parameters: [], variants: [], steps: [],
};

export const FIXTURES = {
  array: bubbleSortFixture,
  tree: treeTraversalFixture,
  graph: graphSearchFixture,
  containers: stackQueueFixture,
  callStack: callStackFixture,
  timeline: timelineFixture,
  pipeline: pipelineFixture,
  densePipeline: densePipelineFixture,
  blockedRelation: blockedRelationFixture,
  collisionStress: collisionStressFixture,
  denseGroup: denseGroupFixture,
  gallery: componentGalleryFixture,
  denseLabels: denseLabelFixture,
} as const;
