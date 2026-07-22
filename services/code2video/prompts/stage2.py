import json
from typing import Optional
from .user_profile import UserProfile, get_default_profile


def get_prompt2_storyboard(
    outline: str,
    solution_code: str,
    reference_image_path: Optional[str] = None,
    user_profile: Optional[UserProfile] = None
):
    """
    生成分镜脚本的提示词
    
    Args:
        outline: 大纲JSON字符串
        solution_code: 标准答案代码（用户提供，不可修改）
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
    你是一位**编程题目讲解视频的可视化导演**。请将大纲转化为详细的 Manim 动画脚本。

    ## 🔴🔴🔴 最重要的规则 🔴🔴🔴
    
    **标准答案代码是用户提供的权威代码，严禁修改、重写、简化或省略任何部分。必须原封不动地使用，一个字都不能改！**
    
    ## 标准答案代码（严禁修改，必须原封不动使用）
    ```{target_language.lower()}
{solution_code}
    ```

    {profile_prompt}

    # 通用视觉映射系统 (Universal Visual Mapping System)

    1.  **多维布局策略 (Layout Strategy)**:
        - **智能布局分流 (Smart Layout Branching)**:
          - **Case A: 纯理论/无代码 (No Code)** -> 保持现状：**左右对半布局**。左侧放讲解文字，右侧放可视化动画。适用于题目解读、思路分析、总结等章节。
          - **Case B: 代码演示场景 (With Code - DEFAULT for Code Walkthrough)** -> **采用 "左侧分割 + 右侧全屏" 布局 (Split-Left Layout)**:
            - **规则**: 凡是讲解代码具体步骤（代码精讲、示例模拟）的章节，**必须**使用此模式展示代码片段。
            - **左上区域 (Top-Left, ~30% height)**: 放置讲解文字 (Lecture Notes)。
            - **左下区域 (Bottom-Left, ~70% height)**: 放置 **{target_language}** 代码片段 (Code Snippet)。
            - **🔴 代码必须是用户提供的标准答案代码，严禁修改！**
            - **右侧区域 (Right Half, 100% height)**: 放置核心可视化/动画 (Main Visual)。
          - **Case C: 完整代码/纯代码 (Full Code - FINAL SECTION ONLY)**:
            - **规则**: 最后一个章节专门展示完整 **{target_language}** 源码。
            - **布局**: **隐藏左侧文字** (Lecture Notes opacity=0)，将代码对象放大并居中 (`scale(0.8).move_to(ORIGIN)`)。
            - **🔴 展示的必须是用户提供的完整标准答案代码，一个字都不能改！**
            - **分页**: 逐行测量代码块；任何页面接近安全区边界就提前分页，通常每页不超过 12 行。分页只能切连续行，不能改字、漏行、重复行，也不能靠无限缩小字体硬塞。

        - **强制分页规则 (Pagination Protocol)**:
            - **讲解文字逐行限制（硬性）**: 每行讲解文字不超过 **20个中文字符**（含标点、英文字母、数字）即可放一行；只有超过 20 字时才按语义拆分。**禁止把 20 字以内的完整短句强行拆成两行。**
            - **讲解文字分批规则（硬性，必须按顺序执行）**:
                1) **先判断是否有代码块**：
                        - 有代码块（左下有 `create_code_block`）→ 每批最多 **4行**
                        - 无代码块（纯讲解 + 右侧动画）→ 每批最多 **8行**
                2) **再按语义完整性分批（优先级高于行数上限）**：
                    - 一个知识点可跨多批（建议 2-4 批，按时长自适应）
                        - **不同知识点不能硬凑到同一批！**
                        - 严禁机械地每批凑满 4 行或 8 行
                3) **最后检查上限**：若超出 4/8 行，仅在该知识点内部按自然语义断点拆分，禁止跨知识点拼接凑行数。
        - **代码量控制**: 如果代码过长导致左下区域放不下，**必须**将内容拆分为连续的子场景。宁可多页，不可字小。
        - **State Monitor (底部/角落)**: 实时显示的变量值（Cost, Index, True/False）。
        - **Text Zoning Strategy (文本分区策略)**:
          - **Lecture Lines (教学文字，不是字幕)**: 放在固定左侧教学区，保持当前信息密度；不得显示逐句旁白，不得创建底部 Subtitle Bar、字幕文字或字幕背景框。
          - **Labels (标签)**: 跟随物体的标签必须简短（Max 2-3 words）。
          - **Title**: 每一节的标题固定在左上角或顶部，不可遮挡 Main Visual Area。

    2.  **编程题目讲解专用视觉映射**:
        - **题目展示**: 题目文本用卡片式布局展示，输入输出示例用表格或对比框展示
        - **暴力 vs 优化对比**: 用左右分栏或上下对比展示两种思路的差异
        - **代码高亮**: 讲解代码时，当前讲解的代码段必须高亮，其余部分降低透明度
        - **数据结构可视化**: DP表用网格/表格，数组用方块序列，指针用箭头
        - **执行追踪**: 示例模拟时，代码高亮行与右侧数据结构变化必须同步
        - **引用/指针**: 必须画成箭头 (Arrow)
        - **比较/判断**: 必须在屏幕上显示临时的数学不等式，判定后再消失
        - **记忆化/缓存/DP表**: 画成一个表格 (Table/Grid)，当前填充的格子高亮

    3.  **🔴 思路分析章节的分镜要求（最重要！）🔴**:
        - 思路分析是整个视频的核心，分镜必须**细致、连贯、不跳步**
        - **每一步推理都必须有对应的 lecture_line 和 animation**，不能省略中间步骤
        - **严禁跳跃**：不能直接说"所以我们用XX算法"，必须展示**思考过程**
        
        **分镜必须覆盖的"核心三问"：**
        1. **怎么想到的？** — 从题目特征出发的思考过程
           - 用动画高亮题目中的关键词/条件，展示"看到XX → 联想到XX方法"的推理链
           - 如果有暴力法，先用动画展示暴力法运行过程，再分析其瓶颈
           - 如果没有暴力法，直接从题目特征引导观众发现解题线索
        2. **具体怎么做？** — 算法流程的逐步可视化（🔴 每一步必须讲清"做什么+为什么" 🔴）
           - 用具体的示例数据，配合数组/表格/指针等动画，逐步演示算法流程
           - 🔴 **每一步都必须有 lecture_line 同时解释两件事：「这一步在做什么」+「为什么要这样做」**
             - ❌ 错误的 lecture_line："我们更新 dp[i][j] = dp[i+1][j-1] + 2" — 只说了做什么，没说为什么
             - ✅ 正确的 lecture_line："因为 s[i] 和 s[j] 相等，说明这两个字符可以包含在回文中，所以 dp[i][j] 的值就是去掉这两个字符后的回文长度 dp[i+1][j-1] 再加上 2"
             - ❌ 错误的 lecture_line："接下来移动右指针" — 只说了做什么
             - ✅ 正确的 lecture_line："当前窗口的和还小于目标值，说明窗口里的元素不够多，所以我们需要向右扩展窗口，移动右指针来纳入更多元素"
           - 🔴 **对于较难的算法（如DP、图论、单调栈、线段树等），分镜粒度必须更细**：
             - 每个状态转移/关键操作都必须拆成**独立的分镜步骤**，配独立的 lecture_line 和 animation
             - 不直观的技巧必须有"对比分镜"：先展示不用这个技巧的情况，再展示用了之后的改进
             - 复杂的转移方程不能一步到位展示，必须分步骤逐项构建，每加一项都解释其含义
           - 关键数据结构（DP表、栈、队列等）的变化必须用动画展示
           - **animation 必须与 lecture_line 的"为什么"部分配合**：当旁白解释原因时，动画应同步展示对应的视觉证据（如高亮相关元素、显示比较关系等）
        3. **为什么能解决？** — 正确性的直觉说明
           - 用动画展示为什么这种方法不会遗漏、为什么结果是对的
           - 可以用具体例子对比说明
        
        **分镜技巧：**
        - **先用例子带出概念**：先用动画跑一个具体例子，再总结抽象规律
        - **设置思考过程**：用一条完整旁白提出预测，再由下一语义组揭示答案；不得用长 `wait()` 制造无旁白停顿
        - **lecture_lines 要求**：每句旁白都必须承上启下，前因后果清晰。🔴 特别检查：每句涉及算法操作的旁白是否都包含了"为什么"的解释，如果没有，必须补充
        - **时长要求**：思路分析相关章节的 estimated_duration 之和应占总时长的 30%-40%
        - **难度自适应**：算法越难，分镜步骤越多、讲解越细致。简单算法（如简单遍历）可以适当精简，但复杂算法（如DP、图论）必须逐步展开，不能压缩

    4.  **脚本要求**:
        - 每一句旁白（Lecture Line）必须对应代码的解释
        - 每一个动画（Animation）必须对应数据的变化（Create, Transform, FadeOut）
        - `section_0_intro` 是 overview scene 之后的自然续接，不是整支视频的重新开场
        - `section_0_intro` 的前 1-2 句必须直接进入题目描述、输入输出、示例解释或直观现象，不能先寒暄
        - `section_0_intro` 的首句禁止使用“大家好……”“今天我们来看……”“这道题叫……”“这节课我们会分几部分……”这类开场
        - `section_0_intro` 禁止重复 overview 已经讲过的题目名、章节导览和讲解路线
        - **节奏控制**：根据用户画像中的动画节奏要求调整
        - **🔴 所有代码展示必须使用用户提供的标准答案代码原文，严禁修改！**

    4.  **时长规划 (Duration Planning)**:
        - 每个 section 必须包含 `estimated_duration` 字段，单位为**秒**
        - 时长估算规则：
          - 每句 lecture_line 约 3-5 秒（根据文字长度）
          - 每个复杂动画约 2-4 秒
          - 简单动画（FadeIn/FadeOut）约 0.5-1 秒
          - 代码展示页面需要额外 3-5 秒供观众阅读
        - 题目解读 (intro) 通常 30-60 秒
        - 代码精讲章节通常 60-120 秒
        - 示例模拟章节通常 60-120 秒
        - 代码展示章节通常 20-40 秒
        - **重要**：时长估算必须服从大纲目标总时长，不能刻意高估，也不能靠重复内容填充

    5.  **语言适配要求**:
        - 所有代码示例必须使用 **{target_language}**
        - 代码语法高亮应适配 {target_language} 语法
        - **🔴 代码内容必须与用户提供的标准答案完全一致！**

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
    
    **✅ 正确的 JSON 格式示例：**
    ```json
    {
        "sections": [
            {
                "id": "section_0_intro",
                "title": "题目解读",
                "estimated_duration": 45,
                "lecture_lines": [
                    "第一句旁白",
                    "第二句旁白"
                ],
                "animations": [
                    "Define Visual Layout: Left-Right Split.",
                    "Visual: FadeIn title at top.",
                    "Visual: Create problem description card."
                ]
            },
            {
                "id": "section_3",
                "title": "代码精讲",
                "estimated_duration": 90,
                "lecture_lines": [
                    "讲解代码第一段",
                    "讲解代码第二段",
                    "讲解代码第三段"
                ],
                "animations": [
                    "Define Visual Layout: Split-Left Layout for code demonstration.",
                    "Code: [展示用户提供的标准答案代码，严禁修改]",
                    "Action: Highlight code lines 1-5.",
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
    - **请直接输出 JSON，不要用 ```json ``` 包裹**
    - **🔴 所有 Code 动画指令中的代码必须是用户提供的标准答案代码原文，严禁修改！**
    """
    base_prompt += """

    # 中文教学分镜硬约束（必须进入 JSON）
    - 顶层必须增加 `teaching_schema_version`: `zh-cn-pedagogy-v2`。
    - sections 的 id 与大纲严格同序、同值，不得增删或重命名。
    - 每节必须增加 `layout_mode`，只能是 `no_code`、`with_code`、`full_code`。
    - 每节必须增加 `highlight_groups`，按顺序恰好覆盖全部 lecture_lines；同组表示一次旁白同步高亮，可含多行，且不可跨页。
    - 分组由语义决定，单行分组完全允许；多行分组的中间行通常用逗号衔接，最后一行使用句末标点，不要机械地让每个换行都以句号结束。
    - 每节必须增加 `evidence_lines_indices`、`zpd_check_line_index`、`bridge_line_index`、`new_terms_introduced`、`code_snippets`。
    - `zpd_check_line_index` 必须为 0；`bridge_line_index` 必须位于最后两行；依据行索引必须有效。
    - 首行先连接已有知识，末尾自然衔接下一概念；首次出现术语时立即用中文解释，不使用未解释的超纲术语。
    - 全片设置 2-4 个认知检查点：用完整旁白先让学生预测，再由下一组揭示答案；不得额外插入人工静音。
    - 复杂公式、递推式、状态表或复杂图示的阅读时间写进对应旁白；旁白、当前高亮和右侧变化必须一一对应。
    - 每行最多 20 个中文字符（含标点、英文和数字）；20 字以内的完整短句不强拆。有代码每页最多 4 行，无代码最多 8 行。
    - 有代码布局的 `code_snippets` 不能为空；其中每段代码必须是标准答案中的逐字连续片段。最后完整代码节必须逐字展示标准答案。
    - 禁止无画面旁白、无讲解画面；新主元素出现前必须 FadeOut 并 remove 不再使用的旧元素，避免残留与重叠。
    - `spoken_script` 仅用于 TTS，绝不能作为动画文字；不得输出逐句字幕、底部字幕框或 SRT。
    - 节点、数组和表格的背景形状使用较低 z_index，数字/标签使用更高 z_index，并在变换后重新确认层级。
    - 数量不同或标签不同的结构不得整组 `ReplacementTransform`；按元素映射，旧对象明确 remove，新对象的数字和标签单独保留。
    - 分镜预计总秒数应接近大纲目标时长，允许误差 10%。
    """
    return base_prompt


def get_prompt_download_assets(storyboard_data):
    return f"""
分析这份编程题目讲解视频分镜脚本，识别出最多 4 个**必须**使用下载图标/图片（而非手动绘制形状）来表示的关键视觉元素。

内容 (Content):
{storyboard_data}

选择标准 (Selection Criteria):
1. 仅选择出现在**介绍 (Introduction)** 或 **总结 (Summary)** 章节中的元素，且必须满足：
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
