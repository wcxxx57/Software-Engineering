import { z } from "zod";

export const semanticStateSchema = z.enum([
  "normal",
  "active",
  "visited",
  "success",
  "error",
  "muted",
]);

export const elementKindSchema = z.enum([
  "array",
  "node",
  "pointer",
  "stack",
  "queue",
  "callStack",
  "memoryGrid",
  "timeline",
  "pipeline",
  "group",
  "annotation",
  "rect",
  "circle",
  "diamond",
]);

export const relationKindSchema = z.enum([
  "edge",
  "arrow",
  "link",
  "flow",
  "dependency",
]);

export const scalarValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const elementValueSchema = z.union([
  scalarValueSchema,
  z.array(scalarValueSchema).max(100),
]);

export const layoutHintSchema = z.strictObject({
  x: z.number().finite().min(-1000).max(10000).optional(),
  y: z.number().finite().min(-1000).max(10000).optional(),
  row: z.number().int().min(0).max(100).optional(),
  column: z.number().int().min(0).max(100).optional(),
  order: z.number().int().min(0).max(1000).optional(),
  width: z.number().finite().min(20).max(2000).optional(),
  height: z.number().finite().min(20).max(1200).optional(),
  depth: z.number().int().min(0).max(30).optional(),
});

export const visualizationElementSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  kind: elementKindSchema,
  label: z.string().max(200).optional(),
  value: elementValueSchema.optional(),
  state: semanticStateSchema.default("normal"),
  parentId: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/).optional(),
  visible: z.boolean().default(true),
  layout: layoutHintSchema.optional(),
});

export const visualizationRelationSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  kind: relationKindSchema.default("edge"),
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  label: z.string().max(120).optional(),
  state: semanticStateSchema.default("normal"),
  directed: z.boolean().default(true),
  visible: z.boolean().default(true),
});

export const layoutSchema = z.strictObject({
  type: z.enum(["manual", "row", "column", "grid", "tree", "force", "timeline", "pipeline"]),
  direction: z.enum(["left-to-right", "right-to-left", "top-to-bottom", "bottom-to-top"]).default("left-to-right"),
  rootId: z.string().max(64).optional(),
  columns: z.number().int().min(1).max(20).optional(),
  gap: z.number().finite().min(8).max(240).default(48),
});

export const parameterSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  label: z.string().min(1).max(100),
  type: z.enum(["number", "string", "boolean", "select"]),
  default: scalarValueSchema,
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  options: z.array(scalarValueSchema).min(1).max(30).optional(),
});

export const variantSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  label: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const codeSnippetSchema = z.strictObject({
  language: z.string().min(1).max(30),
  title: z.string().min(1).max(120),
  lines: z.array(z.string().max(500)).max(200),
});

export const stepOperationSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("setState"),
    targetId: z.string().min(1).max(64),
    state: semanticStateSchema,
  }),
  z.strictObject({
    type: z.literal("setValue"),
    targetId: z.string().min(1).max(64),
    value: elementValueSchema,
  }),
  z.strictObject({
    type: z.literal("setLabel"),
    targetId: z.string().min(1).max(64),
    label: z.string().max(200),
  }),
  z.strictObject({
    type: z.literal("setVisible"),
    targetId: z.string().min(1).max(64),
    visible: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("focus"),
    targetIds: z.array(z.string().min(1).max(64)).min(1).max(30),
  }),
]);

export const visualizationStepSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(2000),
  codeLine: z.number().int().min(0).max(199).optional(),
  operations: z.array(stepOperationSchema).max(100),
});

export const visualizationSpecSchema = z.strictObject({
  schemaVersion: z.literal(1),
  title: z.string().min(1).max(160),
  concept: z.string().min(1).max(240),
  description: z.string().max(2000).optional(),
  language: z.string().max(30).optional(),
  layout: layoutSchema,
  elements: z.array(visualizationElementSchema).min(1).max(300),
  relations: z.array(visualizationRelationSchema).max(600).default([]),
  parameters: z.array(parameterSchema).max(30).default([]),
  variants: z.array(variantSchema).max(30).default([]),
  code: codeSnippetSchema.optional(),
  steps: z.array(visualizationStepSchema).max(300).default([]),
});

export const elementChangesSchema = visualizationElementSchema
  .omit({ id: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "changes 不能为空");

export const relationChangesSchema = visualizationRelationSchema
  .omit({ id: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "changes 不能为空");

export const patchOperationSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("addElement"), element: visualizationElementSchema }),
  z.strictObject({ op: z.literal("updateElement"), id: z.string().min(1).max(64), changes: elementChangesSchema }),
  z.strictObject({ op: z.literal("removeElement"), id: z.string().min(1).max(64) }),
  z.strictObject({ op: z.literal("addRelation"), relation: visualizationRelationSchema }),
  z.strictObject({ op: z.literal("updateRelation"), id: z.string().min(1).max(64), changes: relationChangesSchema }),
  z.strictObject({ op: z.literal("removeRelation"), id: z.string().min(1).max(64) }),
  z.strictObject({ op: z.literal("setLayout"), layout: layoutSchema }),
  z.strictObject({ op: z.literal("setTitle"), title: z.string().min(1).max(160) }),
  z.strictObject({ op: z.literal("setConcept"), concept: z.string().min(1).max(240) }),
  z.strictObject({ op: z.literal("setDescription"), description: z.string().max(2000) }),
  z.strictObject({ op: z.literal("setParameters"), parameters: z.array(parameterSchema).max(30) }),
  z.strictObject({ op: z.literal("setVariants"), variants: z.array(variantSchema).max(30) }),
  z.strictObject({ op: z.literal("setCode"), code: codeSnippetSchema.nullable() }),
  z.strictObject({ op: z.literal("addStep"), step: visualizationStepSchema, index: z.number().int().min(0).max(300).optional() }),
  z.strictObject({ op: z.literal("updateStep"), id: z.string().min(1).max(64), step: visualizationStepSchema.omit({ id: true }).partial() }),
  z.strictObject({ op: z.literal("removeStep"), id: z.string().min(1).max(64) }),
  z.strictObject({ op: z.literal("reorderSteps"), stepIds: z.array(z.string().min(1).max(64)).max(300) }),
]);

export const patchSetSchema = z.strictObject({
  operations: z.array(patchOperationSchema).min(1).max(100),
  summary: z.string().min(1).max(500),
});

export const runtimeCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("play") }),
  z.strictObject({ type: z.literal("pause") }),
  z.strictObject({ type: z.literal("reset") }),
  z.strictObject({ type: z.literal("next") }),
  z.strictObject({ type: z.literal("previous") }),
  z.strictObject({ type: z.literal("seek"), step: z.number().int().min(0).max(300) }),
  z.strictObject({ type: z.literal("highlight"), targetIds: z.array(z.string().min(1).max(64)).min(1).max(30) }),
  z.strictObject({ type: z.literal("clearHighlight") }),
]);

export const userProfileSchema = z.strictObject({
  age: z.number().int().min(6).max(120).optional(),
  programmingLanguage: z.string().max(30).optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  learningGoal: z.string().max(500).optional(),
});

export const versionRecordSchema = z.strictObject({
  versionId: z.string().regex(/^[a-f0-9]{64}$/),
  parentVersionId: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  createdAt: z.string().datetime(),
  sourceRequestId: z.string().min(1).max(128),
  summary: z.string().min(1).max(500),
  spec: visualizationSpecSchema,
});

export const visualizationIndexSchema = z.strictObject({
  visualizationId: z.string().uuid(),
  currentVersionId: z.string().regex(/^[a-f0-9]{64}$/),
  undoStack: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(1000),
  redoStack: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(1000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SemanticState = z.infer<typeof semanticStateSchema>;
export type ElementKind = z.infer<typeof elementKindSchema>;
export type VisualizationElement = z.infer<typeof visualizationElementSchema>;
export type VisualizationRelation = z.infer<typeof visualizationRelationSchema>;
export type VisualizationStep = z.infer<typeof visualizationStepSchema>;
export type VisualizationSpec = z.infer<typeof visualizationSpecSchema>;
export type PatchOperation = z.infer<typeof patchOperationSchema>;
export type PatchSet = z.infer<typeof patchSetSchema>;
export type RuntimeCommand = z.infer<typeof runtimeCommandSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type VersionRecord = z.infer<typeof versionRecordSchema>;
export type VisualizationIndex = z.infer<typeof visualizationIndexSchema>;
