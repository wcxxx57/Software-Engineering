import type { AgentEvent } from "./api.js";

type ToolStatus = Extract<AgentEvent, { type: "tool" }>["status"];

const TOOL_PROGRESS: Readonly<Record<string, Readonly<Record<ToolStatus, string>>>> = {
  inspect_component_catalog: {
    started: "正在查看可用的二维图形组件…",
    completed: "已确认可用的二维图形组件",
    failed: "读取二维图形组件失败",
  },
  submit_visualization_spec: {
    started: "正在校验并创建可视化…",
    completed: "可视化结构校验完成",
    failed: "可视化结构校验未通过",
  },
  inspect_visualization: {
    started: "正在读取当前图形和操作状态…",
    completed: "已读取当前图形",
    failed: "读取当前图形失败",
  },
  edit_visualization: {
    started: "正在应用图形修改…",
    completed: "图形修改已完成",
    failed: "图形修改未能应用",
  },
  replace_visualization: {
    started: "正在重构整张图…",
    completed: "整图重构已完成",
    failed: "整图重构失败",
  },
  control_timeline: {
    started: "正在调整播放与高亮状态…",
    completed: "播放与高亮状态已更新",
    failed: "播放状态调整失败",
  },
  navigate_history: {
    started: "正在处理撤销或重做…",
    completed: "历史版本已更新",
    failed: "历史版本操作失败",
  },
  explain_visualization: {
    started: "正在结合当前图形整理说明…",
    completed: "图形说明已生成",
    failed: "暂时无法生成图形说明",
  },
};

const FALLBACK_STATUS: Readonly<Record<ToolStatus, string>> = {
  started: "正在处理你的要求…",
  completed: "这一步已经完成",
  failed: "这一步处理失败",
};

export function agentToolProgress(name: string, status: ToolStatus): string {
  return TOOL_PROGRESS[name]?.[status] ?? FALLBACK_STATUS[status];
}
