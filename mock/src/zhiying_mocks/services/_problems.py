from __future__ import annotations

ANSWERS = ("A", "B", "C", "D")


def make_problem(index: int, topic: str) -> dict:
    """Build a deterministic mock multiple-choice problem."""
    answer = ANSWERS[index % 4]
    correct_label = f"正确选项（{topic} 第 {index + 1} 题）"
    distractor = "干扰选项"
    choices = {
        "choice_a": correct_label if answer == "A" else f"{distractor} A",
        "choice_b": correct_label if answer == "B" else f"{distractor} B",
        "choice_c": correct_label if answer == "C" else f"{distractor} C",
        "choice_d": correct_label if answer == "D" else f"{distractor} D",
    }
    return {
        "content": f"[mock] 关于「{topic}」的第 {index + 1} 道选择题，请选择正确答案。",
        **choices,
        "answer": answer,
        "explanation": (
            f"答案是 {answer}，因为这是 mock 数据，正确选项即标记为「{correct_label}」。"
        ),
    }
