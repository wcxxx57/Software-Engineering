"""Run the production profile parser and AI duration selector without rendering."""

from prompts.user_profile import parse_profile_with_ai_sync
from src.gpt_request import request_gpt5_logic_token
from src.pedagogy import select_duration_with_ai


TOPIC = "二分查找"
PROFILE_TEXT = (
    "选择的编程语言是Python，内容难度偏简单入门，"
    "我是经济管理专业学生，正在自学 Python，希望用它做数据分析和业务自动化，"
    "没有系统的计算机专业背景，但已经掌握 Python 列表、下标、if 条件和 while 循环。"
    "请结合按订单编号排序的电商订单表、"
    "按销售额排序的经营报表，以及快速定位目标记录等商科场景，帮助我理解二分查找。"
    "重点讲清楚数据必须有序的前提、left、right 和 mid 的变化过程、"
    "查找成功与查找失败，以及常见的边界错误。希望进行一次短时、聚焦的核心学习，"
    "不展开递归写法、复杂度证明和算法变体。"
)


def logic_api(prompt, max_tokens=12000):
    response, _ = request_gpt5_logic_token(prompt, max_tokens=max_tokens)
    return response


print("=" * 88)
print("Knowledge2Video 个性化时长规划演示（请求未传 duration）")
print(f"教学主题：{TOPIC}")
print("结构化难度：入门；编程语言：Python；用户画像：经济管理专业、已有 Python 基础")
print("=" * 88)

parsed_profile = parse_profile_with_ai_sync(PROFILE_TEXT, request_gpt5_logic_token)
parsed_profile.setdefault("user_summary", {})
parsed_profile["user_summary"]["target_language"] = "Python"
parsed_profile["user_summary"]["difficulty_preference"] = "入门"

duration, source = select_duration_with_ai(
    logic_api,
    topic=TOPIC,
    learner_profile=parsed_profile,
    minimum=5,
    maximum=12,
    fallback=8,
    problem_description=PROFILE_TEXT,
)

print(f"🎯 最终规划：{duration} 分钟；决策来源：{source}；请求中的 duration：null")
print("=" * 88)
