# C2V 技术文档（可用于 PPT 讲解）

> 版本信息：基于当前 `code2video/` 实现（2026-07-22）

## 一、文档目标与边界

本文件用于技术汇报（PPT）场景，目标读者包含：

- 架构设计负责人（关心链路可靠性、失败模式）
- 研发同学（关心模块职责和改造点）
- 运维同学（关心资源、超时、日志和可观测性）
- 产品/演示同学（关心效果、演示时长和交付指标）

**一句话定义**：
Code2Video（C2V）是一个“基于问题描述 + 代码输入”的自动化教学视频生成服务，产出完整可播放视频，支持 SSE 实时状态、章节并行、视觉反馈、失败回退与可观测化元数据。

---

## 二、定位与范围（适合第一张 PPT）

- 输入：`problem_description + solution_code`（以及学习者上下文）
- 输出：`mp4` 视频 + 结构化元数据（成功状态、warning、重试摘要、时长/渲染信息）
- 输出特征：
  - 支持 1080p / 4k30 / 4k60 渲染档位
  - 先交付可播放视频优先（非“百分百无瑕疵”失败）
  - 失败策略强调“失败最晚、可追溯、可回退”

### 非功能边界（PPT 口径可直接用）

- 可靠性优先于完美美观：保证完整章节可播放
- 支持异步任务（Celery + Redis）
- 默认重试是“首尝试 + 2 次修复（共 3 次）”
- 采用分阶段、分粒度的回退（章节级、渲染级、规格级）
- 输出元数据可供 QA 与运营复盘

---

## 三、端到端链路总览（适合画流程图的 PPT）

```text
客户端
  ↓ POST /api/v1/generate-video
  ↓
FastAPI(API 层) + Redis/SSE 回调
  ↓
Celery generate_video_task
  ↓
TeachingVideoAgent（核心流水线）
  1) 用户画像解析
  2) 大纲生成
  3) 分镜生成
  4) 封面/导览片段注入
  5) 每章代码生成 + 旁白生成 + 音频
  6) 先1080p基线渲染（含可选视觉检查）
  7) 预算可用时再尝试目标4K
  8) 章节拼接 + 输出校验
  ↓
save_video_with_hash 持久化（hash 命名）
  ↓
result 写回 SSE/result 回包
```

---

## 四、目录与核心模块（适合第二页）

### API 层
- `src/api/routes/video.py`
  - `POST /api/v1/generate-video`
  - `GET /api/v1/tasks/{task_id}`
  - `GET /api/v1/files/{filename}`
  - `HEAD /api/v1/files/{filename}`
  - `GET /api/v1/files/{filename}/metadata`
  - 依赖统一 API key 校验 `verify_api_key`

### 任务层
- `src/api/tasks/video_tasks.py`
  - Celery 任务 `generate_video_task`
  - 按 `request_data` 创建 `RunConfig` 与用户画像
  - 实例化 `TeachingVideoAgent`
  - 汇总 `metadata` 并写入 `result`

### 核心编排
- `src/agent.py`
  - `TeachingVideoAgent.generate_video_task()` 样式的流水线主控
  - 模块方法包括：
    - `generate_outline`
    - `generate_storyboard`
    - `inject_overview_section` / `inject_cover_section`
    - `generate_and_render_sections`
    - `merge_videos`

### 生成与校验
- `src/pedagogy.py`：教学大纲/分镜 schema 与校验
- `src/audio_steps.py`：
  - 讲解文本扩写（`expand_screen_text_to_spoken_script`）
  - TTS 合成
  - step 组装（`build_section_steps`）
  - 音频静音检测/时长校验
- `src/delivery.py`：
  - 常量语义色彩映射与 fallback 注入
  - Scene 识别（优先具体类，避免误用基类）
  - 章节渲染缓存指纹
- `src/rendering.py`：渲染 Profile 定义与 `ffprobe` 媒体校验
- `src/api/utils/sse.py`：SSE 事件格式与推送回调

### 辅助组件
- `src/api/auth.py`：API key 安全
- `src/config.py`：运行时配置读取
- `src/utils/file_utils.py`：视频命名、哈希、落盘
- `src/vivo_tts.py`：vivo 旁白引擎

---

## 五、请求结构与参数（适合“输入参数页”）

### 1) `POST /api/v1/generate-video` 请求体（关键字段）

- `problem_description`（必填）
- `solution_code`（必填）
- `language`：默认 `Python`
- `duration`：可选 `int`（用于目标时长估算）
- `render_profile`：`1080p30 | 4k30 | 4k60`，默认 `4k30`
- `difficulty`：`simple | medium | hard`
- `extra_info`：学习者画像补充（年龄/语气/背景/限制等）
- `use_feedback`：是否使用视觉反馈
- `use_assets`：是否使用额外素材上下文
- `api_model`：模型名（如 `gpt-5`）
- `age`, `gender`：可选上下文增强字段
- 请求头：`X-API-Key`
- `X-Task-ID` 在 SSE 响应头返回（对应 Celery 任务 id）

### 2) 输出结果关键字段（成功时）

- `video_file`：哈希命名视频文件名
- `delivery_status`：`success` 或 `success_with_warnings`
- `warnings`：结构化 warning 阵列（后文详解）
- `requested_render_profile` / `actual_render_profile`
- `pipeline_elapsed_seconds`
- `stage_timings`
- `retry_summary`
- `section_fallbacks`
- `physical_media`（媒体检测信息）
- `long_silence_count = null`
- `long_silence_checked = false`

### 3) SSE 事件类型

- `running`
- `finished`
- `failed`
- `result`

事件推送通道：
- API route 先建 Redis `pubsub` 通道
- Celery 任务通过 `SyncTaskProgressCallback` 逐步 `publish`
- SSE 读循环：收到 `result` 或 `__END__` 结束

---

## 六、重试、失败、回退机制（适合关键页）

### 全局重试预算

- 在 `RunConfig`：
  - `max_repair_attempts = 2`
  - 实际 `max_attempts = 3`（首次+2修复）
- 与历史一致的约束：
  - `feedback_rounds = 2`
  - `pipeline_budget_seconds = 2400`
  - `finalize_reserve_seconds = 240`

### “可交付优先”关键策略

1. **章节先渲染 1080p 基线**：保证可播放可合并
2. **视觉优化非硬失败**：失败后可降级为 warning，不必立刻阻断
3. **4k 目标受预算与可行性约束**：超预算/失败则回退 1080p
4. **失败时输出完整元数据**：包括 warning、重试、fallback 细节，便于复盘

### 阶段失败条件（可作为流程PPT）

- 目录/参数解析失败（如大纲分段 schema 不可恢复）→ 直接 fail
- 章节生成或渲染：
  - 第一轮失败可触发修复（不达上限）
  - 仍失败继续复用 fallback/缓存策略
- 合并与保存同样有尝试上限（同上限）

### 章节级回退与模板 fallback

- 章节渲染失败且可回退时，系统会安装 fallback scene（`generate_fallback_scene_code`）
- 部分场景失败时，仍会尽量让任务维持推进，避免级联阻塞
- 可回退的章节信息会写入 `section_fallbacks`

---

## 七、渲染执行策略（适合“性能与稳定性页”）

### 并发与流水

- 大纲与 storyboard 按顺序生成
- 章节层面并发采用两阶段策略：
  1) 先并发生成章节代码（`ThreadPoolExecutor`）
  2) 代码就绪后提交 1080p 渲染（`ProcessPoolExecutor`）
- 并发参数（可配置）：
  - `C2V_CODE_WORKERS`（代码生成）
  - `C2V_PREVIEW_RENDER_WORKERS` 或 `C2V_RENDER_WORKERS`（1080p 渲染）
  - `C2V_VISUAL_WORKERS`（可选视觉复查）
  - `C2V_NATIVE_RENDER_WORKERS`（原生目标规格渲染）

### 渲染流程（章节内）

- 渲染前会做 AST/scene 语义检查
- 每章首先尝试 1080p（基线）
- 若配置且预算允许，再执行目标规格（如 4k）
- 若目标规格失败/超预算，统一回退 1080p 版本并写 warning

### 物理校验

`validate_rendered_media` 主要检查：

- 分辨率与 fps
- 是否有音频流
- 合并后视频 codec、像素格式（H.264 / yuv420p）
- （当前路径不默认开启长静音严格失败）

---

## 八、视觉反馈（可解释“质量控制页”）

- 是否启用：取决于配置与预算（`use_feedback` 与剩余时间）
- 每个章节会进行预设轮次内检查（默认 2）
- 缓存 key 与当前代码/音频/规格相关，避免重复计算
- 失败类型一般作为 warning，不一定阻断整条任务
- 仅当关键硬失败（无可播放章节）时，任务失败

---

## 九、旁白与语音策略（适合教学质量页）

- 屏幕文本与讲解文本有结构化映射：
  - `highlight_groups` 分组
  - `paginate_highlight_groups` 约束每页最大片段数
- 每个分组文本经过大模型扩展为“完整句”旁白
- 每段输出与音频合成后用于逐步 `play_synced_step`
- 音频规范化：统一采样率/声道/格式
- 语音静音过滤有检测函数，但当前标准路径不将长静音作为失败门槛

---

## 十、元数据字段清单（适合演示页）

### 全局

- `delivery_status`
- `warnings`
- `requested_render_profile`
- `actual_render_profile`
- `pipeline_elapsed_seconds`
- `deadline_action`
- `retry_summary`
- `section_fallbacks`
- `stage_timings`

### section 级

- `sections`（per section）：是否 passed、预览路径、失败原因
- `visual_quality`：`passed/failed` 与 `review_rounds`

### 物理输出

- `physical_media`：时长、宽高、fps、codecs 等

### 长静音字段

- `long_silence_count` 被明确设为 `null`
- `long_silence_checked = false`
- 防止“未检测”与“检测为0”语义混淆

---

## 十一、常见失败场景与建议排障（适合交付前检查清单）

### 常见失败

1. API Key 配置未齐
2. 大纲/分镜 schema 校验失败（含字段格式问题）
3. 章节代码语法错误（AST/construct 规范）
4. TTS 合成异常（空音频、silence、format）
5. 章节渲染超时/崩溃（Manim/FFmpeg）
6. 合并器缺章节
7. Redis 或 Celery 任务链路异常

### 排障顺序建议

1. 优先看 `video_task` 日志（重试次数、最后一次错误）
2. 看 `section_fallbacks`：哪些章节触发 fallback
3. 检查 `deadline_action` 是否出现跳过某阶段（budget 限制）
4. 检查 `stage_timings` 是否某一阶段异常慢（可直接归因优化）
5. 检查 `visual_quality` 哪些章节未通过
6. 对比 `requested_render_profile` 与 `actual_render_profile` 的回退原因

---

## 十二、可复用的 PPT 演讲结构（直接拎去用）

1. **项目动机**：为什么做 C2V
2. **输入输出定义**：给出最小请求/返回示例
3. **架构图**：API → Redis/SSE → Celery → Agent
4. **关键算法链路**：代码/旁白/渲染/拼接
5. **可靠性设计**：重试+回退+warning 不阻塞
6. **性能与预算策略**：1080基线优先、原生4k预算估算
7. **可观测性**：SSE、任务状态、metadata
8. **生产化指标**：成功率、章节完整率、平均耗时、4k 回退率
9. **未来优化方向**：并发策略、渲染 cache 强化、反馈准确率

---

## 十三、性能与成本建议（讲解时可补充）

- 优先确认 `C2V_CODE_WORKERS` / `C2V_PREVIEW_RENDER_WORKERS` 与机器核数匹配
- 对 4k 流量大的场景，建议打开 pipeline budget 可观测告警：超过预算立即触发降级
- 渲染异常常由单章失败传播，建议按 `section_fallbacks` 和章节日志先定位最差章节
- 如果经常触发视觉 review，先评估是否减小 `C2V_VISUAL_WORKERS` 的并发或优化 prompt 稳定性

---

## 十四、配置清单（精简版）

- `API_KEYS`
- `DEFAULT_API`, `DMX_BASE_URL`, `DMX_API_KEY`, `LOGIC_MODEL`, `CODE_MODEL`
- `TTS_PROVIDER`, `VIVO_TTS_*`（如果走 vivo）
- `API_PORT`, `REDIS_PORT`
- `VIDEO_PIPELINE_BUDGET_SECONDS`（默认 2400）
- `VIDEO_FINALIZE_RESERVE_SECONDS`（默认 240）
- `C2V_RENDER_WORKERS` / `C2V_PREVIEW_RENDER_WORKERS` / `C2V_CODE_WORKERS`
- `C2V_VISUAL_WORKERS`, `C2V_NATIVE_RENDER_WORKERS`
- `C2V_PREDELIVERY_FEEDBACK_ROUNDS`（默认 2）
- `MANIM_RENDER_TIMEOUT_SECONDS`, `VIDEO_TASK_TIMEOUT_SECONDS`

---

## 十五、版本差异与约定

- 代码当前存在中文注释/文档编码不统一，建议新文档统一 UTF-8（本文件即为该版本）
- 流程中 `delivery_status` 的语义是“可播放优先”，不是“像素级零缺陷优先”
- 4k 是目标规格，不是强制条件；失败降级后会如实记录 `warnings`

---

## 十六、给 PPT 同学的“直接可讲文本”示例

> 这条链路的核心是：
> 不追求一步到位地“完美视频”，而是先保证章节完整和可播放，再在可用预算内逐步提质。生成阶段默认是“可交付优先”：
> - 大纲与分镜通过后先生成可播放章节，
> - 缺章节或严重错误再触发修复，
> - 最后做合并和媒体校验，
> - 如果 4k 时序不安全就回退 1080p，不瞎重试，不瞎报错。

---

## 十七、快速引用命令（演示附录）

- 查看进度（SSE）：`curl -N -H "X-API-Key: <key>" -X POST http://<host>:8081/api/v1/generate-video -H "Content-Type: application/json" -d @request.json`
- 查询任务：`GET /api/v1/tasks/{task_id}`
- 下载：`GET /api/v1/files/{filename}`

---

> 说明：该文档以当前仓库实现为准，若你要我下一步，我可以按“每页 1-2 句讲稿 + 图表占位 + speaker note”再输出一个可直接粘贴到 PPT 的版本。
