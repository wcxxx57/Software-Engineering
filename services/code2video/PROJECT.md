# PROJECT.md

## 1. 项目定位
C2V (Code to Video) 是一个将代码题解自动转换为教学视频的系统。与 K2V 的“知识点驱动”不同，C2V 的源输入不是单一 `knowledge_point`，而是两份具有主权地位的业务输入：

- `problem_description`
  题目描述、约束、示例与解释
- `solution_code`
  用户确认过的标准答案代码

当前系统的正式流水线为：

1. Stage 1 生成教学大纲
2. Stage 2 生成分镜脚本
3. Stage 2.5 生成音频旁车 `section_steps`
4. Stage 3 生成 Manim 业务代码
5. 渲染 section 视频
6. 基于时间轴重建 narration track
7. 回灌 section 音轨并合并最终成片

V5.0 的主题不是“给视频加声音”，而是建立一条可计算、可验证、可回灌的旁白真值链。对于 C2V，这条链还多了一条不可破坏的约束：

- 画面短句继续服务于讲解与视觉引导
- 旁白文本与画面文本彻底解耦
- 每条 narration 的持续时间只服从物理音频真值
- 标准答案代码 `solution_code` 是 Prompt 与视频代码展示的权威源，不允许静默改写
- 即便 Manim 内部混音不稳定，最终 section 视频仍可通过 Python + FFmpeg 获得稳定音轨

---

## 2. V5.0 的系统结论
V5.0 架构已经把 C2V 中“讲什么、画什么、响什么、展示哪份代码”拆成四条不同职责链：

- `lecture_lines`
  负责画面左侧短句与视觉提示
- `section_steps`
  负责旁白 sidecar 数据与音频真值
- Stage 3 业务代码
  负责动画调度与视觉时间轴表达
- `solution_code`
  负责代码讲解类场景中的代码展示真值

这四条链路在最终成片阶段重新汇合，但汇合点不再是 Manim 内部的黑盒混音，而是 Python 侧的时间轴重建与音轨回灌。

当前代码基线下，系统已经具备如下能力：

- 真实 `tts-pro` TTS 调用
- TTS 返回格式自动识别
- 使用内存字节流进行音频解码与统一 `.wav` 规范化
- 本地物理测时
- `play_synced_step(...)` 可视化调度原语
- AST 覆盖校验
- 代码讲解场景对 `solution_code` 的强约束注入
- section 级 narration track 重建
- FFmpeg 回灌 section 音轨
- 合并后音轨保留校验

---

## 3. 架构核心原则

### 3.1 视觉与旁白解耦
V5.0 明确拒绝让一份文案同时承担“屏幕文本”和“TTS 旁白”双重职责。

原因很简单：
- 屏幕短句要求短、稳、易扫读
- TTS 旁白要求口语化、自然、可听

因此：
- `Section.lecture_lines` 继续表示画面短句
- `spoken_script` 专门表示旁白扩写
- `spoken_script` 绝不进入画面

### 3.2 标准答案代码主权
对 C2V 来说，`solution_code` 不是“可参考素材”，而是业务真值。

因此：
- Prompt 中必须显式注入用户原始 `solution_code`
- 代码展示类 section 只能忠实展示该代码
- 不允许模型私自重写算法、替换变量语义、删改关键分支
- 不允许用“示例代码”“伪代码”替代标准答案代码

### 3.3 时间真值来自物理文件
模型估时、接口 metadata 时长、经验值时长都不是可信真值。

V5.0 的时间真值定义为：
- 音频先落盘
- 再用本地库测时
- 再把测得的 `audio_duration` 写入 sidecar 数据

只有这一层测时，才允许参与后续：
- Prompt 注入
- 视觉调度
- narration track 重建
- 音视频对齐验收

### 3.4 最终音轨不押注 Manim
V5.0 早期确实尝试过依赖 Manim 的 `add_sound()` 链路，但实弹验证暴露出一个关键事实：

- 宏观上 mp4 有音轨
- 局部上会出现大面积 narration 丢失

因此最终架构选择是：
- 允许 Manim 在渲染期参与临时音频调度
- 但绝不把最终音轨正确性押在 Manim 内部混音上

最终成片音轨以 Python 侧重建结果为准。

---

## 4. 输入契约与数据模型

### 4.1 顶层输入契约
C2V 的运行入口围绕两个主输入展开：

```python
RunConfig(
    problem_description: str,
    solution_code: str,
    ...
)
```

其中：
- `problem_description` 决定 Stage 1 的讲解目标、问题建模与章节结构
- `solution_code` 决定 Stage 2 与 Stage 3 中代码展示、执行追踪与算法解释的真值来源

### 4.2 Stage 2 输出的 `Section`
当前 Stage 2 输出的 section 结构仍然是：

```python
Section(
    id: str,
    title: str,
    lecture_lines: List[str],
    animations: List[str],
    estimated_duration: Optional[int]
)
```

V5.0 不覆盖这个结构，而是在 Stage 2.5 派生出旁车数据 `section_steps`。

### 4.3 `section_steps` 结构
每个 `lecture_line` 会裂变成一个 step：

```python
{
    "screen_text": "画面上的短句",
    "spoken_script": "供 TTS 使用的最小增量口语旁白",
    "audio_path": "/abs/path/to/step_00.wav",
    "audio_duration": 4.655979166666667
}
```

字段语义：

- `screen_text`
  视觉短句真值。只用于屏幕显示。

- `spoken_script`
  最小增量扩写后的旁白真值。只用于 TTS。

- `audio_path`
  容器内可直接访问的绝对路径。后续既会被 Prompt 注入，也会被 Python 侧重建 narration track 使用。

- `audio_duration`
  音频物理时长，单位秒，浮点数。

### 4.4 存储位置
`section_steps` 会持久化到：

`<output_dir>/<section_id>_steps.json`

其设计目的包括：
- Prompt 注入
- 调试与复盘
- section 回灌
- 缓存复用

---

## 5. `src/audio_steps.py`：音频引擎

`src/audio_steps.py` 是 C2V V5.0 的音频主引擎。它承担了从文本扩写到后期回灌的整条音频链路。

### 5.1 主要职责

1. 短句扩写为 `spoken_script`
2. 调用真实 TTS
3. 自动识别返回音频格式
4. 使用内存字节流完成音频规范化到 `.wav`
5. 物理测时
6. 构建 `section_steps`
7. 解析生成代码的时间轴
8. 重建 narration track
9. 回灌到 section 视频

### 5.2 关键函数

- `expand_screen_text_to_spoken_script(...)`
- `get_tts_endpoint_config()`
- `synthesize_tts_audio(...)`
- `detect_audio_format(...)`
- `normalize_audio_for_manim(...)`
- `measure_audio_duration(...)`
- `reset_section_audio_dir(...)`
- `build_section_steps(...)`
- `build_section_narration_track(...)`
- `remux_video_with_audio(...)`

### 5.3 最近一轮统一后的实现特征
当前 C2V 版本保留了相较于 K2V 更优的“内存字节解码”实现：

- TTS 返回音频字节后，不再先落临时原始文件再回读
- 直接通过 `io.BytesIO(audio_bytes)` 交给 `AudioSegment.from_file(...)`
- 统一转码为 `48000 Hz / 2 channel / 16-bit` 的规范 `.wav`

这条链路减少了临时文件中转步骤，降低了文件系统抖动，同时不改变最终输出真值。

---

## 6. TTS 物理管线

### 6.1 默认配置
当前代码默认：

- `DEFAULT_TTS_MODEL = "tts-pro"`
- `DEFAULT_TTS_BASE_URL = "https://vip.dmxapi.com/v1"`
- `DEFAULT_TTS_VOICE = "alloy"`

优先级是：

1. `TTS_API_KEY` / `TTS_BASE_URL` / `TTS_MODEL` / `TTS_VOICE`
2. `OPENAI_API_KEY`
3. 配置文件中的全局 `api_key` 与 `gpt5.base_url`

这意味着 C2V 已支持统一的全局 API Key 配置，不再要求每个服务节点单独保存一份密钥。

### 6.2 扩写策略
扩写函数 `expand_screen_text_to_spoken_script(...)` 的约束是：

- 保持原意
- 不引入新知识点
- 最小增量扩写
- 输出一条适合 TTS 的单句口语文本

这不是自由改写，而是“视觉短句 -> 可朗读单句”的轻量转换。

### 6.3 TTS 请求兼容
真实服务在兼容 OpenAI 协议时，参数兼容性并不完全稳定。因此 `synthesize_tts_audio(...)` 会依次尝试多个 payload 版本，例如：

- 带 `voice` + `response_format`
- 带 `voice` 不带 `response_format`
- 不带 `voice` 仅带 `response_format`
- 仅保留最小字段

遇到 `400` 时会降级 payload，遇到 `401/403/404` 则视为硬阻断。

### 6.4 返回格式处理
真实联调中，`tts-pro` 返回的并不一定是固定 `.wav`。因此当前实现不会假设返回格式，而是通过：

- 文件魔数
- `Content-Type`

来判断实际格式。

支持分流为：
- `.wav`
- `.mp3`
- `.ogg`

### 6.5 音频规范化
无论原始返回格式是什么，V5.0 都会执行规范化：

```python
audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format=source_format)
normalized = audio.set_frame_rate(48000).set_channels(2).set_sample_width(2)
normalized.export(target_path, format="wav")
```

规范化目的：
- 统一后续测时行为
- 统一 Manim 输入格式
- 统一 FFmpeg 回灌输入格式

### 6.6 哑弹防线
音频文件规范化前后，会做最基础的合法性检查：

- 时长不得短于阈值
- `rms` 不能为 0
- 无法识别的音频格式直接报错

这能防止“请求成功但内容无效”的假成功。

### 6.7 物理测时
当前测时逻辑：

- `.wav` 使用 `wave`
- 非 `.wav` 使用 `pydub`

注意：虽然代码保留了非 `.wav` 分支，但在当前正式链路中，返回音频最终都会被统一导出成 `.wav`，因此正常路径下实际走的是 `.wav + wave`。

### 6.8 脏缓存粉碎
`reset_section_audio_dir(...)` 会在每个 section 的音频生成前销毁旧目录再重建，防止历史音频残留冒充当前结果。

---

## 7. `prompts/base_class.py`：视觉调度原语

### 7.1 基线来源
C2V 当前 `prompts/base_class.py` 已重新对齐到 K2V 母版。这个决策的含义不是“照抄注释”，而是统一大模型在两个项目中的基类心智提示。

统一后的基类仍负责：

- `setup_layout(...)`
- `create_code_block(...)`
- `highlight_lecture_line(...)`
- `unhighlight_lecture_line(...)`
- `speak_and_highlight(...)`
- `replace_lecture_lines(...)`

### 7.2 `play_synced_step(...)`
V5.0 新增了：

```python
def play_synced_step(
    self,
    line_index,
    audio_path,
    audio_duration,
    *animations,
    highlight_color="#C35101",
    reset_color="#2C1608",
)
```

这个原语的职责是：
- 在 narration 段开始时高亮左侧对应短句
- 调用 `add_sound(audio_path)`
- 用 `audio_duration` 约束并行动画窗口
- 在 narration 段结束时恢复短句颜色

### 7.3 设计哲学
`play_synced_step(...)` 的真正价值不是“最终混音”，而是：

- 给大模型一个稳定的 narration 调度心智模型
- 让视觉表达继续自由
- 把“讲一句话持续多久”固定到 `audio_duration`

也就是说，它是视觉时间轴原语，不是最终音轨真值层。

### 7.4 C2V 专属基类价值
对 C2V 而言，`create_code_block(...)` 与 `play_synced_step(...)` 的组合非常关键：

- 前者保证代码展示风格稳定
- 后者保证代码讲解句与旁白时钟稳定
- 两者共同构成“代码精讲类 section”的标准骨架

---

## 8. `prompts/stage3.py`：代码生成模板

### 8.1 当前母版策略
C2V 的 `prompts/stage3.py` 已按 K2V 母版重铸，并在此基础上注入 C2V 专属约束。它不再沿用旧的文本拼接污染版本，而是使用统一的 V5.0 音频范式。

### 8.2 输入契约
Stage 3 现在显式消费：

- `section`
- `section_steps`
- `base_class`
- `estimated_duration`
- `solution_code`

Prompt 会注入：

- `screen_texts`
- 完整 `section_steps`
- 原始 `section.animations`
- 用户提供的标准答案代码

### 8.3 Prompt 目标
Prompt 不再只要求“大模型写动画”，而是要求它：

- 仅在画面中使用 `screen_text`
- 把 `spoken_script` 视为离线 TTS 数据，不得显示
- narration 段必须通过 `play_synced_step(...)` 调度
- narration 行数过多时必须分批切换 `screen_text`
- 代码展示必须忠实于 `solution_code`
- `construct()` 内严禁直接写 `self.add_sound(...)`

### 8.4 最近一轮的 C2V 收敛增强
在最近一轮统一手术后，Stage 3 针对“代码精讲类 section”进一步收紧了 few-shot 与规则：

- 明确要求 `code_raw = <solution_code_literal>`
- 明确要求代码块只能通过 `self.create_code_block(...)` 创建
- 明确要求代码高亮使用 `SurroundingRectangle`
- 明确要求 narration 必须逐句调用 `play_synced_step(...)`
- 明确要求不能用示例代码、伪代码或改写后的代码替代 `solution_code`

这意味着当前 Prompt 不再只是泛化动画模板，而是已经具备“代码真值 + 音频真值 + 视觉调度真值”的三重绑定能力。

### 8.5 Few-shot 骨架
few-shot 已从旧版 `highlight + wait` 改为：

```python
steps = [...]
screen_texts = [step["screen_text"] for step in steps[:4]]
self.setup_layout("标题", screen_texts)

code_raw = "用户原始 solution_code"
code = self.create_code_block(code_raw, language="python")

self.play_synced_step(...)
```

这保证大模型的默认心智是：

- narration 用 `play_synced_step`
- 画面文本来自 `screen_text`
- 代码展示来自 `solution_code`
- 动画仍可自由构造

---

## 9. `src/agent.py`：运行时总调度

### 9.1 Stage 2.5 注入
`prepare_section_steps(...)` 在 Stage 3 之前运行，构建并缓存 `section_steps`。

如果本地已经存在：
- `section_steps.json`
- section 音频目录
- 目录中有可用 `.wav`

则会复用已生成的音频侧车数据。

### 9.2 Stage 3 调用契约
`generate_section_code(...)` 在实际调用 `get_prompt3_code(...)` 前，会先完成：

1. `prepare_section_steps(section)`
2. `section_steps` 持久化与缓存
3. 将 `solution_code` 一并注入 Stage 3 Prompt

因此 C2V 当前的 Stage 3 不再是只看 section 的单源生成，而是同时受：

- 视觉短句
- 音频侧车
- 标准答案代码

三个真值源共同约束。

### 9.3 AST 覆盖校验
`_validate_synced_step_coverage(...)` 会对生成代码执行本地 AST 校验：

- 找到 `construct()`
- 统计 `play_synced_step(...)` 调用数
- 拒绝 `construct()` 里直接写 `add_sound()`
- 若 `play_synced_step` 调用数小于 `len(section_steps)`，直接判失败并重生

这一步是防止 Stage 3 业务代码只对前几句挂旁白、后面偷工减料的重要硬闸门。

### 9.4 音轨存在校验
`_video_has_audio_stream(...)` 使用 `ffprobe` 检查视频是否带音轨。

使用位置包括：
- 渲染缓存命中时的复用判断
- section 回灌后的视频校验
- 最终合并视频的音轨校验

### 9.5 section 回灌入口
`_remux_section_audio(...)` 是 section 级收口函数。它会：

1. 读取 `<section_id>_steps.json`
2. 读取 `<section_id>.py`
3. 调用 `build_section_narration_track(...)`
4. 调用 `remux_video_with_audio(...)`
5. 输出 `<output_dir>/audio_remux/<section_id>_with_audio.mp4`

因此从 V5.0 开始，`section_videos` 的最终权威结果应该理解为：

- 不是原始 Manim 直出视频
- 而是回灌后的 section 视频

### 9.6 渲染修复链
`debug_and_fix_code(...)` 在 section 渲染成功后并不会直接接受原始视频，而是继续执行：

- 音轨回灌
- 回灌后音轨存在校验
- 必要时重新渲染或继续修复

这让“渲染成功但声音不完整”不再被误判为成功。

---

## 10. 终极防线：时间轴重建与音频回灌

### 10.1 为什么需要回灌
真实联调表明，以下事实可能同时成立：

- TTS 单段音频是正常的
- Stage 3 的 `play_synced_step` 覆盖也完整
- 但复杂 scene 的最终音轨会出现大面积局部静音

也就是说，问题并不一定在：
- TTS 哑弹
- Prompt 漏调用

而在：
- 复杂业务场景下，Manim 内部的逐句 `add_sound()` 混音不稳定

### 10.2 当前实现思路
V5.0 的正式方案是放弃对 Manim 最终混音结果的信任，转而：

1. 使用 Stage 3 代码作为视觉时间轴脚本
2. 本地 AST 解析 `construct()`
3. 抽取 narration / 停顿事件
4. 重新构造 section narration track
5. 用 FFmpeg 把 narration track 回灌到渲染视频中

### 10.3 时间轴解释规则
当前 `build_section_narration_track(...)` 的解释规则是明确且有限的：

- 遇到 `play_synced_step(...)`
  - 追加对应 step 的旁白音频

- 遇到 `wait(x)`
  - 追加 `x` 秒静音

- 遇到 `play(..., run_time=t)`
  - 追加 `t` 秒静音

- 遇到 `play(...)` 且未显式给出 `run_time`
  - 视为 `1.0s` 静音窗口

- 遇到 `replace_lecture_lines(...)`
  - 视为 `1.0s` 静音窗口

- 支持简单的 `if len(steps) > N:` 分支模式

这套规则的目标不是完美还原所有业务语义，而是：

- 用确定性、可复盘的方式重建 narration 时间表
- 确保每个 `play_synced_step` 对应的旁白绝不会丢

### 10.4 当前能解决什么
它已经能解决此前最严重的问题：

- 不再把“文件有 AAC 流”误当成“旁白完整”
- 每个 step 的旁白都被明确纳入最终 track
- section 与最终成片都能被 `ffprobe` / `silencedetect` 直接审计

### 10.5 当前保留什么边界
它会保留业务代码里显式存在的视觉-only 停顿。

因此如果生成代码中存在：

- `self.wait(0.3)`
- `self.wait(1.5)`
- `self.play(...)` 但没有 narration
- `replace_lecture_lines(...)`

则最终回灌 track 中会保留对应静音窗口。

这意味着：
- “局部完全掉音”问题已经被回灌机制根治
- “视觉-only 过渡停顿过长”则属于 Prompt 与业务代码层面的节奏问题

这两者必须严格区分。

---

## 11. 配置层与物理真值辅助模块

### 11.1 `src/gpt_request.py`
当前配置层已支持统一全局 API Key 回退：

- 若服务私有 `api_key` 缺失
- 非 `iconfinder` 服务会优先读取 `OPENAI_API_KEY`
- 再回退读取顶层配置中的共享 `api_key`

这让 C2V 的 LLM 与 TTS 调用默认走统一凭据，不再需要为每个模型单独维护一套密钥字段。

### 11.2 `src/api/utils/file_utils.py`
`get_video_duration(...)` 已优先使用 `ffprobe` 获取物理视频时长，仅在必要时回退到 `moviepy`。

这与 V5.0 的总体设计一致：凡涉及成片、section 或音轨时长判断，都优先相信物理文件探测结果。

---

## 12. 产物结构

当前正式链路下，一个 C2V 任务目录内的关键产物包括：

- `outline.json`
- `storyboard.json`
- `storyboard_with_assets.json`
- `<section_id>_steps.json`
- `audio/<section_id>/step_XX.wav`
- `<section_id>.py`
- `media/videos/.../<SceneName>.mp4`
- `audio_remux/<section_id>_track.wav`
- `audio_remux/<section_id>_with_audio.mp4`

这些产物分别承担：

- 大纲与分镜真值留档
- 旁白侧车留档
- 渲染代码留档
- section 音轨回灌留档

---

## 13. 当前实现状态

V5.0 已经完整落地，当前正式链路是：

`problem_description + solution_code`
-> Stage 1 Outline
-> Stage 2 Storyboard
-> `lecture_lines`
-> `spoken_script`
-> `section_steps`
-> 真实 TTS 音频
-> 统一 `.wav`
-> 物理测时
-> Stage 3 `play_synced_step` 代码
-> AST 覆盖校验
-> 渲染 section 视频
-> AST 时间轴重建
-> narration track
-> FFmpeg 回灌 section 音轨
-> 最终合并成片

这条链已经把“宏观有音轨、局部大掉音”从不可控黑盒问题，降维成了可以静态分析、可验证、可回灌修复的问题。

---

## 14. 已知边界

当前代码仍有三个值得注意的边界：

1. narration track 的重建规则是 AST 启发式规则，不是全语义解释器
2. 视觉-only 的停顿仍会保留为静音窗口
3. 代码精讲类 section 的质量仍然高度依赖 Prompt 对 `solution_code` 忠实性的持续收敛

这不是 V5.0 的失败，而是当前实现的明确边界。V5.0 已经解决的是“局部 narration 消失”的系统性故障；下一阶段若要继续优化，重点将转向：

- Prompt 节奏约束
- `play(...)` / `wait(...)` 的静音预算建模
- 代码精讲类 section 的 few-shot 继续收紧
- narration track 与视觉节奏的进一步压缩对齐

---

## 15. 视频概述（Overview Section）

### 15.1 背景与教育理论

V5.1 在视频最开始增加了一个「解题导览」概述 section，快速预览本节课将讲些什么。

设计理念参考：

- **先行组织者理论 (David Ausubel)**：在正式教学前给学习者一个概念框架，研究显示可提高 20-30% 的信息留存率
- **信号原则 (Signaling Principle)**：突出材料组织结构的线索可以改善学习效果
- **MIT OCW / 3Blue1Brown 混合风格**：先展示标题，然后逐一预览各章节主题

### 15.2 技术实现

概述 section 采用**确定性模板**生成 Manim 代码（不依赖 LLM），保证 100% 成功率：

1. `inject_overview_section()` 在 `generate_storyboard()` 之后、`generate_codes()` 之前被调用
2. 从大纲的 section titles 提取后，通过 **AI 进行聚合精简**（合并为 5-10 条核心要点），生成最终的 `lecture_lines`。
3. 旁白文本走正常 TTS 管线（`expand_screen_text_to_spoken_script` → TTS → 物理测时）
4. Manim 代码由 `src/overview_scene.py` 的 `generate_overview_manim_code()` 确定性生成
5. 在 `generate_section_code()` 中，检测到 `section_overview` 后跳过 LLM，直接使用模板

### 15.3 数据流

```
Stage 1 (大纲) → 提取 section titles
    ↓
inject_overview_section() → AI 合并精简标题 → 创建 Section("section_overview")
    ↓
Stage 2.5 (TTS) → 正常走 build_section_steps → 生成旁白音频
    ↓
Stage 3 (代码) → 检测到 section_overview → 使用确定性模板（跳过 LLM）
    ↓
渲染 → 回灌音轨 → 合并（overview 排在封面之后、正式内容之前）
```

### 15.4 视觉设计

概述 section 的视觉效果：

- 标题 "解题导览" 居中显示（大字，FadeIn）
- "本节内容" 副标题 + 下划线装饰
- 概要标题（由 AI 合并后）逐条显示，配合 `play_synced_step` 旁白
- 如果内容过多，自动进行分页排版布局
- 结束语 "让我们开始吧！"

### 15.5 关键文件

- `src/overview_scene.py`：确定性 Manim 模板生成器
  - `build_overview_lecture_lines()` — 从 section titles 生成 lecture_lines
  - `generate_overview_manim_code()` — 生成完整 Manim 代码
- `src/agent.py`：
  - `inject_overview_section()` — 在 sections 列表最前面注入概述 section
  - `_generate_overview_code()` — 使用模板生成概述代码
  - `inject_cover_section()` — 在 sections 列表最前面注入封面 section
  - `_generate_cover_code()` — 使用模板生成封面代码
  - `generate_section_code()` — 检测 section_overview / section_cover 后路由到模板
  - `GENERATE_VIDEO()` — 在 storyboard 之后依次调用 `inject_overview_section()` 和 `inject_cover_section()`

---

## 16. 视频封面（Cover Section）

### 16.1 背景

V5.2 在视频最开头增加了一个「封面」section，仅展示知识点名称大字，作为视频的标题画面。

### 16.2 视觉设计

封面 section 的视觉效果：

- **渐变背景**：135° 对角线渐变（`#fff6db` → `#f9ebe4` → `#fbd9c4`），与前端 `k2v-preview.html` 的播放器背景一致
- **知识点名称**：居中超大字（font_size=52），金色 `#BE8944`，加粗，FadeIn 动画
- **装饰线**：上下两条对称装饰线（金色 `#e4c8a6`），Create 动画从中心向两侧展开
- **有旁白**：封面现在包含一句介绍性旁白（如“本视频将带你学习：XXX”），会走 TTS 管线并回灌音轨。
- 动画结束后短暂淡出过渡

### 16.3 技术实现

封面 section 采用**确定性模板**生成 Manim 代码（不依赖 LLM），保证 100% 成功率：

1. `inject_cover_section()` 在 `inject_overview_section()` 之后被调用，插入到 sections 最前面
2. 封面**走 TTS 管线**（生成 `section_steps`、生成介绍语音频）
3. Manim 代码由 `src/cover_scene.py` 的 `generate_cover_manim_code()` 确定性生成
4. 在 `generate_section_code()` 中，检测到 `section_cover` 后跳过 LLM，直接使用模板
5. 封面渲染成功后，会执行正常的音轨回灌流程

### 16.4 数据流

```
Stage 1 (大纲) → 提取 topic 名称
    ↓
inject_cover_section() → 创建 Section("section_cover")
    ↓
Stage 2.5 (TTS) → 正常走 build_section_steps → 生成封面介绍语音频
    ↓
generate_section_code() → 检测到 section_cover → 使用确定性模板（跳过 LLM）
    ↓
渲染 → 音轨回灌 → 合并（cover 排在最前面）
```

### 16.5 与其他 section 的区别

| 特性          | 封面 (cover) | 概述 (overview) | 普通 section |
| ------------- | ------------ | --------------- | ------------ |
| LLM 代码生成  | ❌ 跳过      | ❌ 跳过         | ✅ 使用      |
| TTS 旁白      | ✅ 有        | ✅ 有           | ✅ 有        |
| section_steps | ✅ 有        | ✅ 有           | ✅ 有        |
| 音轨回灌      | ✅ 有        | ✅ 有           | ✅ 有        |
| 排列顺序      | 第 1 位      | 第 2 位         | 第 3+ 位     |

### 16.6 关键文件

- `src/cover_scene.py`：确定性 Manim 模板生成器
  - `generate_cover_manim_code(topic)` — 生成完整封面 Manim 代码
- `src/agent.py`：
  - `inject_cover_section()` — 在 sections 列表最前面注入封面 section
  - `_generate_cover_code()` — 使用模板生成封面代码
