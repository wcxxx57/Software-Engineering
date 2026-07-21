"""
请求和响应模型定义
"""

from enum import Enum
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
from datetime import datetime


class DifficultyLevel(str, Enum):
    """难度等级枚举"""
    SIMPLE = "simple"
    MEDIUM = "medium"
    HARD = "hard"


class RenderProfileName(str, Enum):
    """可选的原生渲染规格。"""

    HD_1080P30 = "1080p30"
    UHD_4K30 = "4k30"
    UHD_4K60 = "4k60"


class EventType(str, Enum):
    """SSE 事件类型"""
    RUNNING = "running"
    FINISHED = "finished"
    FAILED = "failed"
    RESULT = "result"


class VideoGenerateRequest(BaseModel):
    """视频生成请求模型"""
    
    # 必填字段：编程题目 + 标准答案代码
    problem_description: str = Field(
        ...,
        description="编程题目描述（包含题目名称、描述、示例、提示等）",
        examples=["给定一个排序数组和一个目标值，在数组中找到目标值并返回其索引。"]
    )
    solution_code: str = Field(
        ...,
        description="题目的标准答案代码（严禁修改，原封不动展示）",
        examples=["def binary_search(nums, target):\n    left, right = 0, len(nums) - 1\n    ..."]
    )
    
    # 结构化可选字段
    age: Optional[int] = Field(
        None, 
        ge=1, 
        le=120,
        description="用户年龄"
    )
    gender: Optional[str] = Field(
        None, 
        description="用户性别",
        examples=["男", "女"]
    )
    language: Optional[str] = Field(
        "Python", 
        description="编程语言",
        examples=["Python", "Java", "C++", "JavaScript"]
    )
    duration: Optional[int] = Field(
        None,
        ge=5,
        le=15,
        description="视频目标时长（分钟）；不传时由 AI 在 5-15 分钟内选择"
    )
    render_profile: RenderProfileName = Field(
        RenderProfileName.UHD_4K30,
        description="原生渲染规格，默认 3840x2160/30fps",
    )
    
    difficulty: Optional[DifficultyLevel] = Field(
        DifficultyLevel.MEDIUM,
        description="内容难度等级（simple/medium/hard）",
        examples=["simple", "medium", "hard"]
    )
    
    # 非结构化字段（自然语言描述）
    extra_info: Optional[str] = Field(
        None,
        description="额外的用户信息描述（自然语言）",
        examples=["目标是利用暑假成功入门Python,完成一个自己的小项目,目前已有的知识储备是Python的输入输出语法和最基础的函数的语法"]
    )
    
    # 高级配置（可选）
    use_feedback: Optional[bool] = Field(
        True,
        description="是否使用 MLLM 反馈优化"
    )
    use_assets: Optional[bool] = Field(
        True,
        description="是否使用外部素材"
    )
    api_model: Optional[str] = Field(
        None,
        description="指定使用的 LLM API 模型",
        examples=["claude", "gpt-4o", "gpt-5", "Gemini"]
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "problem_description": "给定一个排序数组和一个目标值，在数组中找到目标值并返回其索引。如果目标值不存在于数组中，返回它将会被按顺序插入的位置。\n\n示例 1：输入: nums = [1,3,5,6], target = 5 输出: 2",
                "solution_code": "def searchInsert(nums, target):\n    left, right = 0, len(nums) - 1\n    while left <= right:\n        mid = (left + right) // 2\n        if nums[mid] == target:\n            return mid\n        elif nums[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return left",
                "age": 20,
                "gender": "男",
                "language": "Python",
                "duration": None,
                "render_profile": "4k30",
                "difficulty": "medium",
                "extra_info": "我是大学生，有一定编程基础，想深入理解算法"
            }
        }


class SSEEvent(BaseModel):
    """SSE 事件模型"""
    
    task_id: str = Field(..., description="任务唯一标识（UUID）")
    message: str = Field(..., description="事件消息")
    data: Optional[Dict[str, Any]] = Field(None, description="附加数据")
    
    def to_sse(self, event_type: EventType) -> str:
        """转换为 SSE 格式字符串"""
        import json
        payload = {
            "task_id": self.task_id,
            "message": self.message,
        }
        if self.data:
            payload["data"] = self.data
        
        return f"event: {event_type.value}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


class SubTaskProgress(BaseModel):
    """子任务进度"""
    
    task_id: str = Field(..., description="子任务 ID")
    name: str = Field(..., description="子任务名称")
    status: EventType = Field(..., description="子任务状态")
    message: str = Field(..., description="状态消息")
    started_at: Optional[datetime] = Field(None, description="开始时间")
    finished_at: Optional[datetime] = Field(None, description="结束时间")


class TaskStatusResponse(BaseModel):
    """任务状态响应"""
    
    task_id: str = Field(..., description="主任务 ID")
    status: str = Field(..., description="任务状态", examples=["pending", "running", "success", "failed"])
    progress: List[SubTaskProgress] = Field(default_factory=list, description="子任务进度列表")
    result: Optional[Dict[str, Any]] = Field(None, description="任务结果")
    error: Optional[str] = Field(None, description="错误信息")
    created_at: Optional[datetime] = Field(None, description="创建时间")
    updated_at: Optional[datetime] = Field(None, description="更新时间")


class VideoGenerateResponse(BaseModel):
    """视频生成结果响应"""
    
    message: str = Field(..., description="结果消息")
    data: Dict[str, Any] = Field(..., description="结果数据")
    
    class Config:
        json_schema_extra = {
            "example": {
                "message": "视频生成成功。",
                "data": {
                    "video_file": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6.mp4",
                    "delivery_status": "success_with_warnings",
                    "warnings": [{"code": "render_profile_fallback", "message": "4K 未完整生成，已返回完整 1080p 视频"}],
                    "requested_render_profile": "4k30",
                    "actual_render_profile": "1080p30",
                    "long_silence_checked": False,
                    "outline": {
                        "topic": "二分搜索",
                        "sections": []
                    },
                    "duration_seconds": 180,
                    "token_usage": {
                        "prompt_tokens": 10000,
                        "completion_tokens": 5000,
                        "total_tokens": 15000
                    }
                }
            }
        }


class HealthResponse(BaseModel):
    """健康检查响应"""
    
    status: str = Field(..., description="服务状态")
    redis: str = Field(..., description="Redis 连接状态")
    workers: int = Field(..., description="可用 Worker 数量")
    version: str = Field(..., description="API 版本")
