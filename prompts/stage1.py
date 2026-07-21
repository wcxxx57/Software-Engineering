from typing import Optional
from .user_profile import UserProfile, get_default_profile
from src.pedagogy import body_section_count_range


def get_prompt1_outline(
    problem_description: str,
    solution_code: str,
    duration: int,
    reference_image_path: Optional[str] = None,
    user_profile: Optional[UserProfile] = None,
    forced_difficulty_level: Optional[str] = None
):
    """
    生成编程题目代码讲解大纲的提示词
    
    Args:
        problem_description: 编程题目描述（包含题目名称、描述、示例、提示等）
        solution_code: 标准答案代码（用户提供，不可修改）
        duration: 视频时长（分钟）
        reference_image_path: 参考图片路径（可选）
        user_profile: 用户配置，可选，默认使用默认配置
    
    Returns:
        完整的提示词字符串
    """
    # 如果没有提供用户配置，使用默认配置
    if user_profile is None:
        user_profile = get_default_profile()
    min_sections, max_sections = body_section_count_range(duration)
    
    # 获取 AI 智能生成的用户画像提示词
    profile_prompt = user_profile.get_stage1_prompt()
    target_language = user_profile.get_language()
    
    difficulty_field_instruction = (
        forced_difficulty_level
        if forced_difficulty_level
        else "根据用户画像确定的难度级别"
    )

    force_difficulty_prompt = ""
    if forced_difficulty_level:
        force_difficulty_prompt = f"""
    ## 🔴 难度硬约束（必须严格遵守）
    - 本次请求指定难度：**{forced_difficulty_level}**
    - 输出 JSON 时，`difficulty_level` 字段必须且只能等于 **\"{forced_difficulty_level}\"**
    - 严禁根据用户画像、额外信息或模型偏好改写该值
    """
    
    base_prompt = f""" 
    你是一位**编程题目讲解专家**。你需要设计一个**编程题目代码答案讲解视频**的教学大纲。

    ## 🔴🔴🔴 最重要的规则 🔴🔴🔴
    
    **标准答案代码是用户提供的权威代码，严禁修改、重写、简化或省略任何部分。必须原封不动地使用，一个字都不能改！**
    
    ## 编程题目
    {problem_description}

    ## 标准答案代码（严禁修改，必须原封不动使用）
    ```
    {target_language.lower()}
    {solution_code}
    ```

    视频目标总时长：{duration} 分钟；各节预计时长合计应接近该目标，不得用重复内容凑时长。
    `sections` 必须为 {min_sections}-{max_sections} 个正文章节；封面和导览由系统另行生成，不计入这里。下面的教学环节可以在同一章节中合理组合，不得为了逐项对应而机械拆章。

    若用户画像明确来自非计算机学科，`topic` 优先采用“用用户熟悉的 X 理解 Y”结构，
    其中 X 是画像中的真实场景，Y 是本题核心算法或数据结构；不要写成空泛的“面向某专业学生”。
    
    {profile_prompt}
    {force_difficulty_prompt}
    
    # 核心教学结构（三段式讲解）

    你的大纲必须遵循以下三段式结构：

    ## 第一段：解题思路讲解
    在展示代码之前，必须先讲清楚解题思路：
    1. **题目解读**：展示题目原文，分析输入输出格式，用示例帮助理解题目要求
    2. **思路分析（🔴最重要🔴）**：回答"核心三问"——怎么想到这个思路的？具体怎么做？为什么能解决？**不跳步、不跳跃**，每一步推理都必须有前因后果，必须用具体例子辅助说明。
    3. **核心思想**：讲清楚标准答案所使用的算法/数据结构的核心思想（如DP状态定义、贪心策略、双指针原理等），**必须解释清楚"为什么这样做是对的"**

    ## 第二段：代码逐段讲解
    结合标准答案代码进行具体讲解：
    1. **代码精讲**：展示完整标准答案代码，逐段讲解每一部分的作用和对应的算法思想
    2. **示例模拟**：用题目中的示例数据完整走一遍代码执行过程，可视化关键数据结构的变化
    3. **易错点与边界**：讲解常见易错点、边界条件处理

    ## 第三段：总结归纳
    1. **复杂度分析**：时间和空间复杂度分析
    2. **总结与拓展**：总结这类题目/算法思想的通用解题模板，举一反三
    3. **完整代码回顾**：最后展示完整的标准答案代码，供观众暂停截图

    # 具体要求

    1.  **题目解读 (Problem Understanding - MANDATORY)**:
        - 第一个 section 的 id 必须是 section_0_intro
        - 必须展示题目原文，分析输入输出
        - 用题目中的示例帮助理解题意
        - `section_0_intro` 紧跟在 overview scene 之后，默认观众已经知道题目名称和讲解目录
        - 开头禁止使用“大家好”“今天我们来看”“这道题叫做……”这类重新开场的话术
        - 禁止重复 overview 已经讲过的题目名、章节导览、讲解路线
        - 要直接进入题目描述、输入输出、示例或直观现象的讲解
        - 可以用“先来看题目描述”“我们先用示例理解题意”这类自然过渡句式开头
        - **根据用户画像调整讲解深度**

    2.  **🔴 思路分析 (Solution Approach) — 这是全视频最重要的部分！🔴**:
        - **思路分析是重中之重**，必须讲得清楚、连贯、细致、易懂
        - **严禁跳步**：每一步推理都必须有明确的前因后果，不能突然跳到结论
        - **严禁跳跃**：不能直接说"所以我们用XX算法"，必须讲清楚**为什么想到用这个思路**
        
        **核心三问（每道题都必须回答）：**
        1. **怎么想到这个思路的？** — 从题目的哪些特征/条件出发，是什么线索启发我们选择这种方法？
           - 看到"最优"→ 联想到DP/贪心
           - 看到"有序"→ 联想到二分
           - 看到"连续子数组"→ 联想到滑动窗口/前缀和
           - 看到"所有可能"→ 联想到回溯/DFS
           - 或者从暴力法的瓶颈出发，发现可以优化的方向
           - **必须结合本题的具体条件来解释**，不能泛泛而谈
        
        2. **这个思路具体怎么做？** — 用通俗语言描述算法的完整流程
           - 把算法拆解为清晰的步骤，每步都用**具体例子**辅助说明
           - 🔴 **每一步都必须同时讲清两件事：「这一步在做什么」+「为什么要这样做」**，缺一不可
             - ❌ 错误示范："接下来我们遍历数组" — 只说了做什么，没说为什么
             - ✅ 正确示范："接下来我们遍历数组，因为我们需要逐个检查每个元素是否满足条件，这样才能找到所有符合要求的子数组"
           - 🔴 **对于较难的算法（如DP、图论、单调栈、线段树等），必须更加细致**：
             - 每个关键操作都要解释其背后的**直觉和动机**，不能只描述操作本身
             - 状态转移/更新的每一种情况都要单独解释"为什么这样转移是正确的"
             - 如果涉及不直观的技巧（如状态压缩、离散化、前缀和优化等），必须用具体例子展示"不用这个技巧会怎样 → 用了之后为什么更好"
             - 复杂算法的步骤拆分粒度要更细，宁可多拆几步讲清楚，也不要合并步骤导致跳跃
           - 关键数据结构（如DP表、栈、双指针等）的含义和用法，**必须解释"为什么选择这个数据结构而不是其他的"**
           - 状态如何定义（**为什么这样定义状态？这样定义有什么好处？**）、如何转移/更新（**每种转移对应什么实际含义？**）、何时终止（**为什么在这里终止是安全的？**）
           - **必须像给朋友讲题一样自然**，不要像背课本
        
        3. **为什么这个思路能解决问题？** — 正确性和效率的直觉解释
           - 为什么这种方法能覆盖所有情况、不会遗漏？
           - 为什么效率比暴力法更优？具体优化了哪一步？
           - 可以用反证、归纳或具体例子来说明
        
        **讲述技巧（参考优质教学视频的常见手法）：**
        - **先直觉后严谨**：先用生活类比或直觉解释，再补充严谨的算法描述
        - **用具体例子带抽象概念**：不要先讲抽象定义再举例，而是先用例子引导，再总结规律
        - **设置思考引导**：适时抛出"如果是你，你会怎么想？""注意到什么规律了吗？"等引导性问题
        - **可视化辅助**：关键步骤配合图解/表格/动画，而不是纯文字讲解
        - **如果题目有暴力思路**：可以先讲暴力法作为铺垫，分析其瓶颈后自然引出优化
        - **如果题目没有明显暴力思路**：直接从题目特征出发，讲解如何一步步构建解法
        
        - **节奏要求**：思路分析部分的时长应占视频总时长的 30%-40%，不能草草带过
        - **根据用户画像调整内容深度和讲解风格**

    3.  **代码精讲 (Code Walkthrough)**:
        - 🔴 **必须使用用户提供的标准答案代码，严禁修改任何一个字！**
        - 展示完整代码，逐段讲解
        - 每段代码配合对应的算法思想解释
        - 代码注释和讲解根据用户画像调整详细程度

    4.  **示例模拟 (Execution Trace)**:
        - 用题目示例数据完整走一遍代码
        - 可视化关键数据结构（数组、DP表、指针等）的变化过程
        - 列出所有核心变量的追踪清单

    5.  **代码展示要求**:
        - 所有代码必须使用 **{target_language}** 编写
        - 🔴 展示的代码必须与用户提供的标准答案代码完全一致，一个字都不能改
        - 代码风格和注释详细程度根据用户画像调整

    6.  **结尾结构要求 (Strict Ending Structure)**:
        - **倒数第二节 (Summary)**: 仅包含文字总结、复杂度分析、这类题目的通用解题模板。**禁止出现代码**。
        - **最后一节 (Full Source Code)**: 仅展示完整的标准答案代码（用户提供的原始代码）。**禁止出现大段讲解文字**。此部分专门用于让观众暂停截图或阅读完整逻辑。

    # 输出格式 (JSON)
    
    ## ⚠️⚠️⚠️ JSON 输出格式要求（必须严格遵守）⚠️⚠️⚠️
    
    **🚨 关键规则：**
    1. **只输出纯 JSON**，不要添加任何解释文字、markdown 标记或注释
    2. **字符串中的引号必须转义**：如果字符串内容包含双引号 `"`，必须写成 `\\"`
    3. **字符串中的换行必须转义**：使用 `\\n` 而不是实际换行
    4. **数组最后一个元素后不要加逗号**
    5. **所有字符串必须用双引号**，不能用单引号
    6. **确保 JSON 可以被 Python 的 json.loads() 正确解析**
    7. **请直接输出 JSON，不要用 ```json ``` 包裹**
    
    请严格按照以下格式输出：
    {{
        "topic": "题目名称 - 解法名称；跨学科画像优先写成‘用X理解Y’",
        "target_audience": "根据用户画像描述目标受众",
        "programming_language": "{target_language}",
        "difficulty_level": "{difficulty_field_instruction}",
        "problem_summary": "一句话概括题目要求",
        "solution_approach": "一句话概括标准答案的解题思路",
        "key_data_structures": ["列出标准答案中涉及的关键数据结构，如 'DP Table', 'Two Pointers', 'Hash Map'"],
        "trace_variables": ["列出示例模拟时需要追踪的核心变量"],
        "sections": [
            {{
                "id": "section_0_intro",
                "title": "题目解读",
                "content": "展示题目原文，分析输入输出格式，用示例帮助理解题意",
                "code_mapping": "None"
            }},
            {{
                "id": "section_1",
                "title": "思路分析 - 怎么想到这个解法",
                "content": "从题目特征出发，讲清楚为什么选择这种方法、具体怎么做、为什么能解决问题",
                "code_mapping": "None"
            }},
            {{
                "id": "section_2",
                "title": "核心思想",
                "content": "讲解标准答案所用算法的核心思想（状态定义、转移方程等）",
                "code_mapping": "Algorithm Core Concept"
            }},
            {{
                "id": "section_3",
                "title": "代码精讲",
                "content": "展示完整标准答案代码，逐段讲解每部分的作用",
                "code_mapping": "Full Code Walkthrough"
            }},
            {{
                "id": "section_4",
                "title": "示例模拟 - 代码执行追踪",
                "content": "用题目示例完整走一遍代码，可视化数据结构变化",
                "code_mapping": "Execution Trace with Example Data"
            }},
            {{
                "id": "section_5",
                "title": "易错点与边界分析",
                "content": "讲解常见易错点和边界条件处理",
                "code_mapping": "Edge Cases"
            }},
            {{
                "id": "section_6",
                "title": "复杂度分析与总结",
                "content": "复杂度分析，总结这类题目的通用解题模板",
                "code_mapping": "None"
            }},
            {{
                "id": "section_7",
                "title": "完整代码回顾",
                "content": "展示完整标准答案代码供观众暂停截图",
                "code_mapping": "Full Source Code Display"
            }}
        ]
    }}
    
    **❌ 常见错误（会导致解析失败）：**
    - 数组最后一个元素后面有逗号：`["a", "b",]` ❌
    - 字符串内的引号没有转义：`"说"你好""` ❌ 应该是 `"说\\"你好\\""`
    - 使用单引号：`'title'` ❌ JSON 必须用双引号
    - 对象最后一个字段后有逗号：`{{"id": "1",}}` ❌
    """
    
    base_prompt += f"""

    # 中文教学结构硬约束（必须进入 JSON）
    - `sections` 数量必须为 {min_sections}-{max_sections} 个；这是 {duration} 分钟视频的硬约束。下面 JSON 中列出的章节仅用于说明字段和教学环节，实际输出必须按本条合并或拆分，同时保留用户原始代码和核心教学内容。
    - 顶层必须增加 `teaching_schema_version`: `zh-cn-pedagogy-v2`。
    - 顶层必须增加 `factuality_anchor_checklist` 和 `scaffold_map`；`scaffold_map` 按 sections 顺序为每节给出 `section_id`、`prior_knowledge`、`target_concept`、`bridge_strategy`。
    - 每节只引入一个核心新概念，并增加：
      - `learning_objective`：本节可检查的学习目标；
      - `prior_knowledge_activation`：从学生已有知识自然起步；
      - `new_concept`：本节唯一核心新概念；
      - `misconception_check`：本节要预防的误区；
      - `bridge_to_next`：为什么下一节是自然的下一步；
      - `estimated_duration`：正整数秒；全片合计应接近 {duration * 60} 秒，允许误差 10%；
      - `evidence_basis`：非空数组，每项含 `claim`、`source_type`、`anchor`。
    - `source_type` 只能是：题目条件、标准答案代码、算法定义、不变量、执行追踪、复杂度推导、边界案例。
    - 题目条件与标准答案代码是最高依据；没有依据的结论必须删除，严禁猜测。
    - 标准答案代码仍须逐字保留，不得用教学优化为理由改写。
    """

    if reference_image_path:
        base_prompt += f"\n注：请参考提供的图片来决定数据结构的视觉风格（如树是画成圆圈还是方块）。\n"

    return base_prompt
