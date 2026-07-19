from src.integration_payload import build_profile_text, request_data


def full_message() -> dict:
    return {
        "task_id": 42,
        "prompt": "二分搜索边界处理",
        "language": "PYTHON",
        "extra_info": "掌握左右边界模板",
        "learner_profile": {
            "age": 20,
            "gender": "MALE",
            "introduction": "会 Python 基础，但总是写错循环边界",
            "experience_points": 120,
            "total_checkins": 18,
            "streak_checkins": 5,
        },
        "learning_context": {
            "subject": "二分搜索",
            "target": "掌握左右边界模板",
            "language": "PYTHON",
            "total_stages": 7,
            "finished_stages": 2,
            "stage_total_tasks": 3,
            "stage_finished_tasks": 1,
            "pretest_total_problems": 10,
            "pretest_answered_problems": 10,
            "pretest_correct_problems": 4,
            "task_title": "左边界二分",
            "task_description": "理解循环不变量和收缩条件",
        },
    }


def test_request_data_maps_full_profile_for_video_pipeline(monkeypatch) -> None:
    monkeypatch.setenv("K2V_RENDER_PROFILE", "1080p30")
    result = request_data(full_message())

    assert result["knowledge_point"] == "二分搜索边界处理"
    assert result["age"] == 20
    assert result["gender"] == "男"
    assert result["language"] == "Python"
    assert result["learner_profile"]["experience_points"] == 120
    assert result["learning_context"]["pretest_correct_problems"] == 4
    assert "用户自我介绍：会 Python 基础，但总是写错循环边界" in result["extra_info"]
    assert "课前测表现：共 10 题，已答 10 题，答对 4 题" in result["extra_info"]
    assert "当前阶段进度：已完成 1/3 个任务" in result["extra_info"]


def test_profile_text_keeps_legacy_extra_info() -> None:
    text = build_profile_text(
        {
            "task_id": 1,
            "prompt": "所有权",
            "extra_info": "已有 C 语言基础",
        }
    )
    assert text == "当前学习目标：已有 C 语言基础"
