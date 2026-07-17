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
    }
  }

  if (issues.length > 0) throw new VisualizationValidationError(issues);
  return spec;
}
