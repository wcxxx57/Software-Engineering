base_class = """
class TeachingScene(Scene):
    # 固定三分区：顶部标题、左侧讲解文字、右侧动画。没有底部字幕区。
    LEFT_X_MIN = -6.8
    LEFT_X_MAX = -0.35
    CONTENT_Y_MIN = -3.35
    CONTENT_Y_MAX = 2.75
    RIGHT_X_MIN = 0.35
    RIGHT_X_MAX = 6.8
    RIGHT_Y_MIN = CONTENT_Y_MIN
    RIGHT_Y_MAX = CONTENT_Y_MAX
    RIGHT_CENTER = np.array([3.575, -0.3, 0])
    RIGHT_MAX_WIDTH = 6.2
    RIGHT_MAX_HEIGHT = 5.9

    def _build_lecture_group(self, lecture_lines):
        lecture_texts = [Text(line, font="Noto Sans CJK SC", font_size=20, color="#2C1608") for line in lecture_lines]
        lecture_group = VGroup(*lecture_texts).arrange(DOWN, aligned_edge=LEFT, buff=0.3)
        if lecture_group.width > 6.2:
            lecture_group.scale_to_fit_width(6.2)
        if lecture_group.height > 5.9:
            raise ValueError("Left lecture page is too tall; paginate by complete highlight groups")
        return lecture_group

    def setup_layout(self, title_text, lecture_lines, lecture_line_indices=None):
        # BASE - 温暖配色方案
        self.camera.background_color = "#FFFDF4"  # 温暖米白色背景
        
        # 大标题 - 必须使用加粗 weight="BOLD"，颜色 #BE8944
        # 使用 Noto Sans CJK SC 字体（跨平台：Linux/Windows/macOS）
        self.title = Text(title_text, font="Noto Sans CJK SC", font_size=28, color="#BE8944", weight="BOLD").to_edge(UP)
        self.add(self.title)

        # 左侧只显示教学短句；spoken_script 与逐句字幕禁止进入画面。
        # ⚠️ 讲解文字从左上角开始，严禁Y轴居中
        self.lecture = self._build_lecture_group(lecture_lines)
        self.lecture.next_to(self.title, DOWN, buff=0.65).to_edge(LEFT, buff=0.3)
        self.add(self.lecture)
        self.lecture_anchor = self.lecture.get_corner(UL)
        self.current_lecture_line_indices = list(lecture_line_indices) if lecture_line_indices is not None else list(range(len(lecture_lines)))

        # Define fine-grained animation grid (6x6 grid on right side)
        self.grid = {}
        rows = ["A", "B", "C", "D", "E", "F"]  # Top to bottom
        cols = ["1", "2", "3", "4", "5", "6"]  # Left to right

        for i, row in enumerate(rows):
            for j, col in enumerate(cols):
                x = 0.6 + j * 1.05
                y = 2.25 - i * 1.05
                self.grid[f"{row}{col}"] = np.array([x, y, 0])

    def create_code_block(self, code_text, language="python"):
        \"\"\"
        创建标准化的浅色背景代码块
        直接复制以下代码，不要修改任何参数，否则会导致样式不一致！！！
        必须使用 tango 格式化风格，背景颜色必须是浅金色配色方案，且必须有边框。
        
        Args:
            code_text: 代码文本字符串
            language: 编程语言，默认 python
        
        Returns:
            Code 对象
        \"\"\"
        return Code(
            code_string=code_text,  # 使用 code_string 而不是 code
            language=language,
            background="rectangle",  # 🔴 必须有
            formatter_style="tango",  # 🔴 必须是 tango，不能是其他值
            background_config={  # 🔴 必须有，且必须是这个配色
                "fill_color": "#fff7e8",   # 浅金色背景
                "stroke_color": "#e4c8a6", # 金色边框
                "stroke_width": 2
            }
        )

    def place_at_grid(self, mobject, grid_pos, scale_factor=1.0):
        \"\"\"将元素放置到网格位置。\"\"\"
        mobject.scale(scale_factor)
        mobject.move_to(self.grid[grid_pos])
        self.fit_in_right_region(mobject)
        return mobject

    def fit_in_right_region(self, mobject):
        '''Fit a right-side visual into the fixed safe region without entering the text column.'''
        if mobject.width > self.RIGHT_MAX_WIDTH:
            mobject.scale_to_fit_width(self.RIGHT_MAX_WIDTH)
        if mobject.height > self.RIGHT_MAX_HEIGHT:
            mobject.scale_to_fit_height(self.RIGHT_MAX_HEIGHT)
        center = mobject.get_center()
        dx = 0
        dy = 0
        if mobject.get_left()[0] < self.RIGHT_X_MIN:
            dx = self.RIGHT_X_MIN - mobject.get_left()[0]
        elif mobject.get_right()[0] > self.RIGHT_X_MAX:
            dx = self.RIGHT_X_MAX - mobject.get_right()[0]
        if mobject.get_bottom()[1] < self.RIGHT_Y_MIN:
            dy = self.RIGHT_Y_MIN - mobject.get_bottom()[1]
        elif mobject.get_top()[1] > self.RIGHT_Y_MAX:
            dy = self.RIGHT_Y_MAX - mobject.get_top()[1]
        mobject.shift(np.array([dx, dy, 0]))
        return mobject

    def highlight_lecture_line(self, index, color):
        \"\"\"
        高亮当前正在讲解的某一行文字（变色），用于"讲到哪一行，哪一行变色"。
        
        Args:
            index: 讲解文字的行索引（从0开始）
            color: 高亮颜色，可根据语义自由选择配色表中的任意颜色
        
        Returns:
            动画对象，可传入 self.play()
        
        用法示例:
            self.play(self.highlight_lecture_line(0, "#C35101"))   # 第1行变为强调橙色
            self.play(self.highlight_lecture_line(0, "#478211"))   # 第1行变绿色
            self.play(self.highlight_lecture_line(1, "#1A7F99"))   # 第2行变蓝色
        \"\"\"
        if 0 <= index < len(self.lecture):
            return self.lecture[index].animate.set_color(color)
        return Wait(0)

    def unhighlight_lecture_line(self, index, color="#2C1608"):
        \"\"\"
        取消高亮，将讲解文字恢复为原始颜色。
        
        Args:
            index: 讲解文字的行索引（从0开始）
            color: 恢复的颜色，默认深棕色 #2C1608（原始文字颜色）
        
        Returns:
            动画对象，可传入 self.play()
        
        用法示例:
            self.play(self.unhighlight_lecture_line(0))  # 第1行恢复原色
        \"\"\"
        if 0 <= index < len(self.lecture):
            return self.lecture[index].animate.set_color(color)
        return Wait(0)

    def speak_and_highlight(self, index, color, wait_time=1.5):
        \"\"\"
        讲到某行文字时高亮变色，等待一段时间后自动恢复原色。
        一步完成"高亮 → 等待 → 恢复"的完整流程。
        
        Args:
            index: 讲解文字的行索引（从0开始）
            color: 高亮颜色，可根据语义自由选择配色表中的任意颜色
            wait_time: 高亮持续时间（秒），默认1.5秒
        
        用法示例:
            self.speak_and_highlight(0, "#C35101")              # 第1行用橙色高亮1.5秒后恢复
            self.speak_and_highlight(1, "#478211", wait_time=2)  # 第2行用绿色高亮2秒后恢复
            self.speak_and_highlight(2, "#1A7F99")              # 第3行用蓝色高亮
        \"\"\"
        if 0 <= index < len(self.lecture):
            self.play(self.lecture[index].animate.set_color(color))
            self.wait(wait_time)
            self.play(self.lecture[index].animate.set_color("#2C1608"))

    def play_synced_step(
        self,
        line_indices,
        audio_path,
        audio_duration,
        *animations,
        highlight_color="#C35101",
        reset_color="#2C1608",
        remove_at_start=None,
        show_at_start=None,
    ):
        \"\"\"
        V5.0 核心同步原语：
        - 使用 add_sound 播放音频
        - 在整个音频时长内保持左侧对应短句高亮
        - 允许右侧动画与音频并行运行

        Args:
            line_indices: 当前讲解文字的绝对索引，支持一个索引或多个索引
            audio_path: 音频绝对路径
            audio_duration: 音频真实物理时长（秒）
            *animations: 需要与音频并行执行的动画
            highlight_color: 高亮颜色
            reset_color: 恢复颜色
            remove_at_start: 本句旁白开始时立即移除的旧状态对象
            show_at_start: 本句旁白开始时立即显示的新状态对象

        `remove_at_start` / `show_at_start` 用于完整画面状态切换。它们在
        add_sound 之前同一帧完成，避免把 FadeIn/FadeOut 拉伸到整句旁白，
        从而造成新元素出现过晚、旧元素消失过晚或新旧状态长时间重叠。
        \"\"\"
        if isinstance(line_indices, int):
            line_indices = [line_indices]
        elif isinstance(line_indices, tuple):
            line_indices = list(line_indices)
        if not isinstance(line_indices, list) or not line_indices:
            raise ValueError("line_indices must be a non-empty int list")
        if audio_duration <= 0:
            raise ValueError(f"audio_duration must be positive, got {audio_duration}")

        displayed_indices = []
        for absolute_index in line_indices:
            displayed_indices.extend(
                index for index, value in enumerate(self.current_lecture_line_indices)
                if value == absolute_index and index not in displayed_indices
            )
        if not displayed_indices:
            raise IndexError(f"Lecture line indices are not on the current page: {line_indices}")
        for index in displayed_indices:
            self.lecture[index].set_color(highlight_color)

        old_objects = remove_at_start or []
        if not isinstance(old_objects, (list, tuple, set)):
            old_objects = [old_objects]
        new_objects = show_at_start or []
        if not isinstance(new_objects, (list, tuple, set)):
            new_objects = [new_objects]
        for obj in old_objects:
            self.remove(obj)
        for obj in new_objects:
            self.add(obj)

        self.add_sound(audio_path)

        if animations:
            self.play(*animations, run_time=audio_duration)
        else:
            self.wait(audio_duration)

        for index in displayed_indices:
            self.lecture[index].set_color(reset_color)

    def play_narrated_step(
        self,
        audio_path,
        audio_duration,
        *animations,
        remove_at_start=None,
        show_at_start=None,
    ):
        '''封面等无左侧讲解列表页面的音画同步原语。'''
        if audio_duration <= 0:
            raise ValueError(f"audio_duration must be positive, got {audio_duration}")
        old_objects = remove_at_start or []
        if not isinstance(old_objects, (list, tuple, set)):
            old_objects = [old_objects]
        new_objects = show_at_start or []
        if not isinstance(new_objects, (list, tuple, set)):
            new_objects = [new_objects]
        for obj in old_objects:
            self.remove(obj)
        for obj in new_objects:
            self.add(obj)
        self.add_sound(audio_path)
        if animations:
            self.play(*animations, run_time=audio_duration)
        else:
            self.wait(audio_duration)

    def replace_lecture_lines(self, lecture_lines, lecture_line_indices=None):
        \"\"\"
        将左侧讲解文字整体切换为新的一批，并保持左上锚点不变。
        用于 steps 数量较多时的分批显示。
        \"\"\"
        new_lecture = self._build_lecture_group(lecture_lines)
        new_lecture.align_to(self.lecture_anchor, UL)
        self.play(FadeOut(self.lecture), FadeIn(new_lecture), run_time=0.25)
        self.remove(self.lecture)
        self.lecture = new_lecture
        self.current_lecture_line_indices = list(lecture_line_indices) if lecture_line_indices is not None else list(range(len(lecture_lines)))

    def place_in_area(self, mobject, top_left, bottom_right, scale_factor=1.0):
        \"\"\"将元素放置到网格区域中心，并自动边界裁剪。\"\"\"
        tl_pos = self.grid[top_left]
        br_pos = self.grid[bottom_right]
        
        # Calculate center of the area
        center_x = (tl_pos[0] + br_pos[0]) / 2
        center_y = (tl_pos[1] + br_pos[1]) / 2
        center = np.array([center_x, center_y, 0])
        
        mobject.scale(scale_factor)
        mobject.move_to(center)
        self.fit_in_right_region(mobject)
        return mobject
"""
