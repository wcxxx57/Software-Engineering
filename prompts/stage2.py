import json
from typing import Optional
from .user_profile import UserProfile, get_default_profile


def get_prompt2_storyboard(
    outline: str,
    reference_image_path: Optional[str] = None,
    user_profile: Optional[UserProfile] = None
):
    """
    生成分镜脚本的提示词
    
    Args:
        outline: 大纲JSON字符串
        reference_image_path: 参考图片路径（可选）
        user_profile: 用户配置，可选
    
    Returns:
        完整的提示词字符串
    """
    # 如果没有提供用户配置，使用默认配置
    if user_profile is None:
        user_profile = get_default_profile()
    
    # 获取 AI 智能生成的用户画像提示词
    profile_prompt = user_profile.get_stage2_prompt()
    target_language = user_profile.get_language()
    
    base_prompt = f""" 
    你是一位**硬核算法可视化导演**。请将大纲转化为详细的 Manim 动画脚本。

    {profile_prompt}

    # 通用视觉映射系统 (Universal Visual Mapping System)

    1.  **多维布局策略 (Layout Strategy)**:
        - **智能布局分流 (Smart Layout Branching)**:
          - **Case A: 纯理论/无代码 (No Code)** -> 保持现状：**左右对半布局**。左侧放讲解文字，右侧放可视化动画。
          - **Case B: 代码演示场景 (With Code - DEFAULT for Algorithms)** -> **采用 "左侧分割 + 右侧全屏" 布局 (Split-Left Layout)**:
            - **规则**: 凡是讲解算法具体步骤（循环、判断、交换、递归）的章节，**必须**使用此模式展示代码片段。严禁只在最后才展示代码。
            - **左上区域 (Top-Left, ~30% height)**: 放置讲解文字 (Lecture Notes)。
            - **左下区域 (Bottom-Left, ~70% height)**: 放置 **{target_language}** 代码片段 (Code Snippet)。
            - **右侧区域 (Right Half, 100% height)**: 放置核心可视化/动画 (Main Visual)。
          - **Case C: 完整代码/纯代码 (Full Code - FINAL SECTION ONLY)**:
            - **规则**: 最后一个章节专门展示完整 **{target_language}** 源码。
            - **布局**: **隐藏左侧文字** (Lecture Notes opacity=0)，将代码对象放大并居中 (`scale(0.8).move_to(ORIGIN)`)。
            - **分页**: 如果代码超过 20 行，必须拆分为连续的子场景 (Sub-scenes, e.g., `Scene 12.1`, `Scene 12.2`)。

                - **强制分页规则 (Pagination Protocol)**:
                    - **讲解文字逐行限制（硬性）**: 每行讲解文字不超过 **20个中文字符**（含标点、英文字母、数字）。保持当前教学信息量，不要过度压缩成只有名词的关键词；只有超过 20 字时才按语义自然换行。
                    - **讲解文字分批规则（硬性，必须按顺序执行）**:
                        1) **先判断是否有代码块**：
                             - 有代码块（左下有 `create_code_block`）→ 每批最多 **4行**
                             - 无代码块（纯讲解 + 右侧动画）→ 每批最多 **8行**
                        2) **再按语义完整性分批（优先级高于行数上限）**：
                             - 一个知识点可跨多批（建议 2-4 批，按时长自适应）
                             - **不同知识点不能硬凑到同一批**
                             - 严禁机械地每批凑满 4 行或 8 行
                        3) **最后检查上限**：若超出 4/8 行，仅在该知识点内部按自然语义断点拆分，禁止跨知识点拼接凑行数。
                    - **代码量控制**: 如果代码过长导致左下区域放不下，**必须**将内容拆分为连续的子场景。宁可多页，不可字小。
        - **State Monitor (右侧角落)**: 实时显示的变量值（Cost, Index, True/False），不得占用底部字幕条形式的区域。
        - **Text Zoning Strategy (文本分区策略)**:
          - **Lecture Lines (左侧教学文字)**: 固定放在左侧文字区，保持精炼但有解释作用；它不是字幕。
          - **No Captions**: 禁止生成逐句旁白字幕、底部字幕文字、字幕背景框或任何 full-width bottom bar。
          - **Narration Separation**: `lecture_lines` 只负责画面文字；完整口语旁白由后续 `spoken_script` 生成，禁止把完整旁白塞进画面。
          - **Labels (标签)**: 跟随物体的标签必须简短（Max 2-3 words）。
          - **Title**: 每一节的标题固定在左上角或顶部，不可遮挡 Main Visual Area。

    2.  **抽象概念实体化**:
        - **引用/指针**: 必须画成箭头 (Arrow)。
        - **递归**: 必须画成**调用栈 (Call Stack)**，用一个个压入的矩形块表示，旁边标注参数值。
        - **比较/判断**: 必须在屏幕上显示临时的数学不等式（例如 `dist[B] > new_dist`），判定后再消失。
        - **记忆化/缓存**: 画成一个表格 (Table/Grid)，命中时高亮闪烁。

    3.  **脚本要求**:
        - 每一句旁白（Lecture Line）必须对应代码的解释。
        - 每一个动画（Animation）必须对应数据的变化（Create, Transform, FadeOut）。
        - **节奏控制**：根据用户画像中的动画节奏要求调整。
    
    4.  **时长规划 (Duration Planning)**:
        - 每个 section 必须包含 `estimated_duration` 字段，单位为**秒**。
        - 时长估算规则：
          - 每句 lecture_line 约 3-5 秒（根据文字长度）
          - 每个复杂动画约 2-4 秒
          - 简单动画（FadeIn/FadeOut）约 0.5-1 秒
          - 代码展示页面需要额外 3-5 秒供观众阅读
        - 场景引入 (intro) 通常 30-60 秒
        - 核心算法演示章节通常 45-90 秒
        - 代码展示章节通常 20-40 秒
        - **重要**：时长估算必须服从大纲目标总时长，不能刻意高估，也不能靠重复内容填充

    5.  **语言适配要求**:
        - 所有代码示例必须使用 **{target_language}**
        - 代码语法高亮应适配 {target_language} 语法

    ## 输入大纲
    {outline}
    """

    base_prompt += """
    
    ## ⚠️⚠️⚠️ JSON 输出格式要求（必须严格遵守）⚠️⚠️⚠️
    
    **🚨 关键规则：**
    1. **只输出纯 JSON**，不要添加任何解释文字、markdown 标记或注释
    2. **字符串中的引号必须转义**：如果字符串内容包含双引号 `"`，必须写成 `\\"`
    3. **字符串中的换行必须转义**：使用 `\\n` 而不是实际换行
    4. **数组最后一个元素后不要加逗号**
    5. **所有字符串必须用双引号**，不能用单引号
    6. **确保 JSON 可以被 Python 的 json.loads() 正确解析**
    7. **请直接输出 JSON，不要用 ```json ``` 包裹**
    8. **注意：在 JSON 字符串内容中，严禁出现未经转义的双引号（"），如果需要引用，请一律使用单引号（'）或中文书名号（《》、「」）代替。**
    
    **✅ 正确的 JSON 格式示例：**
    ```json
    {
        "sections": [
            {
                "id": "section_0_intro",
                "title": "场景引入",
                "estimated_duration": 45,
                "lecture_lines": [
                    "第一句旁白",
                    "第二句的上半句，",
                    "第二句的下半句。"
                ],
                "layout_mode": "no_code",
                "highlight_groups": [[0], [1, 2]],
                "evidence_lines_indices": [0, 1],
                "zpd_check_line_index": 0,
                "bridge_line_index": 2,
                "new_terms_introduced": [],
                "code_snippets": [],
                "animations": [
                    "Define Visual Layout: Left-Right Split.",
                    "Visual: FadeIn title at top.",
                    "Visual: Create scene illustration."
                ]
            },
            {
                "id": "section_1",
                "title": "算法核心步骤",
                "estimated_duration": 60,
                "lecture_lines": [
                    "讲解步骤1",
                    "讲解步骤2",
                    "讲解步骤3"
                ],
                "animations": [
                    "Define Visual Layout: Split-Left Layout for code demonstration.",
                    "Code: def algorithm():\\n    pass",
                    "Action: Highlight code line.",
                    "Visual: Create data structure visualization."
                ]
            }
        ]
    }
    ```
    
    **❌ 常见错误（会导致解析失败）：**
    ```
    // 错误1：数组最后一个元素后面有逗号
    "lecture_lines": ["第一句", "第二句",]  // ❌ 最后的逗号是错的
    
    // 错误2：字符串内的引号没有转义
    "title": "说"你好""  // ❌ 应该写成 "说\\"你好\\""
    
    // 错误3：使用单引号
    'title': '标题'  // ❌ JSON 必须用双引号
    
    // 错误4：多余的逗号
    {
        "id": "section_1",
        "title": "标题",  // ❌ 这是最后一个字段，不应该有逗号
    }
    ```
    
    **注意**：
    - `estimated_duration` 是该节的预计时长（秒），必须为整数
    - 时长要综合考虑 lecture_lines 数量、animations 复杂度、以及观众理解所需时间
    - 所有章节时长之和应大致符合视频总时长要求
    - 请直接输出 JSON，不要用 ```json ``` 包裹
    - 注意：在 JSON 字符串内容中，严禁出现未经转义的双引号（"），如果需要引用，请一律使用单引号（'）或中文书名号（《》、「」）代替。
    """
    base_prompt += """

    # 中文教学分镜硬约束（必须进入 JSON）
    - 顶层必须增加 `teaching_schema_version`: `zh-cn-pedagogy-v2`。
    - sections 的 id 与大纲严格同序、同值，不得增删或重命名。
    - 每节必须增加 `layout_mode`，只能是 `no_code`、`with_code`、`full_code`。
    - `highlight_groups` 必须按自然语义分组：单行组完全合法，多行组也合法；不得为了减少音频段数强行合并无关内容。
    - `highlight_groups` 的每个成员必须是 `lecture_lines` 的整数下标，例如 `[[0], [1, 2], [3]]`；绝对不能把文字句子放进 `highlight_groups`。
    - 每个 highlight group 表达一个完整语义句。若一个组跨多行，中间行以中文逗号 `，` 收尾，最后一行以 `。`、`？` 或 `！` 收尾；不要让每一行都机械地以句号结束。
    - 左侧文字保持与现有版本接近的信息密度，不要退化为只有一两个词的标签，也不要加入口语语气词。
    - 每节必须增加 `highlight_groups`，按顺序恰好覆盖全部 lecture_lines；同组表示一次旁白同步高亮，可含多行，且不可跨页。
    - 每节必须增加 `evidence_lines_indices`、`zpd_check_line_index`、`bridge_line_index`、`new_terms_introduced`、`code_snippets`。
    - `zpd_check_line_index` 必须为 0；`bridge_line_index` 必须位于最后两行；依据行索引必须有效。
    - 首行先连接已有知识，末尾自然衔接下一概念；首次出现术语时立即用中文解释，不使用未解释的超纲术语。
    - 全片设置 2-4 个认知检查点：用旁白中的自然疑问语气让学生预测，再揭示答案；不得添加长时间无旁白停顿。
    - 复杂公式、递推式、状态表或复杂图示的阅读时间包含在对应旁白窗口内；旁白、当前高亮和右侧变化必须一一对应。
    - 每行最多 20 个中文字符（含标点、英文和数字）；20 字以内的完整短句不强拆。有代码每页最多 4 行，无代码最多 8 行。
    - `code_snippets` 使用原项目目标编程语言；有代码布局时不能为空，完整代码节可分页但不得省略逻辑。
    - 禁止无画面旁白、无讲解画面；新主元素出现前必须 FadeOut 并 remove 不再使用的旧元素，避免残留与重叠。
    - 分镜预计总秒数应接近大纲目标时长，允许误差 10%。
    """
    return base_prompt


def get_prompt_download_assets(storyboard_data):
    return f"""
分析这份教育视频分镜脚本，识别出最多 4 个**必须**使用下载图标/图片（而非手动绘制形状）来表示的关键视觉元素。

内容 (Content):
{storyboard_data}

选择标准 (Selection Criteria):
1. 仅选择出现在**介绍 (Introduction)** 或 **应用 (Application)** 章节中的元素，且必须满足：
   - 现实世界中可识别的物理对象
   - 视觉特征鲜明，仅用通用几何形状不足以表达
   - 具体的实物，而非抽象概念
2. 优先选择：具体的动物、角色、交通工具、工具、设备、地标、日常物品。
3. **忽略且绝不包含**：
   - 抽象概念（如：正义、交流）
   - 思想的符号或图标（如：字母、公式、图表、数据结构树）
   - 几何形状、箭头或数学相关的视觉元素
   - 任何完全由基本形状组成且无独特视觉身份的物体

输出格式 (Output format):
- **仅输出英文关键词**（为了适配搜索引擎），每个关键词占一行，全小写，无编号，无额外文本。
"""


def get_prompt_place_assets(asset_mapping, animations_structure):
    return f"""
你需要通过插入已下载的素材来增强动画描述。

可用素材列表 (Asset list):
{asset_mapping}

当前动画数据 (Current Animations Data):
{animations_structure}

指令 (Instructions):
- 对于每一个动画步骤，判断是否应该融入已下载的素材。
- 仅为需要的动画步骤选择最相关的一个素材。
- 以此格式插入素材的**抽象路径**：[Asset: XXX]。
- **仅限**在**第一个和最后一个**章节中使用素材。
- 保持结构不变：返回一个包含 section_index, section_id 和 enhanced animations 的 JSON 数组。
- 仅修改动画描述以包含素材引用。
- 不要修改 section_index 或 section_id。

仅返回增强后的动画数据，必须是有效的 JSON 数组格式：
"""
