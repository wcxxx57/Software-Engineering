import {
  patchSetSchema,
  type PatchOperation,
  type PatchSet,
  type VisualizationSpec,
} from "./schema.js";
import { validateVisualizationSpec, VisualizationValidationError } from "./validation.js";

function missing(kind: string, id: string): never {
  throw new VisualizationValidationError([`${kind}不存在: ${id}`]);
}

function duplicate(kind: string, id: string): never {
  throw new VisualizationValidationError([`${kind}已存在: ${id}`]);
}

function applyOperation(spec: VisualizationSpec, operation: PatchOperation): void {
  switch (operation.op) {
    case "addElement":
      if (spec.elements.some((element) => element.id === operation.element.id)) duplicate("元素", operation.element.id);
      spec.elements.push(operation.element);
      return;
    case "updateElement": { const index = spec.elements.findIndex((element) => element.id === operation.id); if (index < 0) missing("元素", operation.id); spec.elements[index] = { ...spec.elements[index]!, ...operation.changes }; return; }
    case "removeElement":
      if (!spec.elements.some((element) => element.id === operation.id)) missing("元素", operation.id);
      spec.elements = spec.elements.filter((element) => element.id !== operation.id && element.parentId !== operation.id);
      for (const element of spec.elements) {
        if (element.targetId !== operation.id) continue;
        delete element.targetId;
        delete element.targetIndex;
      }
      spec.relations = spec.relations.filter((relation) => relation.from !== operation.id && relation.to !== operation.id);
      for (const step of spec.steps) {
        step.operations = step.operations.filter((stepOperation) => {
          if (stepOperation.type === "focus") return !stepOperation.targetIds.includes(operation.id);
          if (stepOperation.type === "setPointerTarget" && stepOperation.pointsToId === operation.id) return false;
          return stepOperation.targetId !== operation.id;
        });
      }
      return;
    case "addRelation":
      if (spec.relations.some((relation) => relation.id === operation.relation.id)) duplicate("关系", operation.relation.id);
      spec.relations.push(operation.relation);
      return;
    case "updateRelation": { const index = spec.relations.findIndex((relation) => relation.id === operation.id); if (index < 0) missing("关系", operation.id); spec.relations[index] = { ...spec.relations[index]!, ...operation.changes }; return; }
    case "removeRelation":
      if (!spec.relations.some((relation) => relation.id === operation.id)) missing("关系", operation.id);
      spec.relations = spec.relations.filter((relation) => relation.id !== operation.id);
      return;
    case "setLayout": spec.layout = operation.layout; return;
    case "setTitle": spec.title = operation.title; return;
    case "setConcept": spec.concept = operation.concept; return;
    case "setDescription": spec.description = operation.description; return;
    case "setParameters": spec.parameters = operation.parameters; return;
    case "setVariants": spec.variants = operation.variants; return;
    case "setCode": spec.code = operation.code ?? undefined; return;
    case "addStep": {
      if (spec.steps.some((step) => step.id === operation.step.id)) duplicate("步骤", operation.step.id);
      const index = operation.index ?? spec.steps.length;
      spec.steps.splice(Math.min(index, spec.steps.length), 0, operation.step);
      return;
    }
    case "updateStep": { const index = spec.steps.findIndex((step) => step.id === operation.id); if (index < 0) missing("步骤", operation.id); spec.steps[index] = { ...spec.steps[index]!, ...operation.step }; return; }
    case "removeStep":
      if (!spec.steps.some((step) => step.id === operation.id)) missing("步骤", operation.id);
      spec.steps = spec.steps.filter((step) => step.id !== operation.id);
      return;
    case "reorderSteps": {
      if (operation.stepIds.length !== spec.steps.length || new Set(operation.stepIds).size !== spec.steps.length) {
        throw new VisualizationValidationError(["reorderSteps 必须包含全部且不重复的步骤 ID"]);
      }
      const stepsById = new Map(spec.steps.map((step) => [step.id, step]));
      spec.steps = operation.stepIds.map((id) => stepsById.get(id) ?? missing("步骤", id));
      return;
    }
  }
}

export function applyPatchSet(inputSpec: VisualizationSpec, inputPatch: unknown): VisualizationSpec {
  const patch: PatchSet = patchSetSchema.parse(inputPatch);
  const next = structuredClone(inputSpec);
  for (const operation of patch.operations) applyOperation(next, operation);
  return validateVisualizationSpec(next);
}
