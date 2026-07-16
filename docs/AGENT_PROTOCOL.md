# Agent 工具协议

## Author Agent

- `inspect_component_catalog()`：读取唯一允许使用的二维组件。
- `submit_visualization_spec({ spec })`：提交完整 Spec；跨引用校验失败时返回 issues，Agent 可修复后重试。
- 最多 4 次模型调用、5 次工具调用；只有校验通过的 Spec 才会写入首个版本。

## Editor Agent

- `inspect_visualization()`：返回当前版本、完整 Spec、undo/redo 能力和不可变样式规则。
- `edit_visualization({ patch })`：原子执行局部 Patch，并生成新版本。
- `replace_visualization({ spec, summary })`：整图重构，并生成新版本。
- `control_timeline({ command, explanation })`：发送瞬时运行命令，不产生版本。
- `navigate_history({ direction, explanation })`：撤销或重做。
- `explain_visualization({ status, message })`：相关解释、out_of_scope 或 unsupported。

编辑 Agent 一次请求最多成功一个持久化修改工具。工具上下文在服务端闭包中绑定 `visualizationId` 和当前版本，模型不能指定路径、文件或另一个可视化 ID。

## 边界规则

- 与当前图的修改、控制、解释以及重构为另一个计算机知识可视化均属于相关请求。
- 天气、邮件、普通闲聊等返回 `out_of_scope`，不读取或修改图。
- 样式修改返回 `unsupported`；允许改变布局和语义状态，不允许改变设计令牌。
- 固定组件无法表达时返回 `unsupported`，禁止用 HTML/SVG/JavaScript 绕过。

## 审计

`data/agent-runs/<requestId>.jsonl` 只记录：Agent 类型、工具名、开始/完成/失败、耗时、版本和错误。不会保存模型的隐藏推理内容。
