import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createAgent, createMiddleware, modelCallLimitMiddleware, tool, toolCallLimitMiddleware } from "langchain";
import { z } from "zod";
import { COMPONENT_CATALOG_TEXT } from "../../shared/catalog.js";
import {
  patchSetSchema,
  runtimeCommandSchema,
  visualizationSpecSchema,
  type RuntimeCommand,
  type UserProfile,
  type VisualizationSpec,
} from "../../shared/schema.js";
import { applyPatchSet } from "../../shared/patch.js";
import { normalizeRuntimeState, type RuntimeState } from "../../shared/runtime.js";
import { validateAgentCanvasBudget, VisualizationValidationError } from "../../shared/validation.js";
import { AgentConfigurationError } from "../errors.js";
import type { StoredVisualization, VersionStore } from "./versionStore.js";
import { AuditLogger } from "./auditLogger.js";

export type AgentStreamEvent =
  | { type: "progress"; message: string }
  | { type: "tool"; name: string; status: "started" | "completed" | "failed" }
  | { type: "message"; message: string }
  | { type: "out_of_scope"; message: string }
  | { type: "runtime"; command: RuntimeCommand }
  | ({ type: "version" } & StoredVisualization)
  | ({ type: "complete" } & StoredVisualization);

export type AgentEventSink = (event: AgentStreamEvent) => void;

export interface AgentModelsConfig {
  baseUrl: string;
  apiKey: string;
  editorModel: string;
  authorModel: string;
  timeoutMs: number;
}

export type AgentModelFactory = (kind: "author" | "editor") => BaseChatModel;

function errorText(error: unknown): string {
  if (error instanceof VisualizationValidationError) return error.issues.join("；");
  if (error instanceof z.ZodError) return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；");
  return error instanceof Error ? error.message : String(error);
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((block) => typeof block === "object" && block && "text" in block ? String(block.text) : "").join("").trim();
  return "";
}

export class AgentService {
  private readonly audit: AuditLogger;

  constructor(
    private readonly store: VersionStore,
    private readonly models: AgentModelsConfig,
    dataDir: string,
    private readonly modelFactory?: AgentModelFactory,
  ) {
    this.audit = new AuditLogger(dataDir);
  }

  private model(kind: "author" | "editor"): BaseChatModel {
    if (this.modelFactory) return this.modelFactory(kind);
    const model = kind === "author" ? this.models.authorModel : this.models.editorModel;
    if (!this.models.apiKey) throw new AgentConfigurationError("未配置 DMX_API_KEY，请在 education2d/.env 中设置");
    if (!model) throw new AgentConfigurationError(`未配置 ${kind === "author" ? "AUTHOR_MODEL/CODE_MODEL" : "AGENT_MODEL/LOGIC_MODEL"}`);
    return new ChatOpenAI({
      model,
      apiKey: this.models.apiKey,
      temperature: kind === "author" ? 0.2 : 0,
      timeout: this.models.timeoutMs,
      maxRetries: 3,
      streamUsage: false,
      configuration: {
        baseURL: this.models.baseUrl,
      },
    });
  }

  private async auditedTool<T>(
    runId: string,
    agent: "author" | "editor",
    name: string,
    emit: AgentEventSink,
    operation: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    emit({ type: "tool", name, status: "started" });
    await this.audit.write({ runId, agent, event: "tool_started", tool: name, timestamp: new Date().toISOString() });
    try {
      const result = await operation();
      emit({ type: "tool", name, status: "completed" });
      await this.audit.write({ runId, agent, event: "tool_completed", tool: name, durationMs: Date.now() - started, timestamp: new Date().toISOString() });
      return result;
    } catch (error) {
      emit({ type: "tool", name, status: "failed" });
      await this.audit.write({ runId, agent, event: "tool_failed", tool: name, durationMs: Date.now() - started, error: errorText(error), timestamp: new Date().toISOString() });
      throw error;
    }
  }

  async author(concept: string, profile: UserProfile, requestId: string, emit: AgentEventSink): Promise<StoredVisualization> {
    const runId = requestId;
    const started = Date.now();
    let acceptedSpec: VisualizationSpec | undefined;
    let catalogInspected = false;
    let submitAttempts = 0;
    let submitExhausted = false;
    let lastSubmitIssues: string[] = [];
    let authorModelCalls = 0;
    let authorToolCalls = 0;
    await this.audit.write({ runId, agent: "author", event: "run_started", timestamp: new Date().toISOString() });
    emit({ type: "progress", message: "正在选择合适的二维图形组件…" });

    const inspectCatalog = tool(
      async () => this.auditedTool(runId, "author", "inspect_component_catalog", emit, async () => {
        authorToolCalls += 1;
        if (authorToolCalls > 5) throw new Error("图形创作步骤过多，请简化知识点后重试");
        catalogInspected = true;
        return COMPONENT_CATALOG_TEXT;
      }),
      {
        name: "inspect_component_catalog",
        description: "查看 Education2D 唯一允许使用的固定二维组件及 value 数据格式。创建图之前必须调用。",
        schema: z.strictObject({}),
      },
    );
    const submitSpec = tool(
      async ({ spec }: { spec: VisualizationSpec }) => this.auditedTool(runId, "author", "submit_visualization_spec", emit, async () => {
        authorToolCalls += 1;
        if (authorToolCalls > 5) throw new Error("图形创作步骤过多，请简化知识点后重试");
        submitAttempts += 1;
        if (!catalogInspected) {
          acceptedSpec = undefined;
          lastSubmitIssues = ["提交前必须先调用 inspect_component_catalog"];
          submitExhausted = submitAttempts >= 3;
          emit({ type: "progress", message: `第 ${submitAttempts} 次 Spec 校验未通过：${lastSubmitIssues.join("；")}` });
          return JSON.stringify({ ok: false, attempt: submitAttempts, attemptsRemaining: Math.max(0, 3 - submitAttempts), issues: lastSubmitIssues, instruction: "先检查固定组件目录，再重新提交完整 Spec。" });
        }
        try {
          acceptedSpec = validateAgentCanvasBudget(spec);
          lastSubmitIssues = [];
          return JSON.stringify({ ok: true, message: "Spec 校验通过。停止继续修改并给出简短完成说明。" });
        } catch (error) {
          acceptedSpec = undefined;
          lastSubmitIssues = error instanceof VisualizationValidationError ? error.issues : [errorText(error)];
          submitExhausted = submitAttempts >= 3;
          emit({ type: "progress", message: `第 ${submitAttempts} 次 Spec 校验未通过：${lastSubmitIssues.join("；")}` });
          return JSON.stringify({
            ok: false,
            attempt: submitAttempts,
            attemptsRemaining: Math.max(0, 3 - submitAttempts),
            issues: lastSubmitIssues,
            instruction: submitExhausted ? "已达到三次提交上限，停止调用工具。" : "根据 issues 修正完整 Spec 后再次调用本工具。",
          });
        }
      }),
      {
        name: "submit_visualization_spec",
        description: "提交完整 VisualizationSpec。工具会严格检查元素引用、步骤目标和样式隔离；失败后必须根据错误修复重试。",
        schema: z.strictObject({ spec: visualizationSpecSchema }),
      },
    );
    const authorRunGuard = createMiddleware({
      name: "AuthorRunGuard",
      beforeModel: {
        canJumpTo: ["end"],
        hook: () => {
          if (acceptedSpec || submitExhausted) return { jumpTo: "end" as const };
          authorModelCalls += 1;
          if (authorModelCalls > 5) throw new Error("图形规划尝试次数过多，请稍后重试");
          return undefined;
        },
      },
    });

    const agent = createAgent({
      model: this.model("author"),
      tools: [inspectCatalog, submitSpec],
      systemPrompt: `你是 Education2D 可视化创作 Agent，只创建计算机与编程知识点的二维交互可视化。
你必须先调用 inspect_component_catalog，再调用 submit_visualization_spec。校验失败时读取 issues 并修复，最多三次提交。
严禁输出或构造 HTML、CSS、SVG、JavaScript、颜色、字体、className 或 style。只能使用固定组件和语义状态。
Spec 顶层必须是 schemaVersion=1，并包含 title、concept、layout、elements、relations、parameters、variants、steps；ID 使用稳定英文标识。
优先使用 tree、row、column、grid 等自动布局且不要填写元素 x/y；pipeline 或 grid 中有多个层次时要明确设置不同的 row/column。仅在确需 manual 布局时填写坐标，并主动分散元素位置。
任何标签和值都必须完整保留，不能用省略号代替内容，也不能依赖裁切隐藏文字。元素之间不得重叠；关系标签不得压住元素；连线不得穿过无关元素。渲染器会做最终自动扩容与碰撞消解，但你仍应提供清晰的结构和合理的布局意图。
画布只承载知识结构、数据、状态、指针和关系。不要创建“小结”“总结”“代码思路”“代码说明”“当前操作”“当前观察”“最终结果”等与右侧区域重复的卡片；说明和结论写入 description 或步骤说明，代码只写入顶层 code，由界面专用区域展示。
先确定本知识点最需要被操控和观察的核心结构。只有需要连接、逐步改变、聚焦或比较的内容才能成为画布元素；定义、阶段释义、公式规则、复杂度、静态提示和最终结论写入 description 或对应步骤说明。默认目标不超过 12 个可见元素；树和图可因拓扑节点增加，但总数不得超过 20，node/circle 之外的辅助组件最多 8 个。画布最多保留 1 个 annotation，且它必须在步骤中发生变化或被聚焦。不要同时用总览组件和一组元素重复表达同一结构。grid/pipeline 不得把全部组件挤在过宽的单行中；结合约 1100:640 的画布比例组织两行或多行，让默认 100% 下文字清楚可读。
pointer 必须通过 targetId 真实指向目标元素；指向数组、队列、栈等序列中的具体单元时同时设置 targetIndex。步骤中移动指针必须使用 setPointerTarget，不能只把“current → 8”之类文字写入 value 冒充指向。暂时没有目标时可以不设 targetId，或用 pointsToId=null 清除指向。
搜索、查找、匹配等任务的目标值属于外部输入，必须放入 parameters，界面会自动持续显示；不要为了显示目标而虚构一个不属于数据结构的“目标节点”。只有目标确实存在于结构中且步骤到达该元素时，才把真实元素标为目标或成功状态。查找失败时，用 value=null 的空位置元素表达缺失，并让 current 等指针最终指向该空位置。修改目标值时必须同步更新 parameter.default/options、标题、说明、步骤、指针目标和旧目标元素的标签/状态，不能残留上一次的“目标节点”。
生成二叉树时，每条父子关系的 label 必须明确写“左”或“右”（可以附加“更小”“更大”等说明）。即使某个节点只有一个孩子，也必须保留真实的左右孩子语义，不能把单个孩子当作居中的普通下级节点。
所有 relation.from/to、layout.rootId 和 step.operations 目标必须引用本次提交中真实存在的 ID；codeLine 从 0 开始且不得越过 code.lines。
步骤要体现肉眼可见且可逆的知识状态变化，引用必须存在。面向用户使用中文说明。`,
      middleware: [
        authorRunGuard,
      ],
    });

    try {
      const result = await agent.invoke({ messages: [{ role: "user", content: `请创建“${concept}”的二维交互可视化。用户画像：${JSON.stringify(profile)}。` }] }, { signal: AbortSignal.timeout(this.models.timeoutMs) });
      if (!acceptedSpec) {
        const details = lastSubmitIssues.length > 0 ? `：${lastSubmitIssues.join("；")}` : "";
        throw new Error(`经过 ${submitAttempts} 次尝试仍未生成有效的图形结构${details}`);
      }
      const stored = await this.store.create(acceptedSpec, requestId, `创建：${concept}`);
      void result;
      emit({ type: "message", message: `已创建“${acceptedSpec.title}”二维交互可视化。` });
      await this.audit.write({ runId, agent: "author", event: "run_completed", durationMs: Date.now() - started, versionId: stored.version.versionId, timestamp: new Date().toISOString() });
      return stored;
    } catch (error) {
      await this.audit.write({ runId, agent: "author", event: "run_failed", durationMs: Date.now() - started, error: errorText(error), timestamp: new Date().toISOString() });
      throw error;
    }
  }

  async edit(
    visualizationId: string,
    baseVersionId: string,
    requestId: string,
    userMessage: string,
    emit: AgentEventSink,
    runtimeState?: RuntimeState,
  ): Promise<StoredVisualization> {
    const runId = requestId;
    const started = Date.now();
    let current = await this.store.getCurrent(visualizationId);
    if (current.index.currentVersionId !== baseVersionId) {
      const { VersionConflictError } = await import("../errors.js");
      throw new VersionConflictError(current.index.currentVersionId);
    }
    let mutationUsed = false;
    let userFacingEventSent = false;
    let visualizationInspected = false;
    const inspectedRuntime = normalizeRuntimeState(current.version.spec, runtimeState);
    await this.audit.write({ runId, agent: "editor", event: "run_started", versionId: baseVersionId, timestamp: new Date().toISOString() });
    emit({ type: "progress", message: "正在理解当前图形和你的修改要求…" });

    const inspectVisualization = tool(
      async () => this.auditedTool(runId, "editor", "inspect_visualization", emit, async () => {
        visualizationInspected = true;
        return JSON.stringify({
          visualizationId,
          versionId: current.index.currentVersionId,
          spec: current.version.spec,
          canUndo: current.index.undoStack.length > 0,
          canRedo: current.index.redoStack.length > 0,
          runtime: inspectedRuntime,
          immutableStyleRule: "样式、颜色、字体、CSS、SVG 代码不可修改",
        });
      }),
      { name: "inspect_visualization", description: "读取当前图的完整结构、稳定 ID、步骤和历史能力。任何相关操作前必须先调用。", schema: z.strictObject({}) },
    );

    const editVisualization = tool(
      async ({ patch }: { patch: z.infer<typeof patchSetSchema> }) => this.auditedTool(runId, "editor", "edit_visualization", emit, async () => {
        if (!visualizationInspected) return JSON.stringify({ ok: false, error: "修改前必须先调用 inspect_visualization。" });
        if (mutationUsed) return JSON.stringify({ ok: false, error: "一次请求只允许一个持久化修改工具，请结束本轮。" });
        try {
          const spec = validateAgentCanvasBudget(applyPatchSet(current.version.spec, patch));
          current = await this.store.commit({ visualizationId, baseVersionId: current.index.currentVersionId, sourceRequestId: requestId, summary: patch.summary, spec });
          mutationUsed = true; userFacingEventSent = true; emit({ type: "version", ...current }); emit({ type: "message", message: patch.summary });
          return JSON.stringify({ ok: true, versionId: current.version.versionId, message: "修改已原子提交且可撤销。" });
        } catch (error) {
          return JSON.stringify({ ok: false, issues: error instanceof VisualizationValidationError ? error.issues : [errorText(error)], instruction: "修复 Patch 后重试；不要生成代码。" });
        }
      }),
      { name: "edit_visualization", description: "原子编辑当前图的元素、关系、布局、标签、数据、代码和步骤。禁止样式字段。一次请求最多成功一次。", schema: z.strictObject({ patch: patchSetSchema }) },
    );

    const replaceVisualization = tool(
      async ({ spec, summary }: { spec: VisualizationSpec; summary: string }) => this.auditedTool(runId, "editor", "replace_visualization", emit, async () => {
        if (!visualizationInspected) return JSON.stringify({ ok: false, error: "重构前必须先调用 inspect_visualization。" });
        if (mutationUsed) return JSON.stringify({ ok: false, error: "一次请求只允许一个持久化修改工具，请结束本轮。" });
        try {
          const validated = validateAgentCanvasBudget(spec);
          current = await this.store.commit({ visualizationId, baseVersionId: current.index.currentVersionId, sourceRequestId: requestId, summary, spec: validated });
          mutationUsed = true; userFacingEventSent = true; emit({ type: "version", ...current }); emit({ type: "message", message: summary });
          return JSON.stringify({ ok: true, versionId: current.version.versionId, message: "整图已使用固定组件重构，样式未改变且可撤销。" });
        } catch (error) {
          return JSON.stringify({ ok: false, issues: error instanceof VisualizationValidationError ? error.issues : [errorText(error)], instruction: "修复完整 Spec 后重试。" });
        }
      }),
      { name: "replace_visualization", description: "在固定样式下重构整张图或换成另一个计算机知识点。只能提交 VisualizationSpec，禁止任意代码。", schema: z.strictObject({ spec: visualizationSpecSchema, summary: z.string().min(1).max(500) }) },
    );

    const controlTimeline = tool(
      async ({ command, explanation }: { command: RuntimeCommand; explanation: string }) => this.auditedTool(runId, "editor", "control_timeline", emit, async () => {
        if (!visualizationInspected) return JSON.stringify({ ok: false, error: "控制前必须先调用 inspect_visualization。" });
        if (command.type === "highlight" || command.type === "focus") {
          const knownIds = new Set([...current.version.spec.elements.map((element) => element.id), ...current.version.spec.relations.map((relation) => relation.id)]);
          const missingIds = command.targetIds.filter((id) => !knownIds.has(id));
          if (missingIds.length > 0) return JSON.stringify({ ok: false, issues: [`高亮目标不存在: ${missingIds.join(", ")}`] });
        }
        if (command.type === "seek" && command.step > current.version.spec.steps.length) {
          return JSON.stringify({ ok: false, issues: [`步骤 ${command.step} 越界，最大值为 ${current.version.spec.steps.length}`] });
        }
        userFacingEventSent = true; emit({ type: "runtime", command }); emit({ type: "message", message: explanation });
        return JSON.stringify({ ok: true, transient: true });
      }),
      { name: "control_timeline", description: "播放、暂停、重置、步进、跳转或临时高亮当前图，不创建版本。", schema: z.strictObject({ command: runtimeCommandSchema, explanation: z.string().min(1).max(500) }) },
    );

    const navigateHistory = tool(
      async ({ direction, explanation }: { direction: "undo" | "redo"; explanation: string }) => this.auditedTool(runId, "editor", "navigate_history", emit, async () => {
        if (!visualizationInspected) return JSON.stringify({ ok: false, error: "历史操作前必须先调用 inspect_visualization。" });
        current = await this.store.navigate(visualizationId, direction, current.index.currentVersionId);
        userFacingEventSent = true; emit({ type: "version", ...current }); emit({ type: "message", message: explanation });
        return JSON.stringify({ ok: true, versionId: current.version.versionId });
      }),
      { name: "navigate_history", description: "撤销或重做可视化的持久化修改。", schema: z.strictObject({ direction: z.enum(["undo", "redo"]), explanation: z.string().min(1).max(500) }) },
    );

    const explainVisualization = tool(
      async ({ status, message }: { status: "related" | "out_of_scope" | "unsupported"; message: string }) => this.auditedTool(runId, "editor", "explain_visualization", emit, async () => {
        if (status === "related" && !visualizationInspected) return JSON.stringify({ ok: false, error: "解释当前图前必须先调用 inspect_visualization。" });
        userFacingEventSent = true;
        emit(status === "out_of_scope" ? { type: "out_of_scope", message } : { type: "message", message });
        return JSON.stringify({ ok: true, status });
      }),
      { name: "explain_visualization", description: "回答与当前图有关的问题，或明确报告请求无关/组件暂不支持。不会修改图。", schema: z.strictObject({ status: z.enum(["related", "out_of_scope", "unsupported"]), message: z.string().min(1).max(1500) }) },
    );
    const stopAfterCompletedAction = createMiddleware({
      name: "StopAfterCompletedVisualizationAction",
      beforeModel: {
        canJumpTo: ["end"],
        hook: () => userFacingEventSent ? { jumpTo: "end" as const } : undefined,
      },
    });

    const agent = createAgent({
      model: this.model("editor"),
      tools: [inspectVisualization, editVisualization, replaceVisualization, controlTimeline, navigateHistory, explainVisualization],
      systemPrompt: `你是 Education2D 可视化编辑 Agent。你通过工具观察并操控当前计算机知识二维图，不是普通聊天机器人。
判断边界：修改/重构/控制/解释当前图，以及把当前图换成另一个计算机知识可视化，都相关；日常闲聊、天气、写邮件等无关。
任何相关请求必须先调用 inspect_visualization。然后只选择最合适的一个执行工具；复杂修改合并为一个 PatchSet。
样式是不可变系统约束：不能修改颜色、字体、CSS、className、style、HTML、SVG 或 JavaScript。用户要求换样式时调用 explain_visualization(status=unsupported)，说明可改内容与结构但样式锁定。
修改布局或新增元素时，要让不同元素使用不同的 row/column 或合理坐标；不得要求元素互相覆盖。用户提供的标签和值必须完整保留，不得用省略号缩短，也不得依赖裁切隐藏文字。固定渲染器会自动扩容并消解意外坐标冲突。
画布只保留知识结构、数据、状态、指针和关系，不得新增“小结”“总结”“代码思路”“代码说明”“当前操作”“当前观察”“最终结果”等与右侧区域重复的卡片；说明和结论应修改 description 或步骤说明，代码应修改顶层 code。
编辑时也必须遵守画布信息预算：默认目标不超过 12 个可见元素，最多 20 个；node/circle 之外的辅助组件最多 8 个；annotation 最多 1 个且必须参与步骤变化。静态定义、公式、复杂度、阶段释义和结论放入 description 或步骤说明。删除与右侧区域重复的信息，不要同时用总览组件和多个子元素重复表达同一结构。grid/pipeline 要按约 1100:640 的画布比例平衡行列，不能把全部组件排成导致文字缩小的超宽单行。
pointer 必须通过 targetId 真实指向目标元素；指向序列内部单元时同时设置 targetIndex。移动指针使用步骤操作 setPointerTarget，不得只修改 value 写出“指向某处”的文字。修改或删除目标元素时同步修复指针引用。
搜索、查找、匹配等任务的目标值是 parameters 中的外部输入，不得用一个并不存在于数据结构中的“目标节点”代替。更换目标时同步更新 parameter.default/options、标题、说明、所有步骤、指针目标，以及旧目标元素的标签和状态；查找失败时清除旧“目标节点”语义，用 value=null 的空位置和指向它的 current 表达 None。
编辑二叉树时，每条父子关系的 label 必须保留或补充“左”或“右”。只有一个孩子时也要表达真实方向，不能把单孩子关系改成无方向的居中层级。
局部结构/数据/布局/步骤修改用 edit_visualization；整图重构用 replace_visualization；播放和临时高亮用 control_timeline；撤销重做用 navigate_history。
用户要求展示边界状态或特殊情况时，先根据当前图判断是否存在多种含义明显不同的候选项。如果有多种，不要擅自修改；调用 explain_visualization(status=related) 简洁列出候选项并询问用户要演示哪一种。只有候选项唯一，或用户已经明确选择后，才执行修改。
如果请求无关，直接调用 explain_visualization(status=out_of_scope)，不要调用 inspect 或修改工具。
如果固定组件不能表达，调用 explain_visualization(status=unsupported)，严禁生成代码绕过组件系统。
工具返回校验错误时可修正后重试，但一次请求最多成功一个持久化修改。使用简洁中文面向用户。`,
      middleware: [
        stopAfterCompletedAction,
        toolCallLimitMiddleware({ runLimit: 5, exitBehavior: "error" }),
        modelCallLimitMiddleware({ runLimit: 5, exitBehavior: "error" }),
      ],
    });

    try {
      const result = await agent.invoke({ messages: [{ role: "user", content: userMessage }] }, { signal: AbortSignal.timeout(this.models.timeoutMs) });
      if (!userFacingEventSent) {
        const finalMessage = messageText(result.messages.at(-1)?.content) || "智能助手没有执行任何图形操作。";
        emit({ type: "message", message: finalMessage });
      }
      await this.audit.write({ runId, agent: "editor", event: "run_completed", durationMs: Date.now() - started, versionId: current.version.versionId, timestamp: new Date().toISOString() });
      return current;
    } catch (error) {
      await this.audit.write({ runId, agent: "editor", event: "run_failed", durationMs: Date.now() - started, error: errorText(error), timestamp: new Date().toISOString() });
      throw error;
    }
  }
}
