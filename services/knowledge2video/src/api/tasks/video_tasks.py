"""
视频生成 Celery 任务
"""

import sys
import os
import json
import time
import traceback
from functools import partial
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

import redis

# 添加项目根目录到 sys.path
current_dir = Path(__file__).resolve().parent
src_dir = current_dir.parent.parent  # code2video/src
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

from .celery_app import celery_app
from ..config import settings
from ..utils.file_utils import save_video_with_hash
from ..utils.sse import SyncTaskProgressCallback
from ...output_lifecycle import task_workspace


@celery_app.task(bind=True, name="src.api.tasks.video_tasks.generate_video_task")
def generate_video_task(
    self,
    request_data: Dict[str, Any],
    channel_name: str
) -> Dict[str, Any]:
    """
    视频生成 Celery 任务
    
    Args:
        request_data: 请求数据
        channel_name: Redis 发布频道名称
        
    Returns:
        任务结果
    """
    # 创建 Redis 客户端用于发布进度
    redis_client = redis.from_url(settings.redis_url)
    callback = SyncTaskProgressCallback(redis_client, channel_name)
    pipeline_started_at = time.time()
    pre_agent_stage_timings: Dict[str, Any] = {}
    
    result = {
        "success": False,
        "video_file": None,
        "error": None,
        "token_usage": None,
    }
    
    try:
        # 导入必要的模块（延迟导入，避免循环依赖）
        from src.agent import TeachingVideoAgent, RunConfig
        from src.gpt_request import (
            request_claude_token,
            request_gpt4o_token,
            request_gpt5_token,
            request_gpt5_logic_token,
            request_gemini_token,
            request_o4mini_token,
            request_gpt41_token,
        )
        from prompts.user_profile import (
            UserProfile,
            create_profile_from_text,
            parse_profile_with_ai_sync,
        )
        from src.utils import get_optimal_workers
        
        # 解析请求参数
        knowledge_point = request_data["knowledge_point"]
        age = request_data.get("age")
        gender = request_data.get("gender")
        language = request_data.get("language", "Python")
        duration = request_data.get("duration")
        render_profile = str(request_data.get("render_profile") or "4k30").strip().lower()
        difficulty = request_data.get("difficulty", "medium")
        # 规范化难度值（兼容枚举/大小写）
        if hasattr(difficulty, "value"):
            difficulty = difficulty.value
        difficulty = str(difficulty).lower()
        extra_info = request_data.get("extra_info", "")
        learner_profile = request_data.get("learner_profile") or {}
        learning_context = request_data.get("learning_context") or {}
        use_feedback = request_data.get("use_feedback", True)
        use_assets = request_data.get("use_assets", True)
        api_model = str(request_data.get("api_model") or settings.default_api).strip().lower()
        
        # 获取 API 函数（键名与 api_config.json 一致）
        api_mapping = {
            "claude": request_claude_token,
            "gpt4o": request_gpt4o_token,
            "gpt-4o": request_gpt4o_token,
            "gpt5": request_gpt5_token,
            "gpt-5": request_gpt5_token,
            "gpt-41": request_gpt41_token,
            "gpt41": request_gpt41_token,
            "gpt-o4mini": request_o4mini_token,
            "gpt-o4-mini": request_o4mini_token,
            "o4mini": request_o4mini_token,
            "gemini": request_gemini_token,
        }
        raw_api_func = api_mapping.get(api_model)
        if raw_api_func is None:
            raise ValueError(f"不支持的 api_model：{api_model}")
        api_func = partial(raw_api_func, max_retries=1)
        raw_logic_api_func = request_gpt5_logic_token if api_model in {"gpt5", "gpt-5"} else raw_api_func
        logic_api_func = partial(raw_logic_api_func, max_retries=1)
        
        # ========== 阶段 1: 解析用户画像 ==========
        task_id = callback.on_stage_start("parse_profile", "正在解析用户画像。")
        stage_started = time.time()
        
        try:
            # 难度映射（请求值 -> 中文等级）
            difficulty_level_map = {
                "simple": "入门",
                "medium": "中等",
                "hard": "进阶",
            }
            forced_difficulty_level = difficulty_level_map.get(difficulty, "中等")

            # 难度映射为自然语言描述
            difficulty_desc_map = {
                "simple": "内容难度偏简单入门",
                "medium": "内容难度为中等",
                "hard": "内容难度偏高级进阶",
            }
            difficulty_desc = difficulty_desc_map.get(difficulty, "内容难度为中等")
            
            # 构建用户画像文本
            profile_parts = []
            if age:
                profile_parts.append(f"我是{age}岁")
            if gender:
                profile_parts.append(f"性别{gender}")
            profile_parts.append(f"选择的编程语言是{language}")
            profile_parts.append(difficulty_desc)
            if extra_info:
                profile_parts.append(extra_info)
            
            profile_text = "，".join(profile_parts)
            
            user_profile = create_profile_from_text(profile_text)
            # 使用 AI 解析用户画像
            parsed_profile = parse_profile_with_ai_sync(profile_text, logic_api_func, max_retries=3)
            # 结构化 API 参数优先于 AI 推断；解析失败时也保留明确传入的语言和难度。
            parsed_profile = parsed_profile or user_profile.parsed_profile or {}
            parsed_profile.setdefault("user_summary", {})
            parsed_profile["user_summary"]["target_language"] = language
            parsed_profile["user_summary"]["difficulty_preference"] = forced_difficulty_level
            parsed_profile.setdefault("stage3_code_guidance", {})
            parsed_profile["stage3_code_guidance"]["code_language"] = language
            user_profile.update_with_parsed_profile(parsed_profile)
            
            callback.on_stage_finish(task_id, "用户画像解析成功。")
            pre_agent_stage_timings["parse_profile"] = {
                "started_at": stage_started,
                "ended_at": time.time(),
                "elapsed_seconds": time.time() - stage_started,
            }
        except Exception as e:
            callback.on_stage_failed(task_id, f"用户画像解析失败: {str(e)}")
            raise
        
        # ========== 阶段 2: 创建 Agent 并生成视频 ==========
        # 配置
        cfg = RunConfig(
            api=api_func,
            logic_api=logic_api_func,
            use_feedback=use_feedback,
            use_assets=use_assets,
            duration=duration,
            render_profile=render_profile,
            preview_render_profile="1080p30",
            user_profile=user_profile,
            forced_difficulty_level=forced_difficulty_level,
            max_code_token_length=50000,  # 提高 token 上限，避免分镜脚本被截断
            max_planning_token_length=16000,
            max_fix_bug_tries=3,
            max_regenerate_tries=3,
            max_feedback_gen_code_tries=1,
            max_mllm_fix_bugs_tries=1,
            max_repair_attempts=2,
            feedback_rounds=2,
            pipeline_budget_seconds=int(os.getenv("VIDEO_PIPELINE_BUDGET_SECONDS", "2400")),
            finalize_reserve_seconds=int(os.getenv("VIDEO_FINALIZE_RESERVE_SECONDS", "240")),
            pipeline_started_at=pipeline_started_at,
        )
        
        # 每个 API 任务使用独立目录，避免同一知识点的不同用户画像、难度、
        # 语言或时长请求复用彼此的中间缓存。
        request_id = str(self.request.id or channel_name).replace("/", "_")
        folder_path = task_workspace(settings.output_dir, request_id)
        folder_path.mkdir(parents=True, exist_ok=True)

        # 创建 Agent
        agent = TeachingVideoAgent(
            idx=0,
            knowledge_point=knowledge_point,
            folder=str(folder_path),
            cfg=cfg,
        )
        agent.stage_timings.update(pre_agent_stage_timings)
        
        # ========== 阶段 3: 生成大纲 ==========
        task_id = callback.on_stage_start("generate_outline", "正在生成教学大纲。")
        stage_started = time.time()
        try:
            agent.generate_outline()

            # 强制覆盖大纲中的 difficulty_level，确保与请求参数完全一致
            outline_file = Path(agent.output_dir) / "outline.json"
            if outline_file.exists():
                with open(outline_file, "r", encoding="utf-8") as f:
                    outline_data = json.load(f)
                outline_data["difficulty_level"] = forced_difficulty_level
                with open(outline_file, "w", encoding="utf-8") as f:
                    json.dump(outline_data, f, ensure_ascii=False, indent=2)

            callback.on_stage_finish(task_id, "教学大纲生成成功。")
            agent.record_stage_timing("generate_outline", stage_started)
        except Exception as e:
            callback.on_stage_failed(task_id, f"教学大纲生成失败: {str(e)}")
            raise
        
        # ========== 阶段 4: 生成分镜 ==========
        task_id = callback.on_stage_start("generate_storyboard", "正在生成分镜脚本。")
        stage_started = time.time()
        try:
            agent.generate_storyboard()
            callback.on_stage_finish(task_id, "分镜脚本生成成功。")
            agent.record_stage_timing("generate_storyboard", stage_started)
        except Exception as e:
            callback.on_stage_failed(task_id, f"分镜脚本生成失败: {str(e)}")
            raise
        
        # ========== 阶段 5: 注入封面 + 概述 ==========
        task_id = callback.on_stage_start("inject_cover_overview", "正在注入封面与课程导览。")
        stage_started = time.time()
        try:
            agent.inject_overview_section()
            agent.inject_cover_section()
            callback.on_stage_finish(task_id, "封面与课程导览注入成功。")
            agent.record_stage_timing("inject_cover_overview", stage_started)
        except Exception as e:
            callback.on_stage_failed(task_id, f"封面与课程导览注入失败: {str(e)}")
            raise
        
        # ========== 阶段 6: 章节代码与 1080p 基线流水线 ==========
        task_id = callback.on_stage_start(
            "generate_render_sections",
            "正在流水化生成章节代码与 1080p 视频；每节代码完成后立即开始渲染。",
        )
        stage_started = time.time()
        try:
            agent.generate_and_render_all_sections()
            callback.on_stage_finish(task_id, "全部章节代码与视频基线生成成功。")
            agent.record_stage_timing("generate_render_sections", stage_started)
        except Exception as e:
            callback.on_stage_failed(task_id, f"章节代码或视频基线生成失败: {str(e)}")
            raise
        
        # ========== 阶段 7: 合并视频 ==========
        task_id = callback.on_stage_start("merge_videos", "正在合并视频。")
        stage_started = time.time()
        try:
            final_video_path = agent.merge_videos()
            if not final_video_path:
                raise Exception("视频合并失败，未生成最终视频")
            callback.on_stage_finish(task_id, "视频合并成功。")
            agent.record_stage_timing("merge_videos", stage_started)
        except Exception as e:
            callback.on_stage_failed(task_id, f"视频合并失败: {str(e)}")
            raise
        
        # ========== 阶段 9: 保存视频 ==========
        task_id = callback.on_stage_start("save_video", "正在保存视频文件。")
        stage_started = time.time()
        try:
            # 准备元信息
            metadata = {
                "knowledge_point": knowledge_point,
                "language": language,
                "duration": agent.duration,
                "duration_source": agent.duration_source,
                "actual_duration_seconds": agent.actual_duration_seconds,
                "accepted_duration_seconds": [agent.duration * 60 * 0.85, agent.duration * 60 * 1.30],
                "actual_narration_seconds": agent.actual_narration_seconds,
                "delivery_status": "success_with_warnings" if agent.warnings else "success",
                "warnings": agent.warnings,
                "requested_render_profile": agent.requested_render_profile.name,
                "actual_render_profile": agent.actual_render_profile.name,
                "render_profile": agent.actual_render_profile.name,
                "retry_summary": agent.retry_summary,
                "pipeline_elapsed_seconds": time.time() - pipeline_started_at,
                "stage_timings": agent.stage_timings,
                "deadline_action": agent.deadline_action,
                "section_fallbacks": agent.section_fallbacks,
                "media": agent.media_metadata,
                "long_silence_count": None,
                "long_silence_checked": False,
                "auto_removed_silence_seconds": 0.0,
                "visual_quality": {
                    "preview_profile": agent.preview_render_profile.name,
                    "feedback_enabled": agent.use_feedback,
                    "max_repair_rounds": min(
                        agent.feedback_rounds,
                        int(os.getenv("K2V_PREDELIVERY_FEEDBACK_ROUNDS", "2")),
                    ),
                    "passed": all(
                        bool(section.get("passed"))
                        for section in agent.visual_quality_results.values()
                    ),
                    "all_sections_rendered": all(
                        bool(section.get("rendered"))
                        for section in agent.visual_quality_results.values()
                    ),
                    "sections": agent.visual_quality_results,
                },
                "difficulty": difficulty,
                "age": age,
                "gender": gender,
                "extra_info": extra_info,
                "learner_profile": learner_profile,
                "learning_context": learning_context,
                "api_model": api_model,
                "outline": agent.outline.__dict__ if agent.outline else None,
                "token_usage": agent.token_usage,
                "created_at": datetime.now().isoformat(),
            }
            
            # 保存视频并获取哈希文件名；可恢复的文件系统错误最多修复两次。
            save_error = None
            for save_attempt in range(1, agent.max_attempts + 1):
                agent.retry_summary["save_attempts"] = save_attempt
                try:
                    video_filename = save_video_with_hash(final_video_path, metadata)
                    break
                except Exception as exc:
                    save_error = exc
                    if save_attempt < agent.max_attempts:
                        print(f"⚠️ 保存视频第 {save_attempt}/{agent.max_attempts} 次失败，正在重试: {exc}")
            else:
                raise RuntimeError(f"保存视频在 {agent.max_attempts} 次尝试后仍失败: {save_error}")
            
            callback.on_stage_finish(task_id, "视频文件保存成功。")
            agent.record_stage_timing("save_video", stage_started)
            
            result["success"] = True
            result["video_file"] = video_filename
            result["token_usage"] = agent.token_usage
            result["duration"] = agent.duration
            result["duration_source"] = agent.duration_source
            result["actual_duration_seconds"] = agent.actual_duration_seconds
            result["actual_narration_seconds"] = agent.actual_narration_seconds
            result["delivery_status"] = "success_with_warnings" if agent.warnings else "success"
            result["warnings"] = agent.warnings
            result["requested_render_profile"] = agent.requested_render_profile.name
            result["actual_render_profile"] = agent.actual_render_profile.name
            result["render_profile"] = agent.actual_render_profile.name
            result["retry_summary"] = agent.retry_summary
            result["pipeline_elapsed_seconds"] = time.time() - pipeline_started_at
            result["stage_timings"] = agent.stage_timings
            result["deadline_action"] = agent.deadline_action
            result["section_fallbacks"] = agent.section_fallbacks
            result["media"] = agent.media_metadata
            result["visual_quality"] = metadata["visual_quality"]
            result["long_silence_count"] = None
            result["long_silence_checked"] = False
            result["auto_removed_silence_seconds"] = 0.0
            
        except Exception as e:
            callback.on_stage_failed(task_id, f"视频文件保存失败: {str(e)}")
            raise
        
        # ========== 发送最终结果 ==========
        callback.on_result("视频生成成功。", {
            "video_file": video_filename,
            "duration": agent.duration,
            "duration_source": agent.duration_source,
            "actual_duration_seconds": agent.actual_duration_seconds,
            "actual_narration_seconds": agent.actual_narration_seconds,
            "delivery_status": "success_with_warnings" if agent.warnings else "success",
            "warnings": agent.warnings,
            "requested_render_profile": agent.requested_render_profile.name,
            "actual_render_profile": agent.actual_render_profile.name,
            "render_profile": agent.actual_render_profile.name,
            "retry_summary": agent.retry_summary,
            "pipeline_elapsed_seconds": time.time() - pipeline_started_at,
            "stage_timings": agent.stage_timings,
            "deadline_action": agent.deadline_action,
            "section_fallbacks": agent.section_fallbacks,
            "media": agent.media_metadata,
            "visual_quality": metadata["visual_quality"],
            "long_silence_count": None,
            "long_silence_checked": False,
            "auto_removed_silence_seconds": 0.0,
            "token_usage": agent.token_usage,
        })
        
    except Exception as e:
        error_msg = f"视频生成失败: {str(e)}"
        result["error"] = error_msg
        result["traceback"] = traceback.format_exc()
        
        # 发送最终失败事件，并让 Celery 将任务标记为 FAILURE
        try:
            callback.on_final_failure(error_msg, {"error": str(e)})
        except Exception:
            # 即使 Redis 临时不可用，也必须继续抛出原异常，让 Celery 标记 FAILURE。
            pass
        raise
    
    finally:
        redis_client.close()
    
    return result
