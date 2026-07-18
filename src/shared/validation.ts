import { z } from "zod";
import {
  visualizationSpecSchema,
  type VisualizationSpec,
} from "./schema.js";
import { ELEMENT_DEFAULT_SIZE, VISUALIZATION_VIEWBOX } from "./geometry.js";

export class VisualizationValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`可视化校验失败：${issues.join("；")}`);
    this.name = "VisualizationValidationError";
    this.issues = issues;
  }
}

function issuePath(path: PropertyKey[]): string {
  return path.length === 0 ? "root" : path.map(String).join(".");
}

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issuePath(issue.path)}: ${issue.message}`);
}

function findParentCycle(spec: VisualizationSpec): string[] | null {
  const parents = new Map(spec.elements.map((element) => [element.id, element.parentId]));

  for (const element of spec.elements) {
    const path: string[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = element.id;
    while (cursor) {
      if (seen.has(cursor)) {
        path.push(cursor);
        return path;
      }
      seen.add(cursor);
      path.push(cursor);
      cursor = parents.get(cursor);
    }
  }

  return null;
}

function isRedundantCanvasSummary(label: string | undefined): boolean {
  if (!label) return false;
  const normalized = label.replace(/\s+/g, "");
  return /小结|总结/.test(normalized)
    || /代码(?:思路|说明|实现|示例|摘要)/.test(normalized)
    || /(?:思路|说明).*代码/.test(normalized)
    || /^(?:当前操作|当前观察|操作说明|步骤说明|最终结果|关键结论)$/.test(normalized);
}

export function validateVisualizationSpec(input: unknown): VisualizationSpec {
  const parsed = visualizationSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new VisualizationValidationError(zodIssues(parsed.error));
  }

  const spec = parsed.data;
  const issues: string[] = [];
  const elementIds = new Set<string>();
  const relationIds = new Set<string>();
  const stepIds = new Set<string>();
  const parameterIds = new Set<string>();
  const variantIds = new Set<string>();

  for (const element of spec.elements) {
    if (elementIds.has(element.id)) issues.push(`元素 ID 重复: ${element.id}`);
    elementIds.add(element.id);
  }

  for (const element of spec.elements) {
    if (element.parentId && !elementIds.has(element.parentId)) {
      issues.push(`元素 ${element.id} 的父元素不存在: ${element.parentId}`);
    }
    if (element.parentId === element.id) issues.push(`元素 ${element.id} 不能以自身为父元素`);
    if ((element.targetId !== undefined || element.targetIndex !== undefined) && element.kind !== "pointer") {
      issues.push(`只有 pointer 元素可以设置 targetId 或 targetIndex: ${element.id}`);
    }
    if (element.targetId && !elementIds.has(element.targetId)) {
      issues.push(`指针 ${element.id} 的目标元素不存在: ${element.targetId}`);
    }
    if (element.targetId === element.id) issues.push(`指针 ${element.id} 不能指向自身`);
    if (element.targetIndex !== undefined && !element.targetId) {
      issues.push(`指针 ${element.id} 设置 targetIndex 时必须同时设置 targetId`);
    }
    if (isRedundantCanvasSummary(element.label)) {
      issues.push(`元素 ${element.id} 是与右侧区域重复的说明卡片，请将说明移入 description 或步骤说明、代码放在专用代码区`);
    }

    const defaultSize = ELEMENT_DEFAULT_SIZE[element.kind];
    const width = element.layout?.width ?? defaultSize.width;
    const height = element.layout?.height ?? defaultSize.height;
    const { padding, width: canvasWidth, height: canvasHeight } = VISUALIZATION_VIEWBOX;
    if (width > canvasWidth - padding * 2) issues.push(`元素 ${element.id} 的宽度超出画布`);
    if (height > canvasHeight - padding * 2) issues.push(`元素 ${element.id} 的高度超出画布`);
    if (element.layout?.x !== undefined && (element.layout.x - width / 2 < padding || element.layout.x + width / 2 > canvasWidth - padding)) {
      issues.push(`元素 ${element.id} 的横向布局超出画布`);
    }
    if (element.layout?.y !== undefined && (element.layout.y - height / 2 < padding || element.layout.y + height / 2 > canvasHeight - padding)) {
      issues.push(`元素 ${element.id} 的纵向布局超出画布`);
    }
  }

  const cycle = findParentCycle(spec);
  if (cycle) issues.push(`元素父子关系存在循环: ${cycle.join(" -> ")}`);

  for (const relation of spec.relations) {
    if (relationIds.has(relation.id)) issues.push(`关系 ID 重复: ${relation.id}`);
    relationIds.add(relation.id);
    if (!elementIds.has(relation.from)) issues.push(`关系 ${relation.id} 的起点不存在: ${relation.from}`);
    if (!elementIds.has(relation.to)) issues.push(`关系 ${relation.id} 的终点不存在: ${relation.to}`);
  }

  if (spec.layout.rootId && !elementIds.has(spec.layout.rootId)) {
    issues.push(`布局根节点不存在: ${spec.layout.rootId}`);
  }

  for (const parameter of spec.parameters) {
    if (parameterIds.has(parameter.id)) issues.push(`参数 ID 重复: ${parameter.id}`);
    parameterIds.add(parameter.id);
    if (parameter.type === "number" && typeof parameter.default !== "number") {
      issues.push(`数值参数 ${parameter.id} 的默认值必须为数字`);
    }
    if (parameter.type === "boolean" && typeof parameter.default !== "boolean") {
      issues.push(`布尔参数 ${parameter.id} 的默认值必须为布尔值`);
    }
    if (parameter.min !== undefined && parameter.max !== undefined && parameter.min > parameter.max) {
      issues.push(`参数 ${parameter.id} 的 min 不能大于 max`);
    }
    if (typeof parameter.default === "number") {
      if (parameter.min !== undefined && parameter.default < parameter.min) issues.push(`参数 ${parameter.id} 默认值小于 min`);
      if (parameter.max !== undefined && parameter.default > parameter.max) issues.push(`参数 ${parameter.id} 默认值大于 max`);
    }
    if (parameter.type === "select" && (!parameter.options || !parameter.options.includes(parameter.default))) {
      issues.push(`选择参数 ${parameter.id} 的默认值必须包含在 options 中`);
    }
  }

  for (const variant of spec.variants) {
    if (variantIds.has(variant.id)) issues.push(`变体 ID 重复: ${variant.id}`);
    variantIds.add(variant.id);
  }

  for (const step of spec.steps) {
    if (stepIds.has(step.id)) issues.push(`步骤 ID 重复: ${step.id}`);
    stepIds.add(step.id);
    if (step.codeLine !== undefined && (!spec.code || step.codeLine >= spec.code.lines.length)) {
      issues.push(`步骤 ${step.id} 的代码行越界: ${step.codeLine}`);
    }
    for (const operation of step.operations) {
      const targets = operation.type === "focus" ? operation.targetIds : [operation.targetId];
      for (const targetId of targets) {
        if (!elementIds.has(targetId) && !relationIds.has(targetId)) {
          issues.push(`步骤 ${step.id} 引用了不存在的目标: ${targetId}`);
        }
      }
      if (operation.type === "setPointerTarget") {
        const pointer = spec.elements.find((element) => element.id === operation.targetId);
        if (pointer?.kind !== "pointer") {
          issues.push(`步骤 ${step.id} 的 setPointerTarget 目标必须是 pointer 元素: ${operation.targetId}`);
        }
        if (operation.pointsToId && !elementIds.has(operation.pointsToId)) {
          issues.push(`步骤 ${step.id} 的指针目标不存在: ${operation.pointsToId}`);
        }
        if (operation.pointsToId === operation.targetId) {
          issues.push(`步骤 ${step.id} 的指针不能指向自身: ${operation.targetId}`);
        }
        if (operation.targetIndex !== undefined && !operation.pointsToId) {
          issues.push(`步骤 ${step.id} 设置 targetIndex 时必须同时设置 pointsToId`);
        }
      }
    }
  }

  if (issues.length > 0) throw new VisualizationValidationError(issues);
  return spec;
}

export function validateAgentCanvasBudget(input: unknown): VisualizationSpec {
  const spec = validateVisualizationSpec(input);
  const visibleElements = spec.elements.filter((element) => element.visible);
  const annotationElements = visibleElements.filter((element) => element.kind === "annotation");
  const stepTargets = new Set(spec.steps.flatMap((step) => step.operations.flatMap((operation) => operation.type === "focus" ? operation.targetIds : [operation.targetId])));
  const staticAnnotations = annotationElements.filter((element) => !stepTargets.has(element.id));
  const supportingElements = visibleElements.filter((element) => element.kind !== "node" && element.kind !== "circle");
  const issues: string[] = [];

  if (annotationElements.length > 1) {
    issues.push(`画布最多保留 1 个随步骤变化的动态说明，当前有 ${annotationElements.length} 个；其余说明应移入 description 或步骤说明`);
  }
  if (staticAnnotations.length > 0) {
    issues.push(`静态说明不应占用画布: ${staticAnnotations.map((element) => element.id).join(", ")}；请移入 description 或步骤说明`);
  }
  if (supportingElements.length > 8) {
    issues.push(`画布辅助组件过多: ${supportingElements.length} 个，最多 8 个；请只保留需要观察、连接或逐步改变的组件`);
  }
  if (visibleElements.length > 20) {
    issues.push(`画布可见元素过多: ${visibleElements.length} 个，最多 20 个；请缩小示例规模或拆分为步骤`);
  }
  if (spec.layout.type === "grid" || spec.layout.type === "pipeline") {
    const positioned = visibleElements.filter((element) => !element.parentId && element.layout?.row !== undefined && element.layout?.column !== undefined);
    if (positioned.length >= 2) {
      const columnWidths = new Map<number, number>();
      const rowHeights = new Map<number, number>();
      for (const element of positioned) {
        const column = element.layout!.column!;
        const row = element.layout!.row!;
        const size = ELEMENT_DEFAULT_SIZE[element.kind];
        columnWidths.set(column, Math.max(columnWidths.get(column) ?? 0, element.layout?.width ?? size.width));
        rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, element.layout?.height ?? size.height));
      }
      const gap = spec.layout.gap ?? 48;
      const estimatedWidth = [...columnWidths.values()].reduce((sum, width) => sum + width, 0) + Math.max(0, columnWidths.size - 1) * gap + 150;
      const estimatedHeight = [...rowHeights.values()].reduce((sum, height) => sum + height, 0) + Math.max(0, rowHeights.size - 1) * gap + 150;
      if (estimatedWidth / estimatedHeight > 2.8) {
        issues.push(`布局过宽，默认适配后文字会过小；请增加有意义的行并减少同一行列数，使内容接近画布比例`);
      }
    }
  }

  if (issues.length > 0) throw new VisualizationValidationError(issues);
  return spec;
}
