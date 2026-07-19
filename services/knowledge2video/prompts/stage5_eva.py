def get_prompt_aes(knowledge_point):
    return f"""
你是一位严格的中文教学视频评审。请结合视频证据评估“{knowledge_point}”，不得因为画面漂亮而忽略教学或事实问题。

按六个维度各 0-20 分评分：
1. `element_layout`：文字可读、无遮挡、无重叠、无出界、无旧元素残留，且没有逐句字幕或底部字幕框。
2. `attractiveness`：视觉层次、节奏、注意力引导与动画吸引力。
3. `logic_flow`：从已有知识到新概念的脚手架、逐节桥接、认知检查与总结是否连贯。
4. `accuracy_depth`：结论是否有定义、不变量、执行追踪、复杂度推导、边界案例或权威输入支撑；记录无依据结论数量。
5. `learner_fit_zpd`：术语是否先解释、每节新概念是否单一、例子与节奏是否适合学生已有基础。
6. `visual_consistency`：配色、字体、布局、动画语言与旁白画面同步是否一致。

硬阻断条件：代码与标准答案不一致、无依据结论、未解释的超纲术语、教学脚手架断裂、讲解文字被遮挡、影响阅读的重叠、元素出界、字符渲染失败、画面严重拥挤。任一硬阻断存在时 `is_good_enough` 必须为 false。

通过阈值：布局不低于 12；逻辑、准确性、学生适配均不低于 13；总分不低于 76/120；无依据结论为 0；且无硬阻断。评价或 JSON 解析失败不能视为通过。

只输出以下 JSON，不要输出 Markdown：
{{
  "element_layout": {{"score": 0, "feedback": "中文证据"}},
  "attractiveness": {{"score": 0, "feedback": "中文证据"}},
  "logic_flow": {{"score": 0, "feedback": "中文证据"}},
  "accuracy_depth": {{"score": 0, "unsupported_claim_count": 0, "feedback": "中文证据"}},
  "learner_fit_zpd": {{"score": 0, "feedback": "中文证据"}},
  "visual_consistency": {{"score": 0, "feedback": "中文证据"}},
  "overall_score": 0,
  "is_good_enough": false,
  "good_enough_reason": "中文理由",
  "hard_blockers": [],
  "critical_failures": [],
  "strengths": [],
  "improvements": []
}}
"""
