import type { ElementKind } from "./schema.js";

export interface ComponentCatalogEntry {
  kind: ElementKind;
  purpose: string;
  valueShape: string;
}

export const COMPONENT_CATALOG: readonly ComponentCatalogEntry[] = [
  { kind: "array", purpose: "数组、序列、排序条带", valueShape: "标量数组" },
  { kind: "node", purpose: "树节点、图节点、状态节点", valueShape: "标量" },
  { kind: "pointer", purpose: "索引、游标、head/tail/current 指针", valueShape: "标签或目标说明" },
  { kind: "stack", purpose: "栈、辅助栈", valueShape: "标量数组，末项为栈顶" },
  { kind: "queue", purpose: "队列、BFS 辅助队列", valueShape: "标量数组，首项为队头" },
  { kind: "callStack", purpose: "递归与函数调用帧", valueShape: "调用帧字符串数组" },
  { kind: "memoryGrid", purpose: "内存、缓存、矩阵与地址空间", valueShape: "单元格标量数组" },
  { kind: "timeline", purpose: "事件序列、并发时序", valueShape: "事件字符串数组" },
  { kind: "pipeline", purpose: "CPU/网络/编译流水线", valueShape: "阶段字符串数组" },
  { kind: "group", purpose: "逻辑分区和父子容器", valueShape: "可选标题" },
  { kind: "annotation", purpose: "解释、公式与注意事项", valueShape: "文本" },
  { kind: "rect", purpose: "通用矩形实体", valueShape: "标量" },
  { kind: "circle", purpose: "通用圆形实体", valueShape: "标量" },
  { kind: "diamond", purpose: "条件与决策实体", valueShape: "标量" },
] as const;

export const COMPONENT_CATALOG_TEXT = COMPONENT_CATALOG
  .map((entry) => `${entry.kind}: ${entry.purpose}；value=${entry.valueShape}`)
  .join("\n");
