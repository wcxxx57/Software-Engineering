"""
Celery 应用配置
"""

from celery import Celery
from celery.signals import task_postrun, task_prerun

from ..config import settings
from ...output_lifecycle import mark_task_active, mark_task_finished

# 创建 Celery 应用
celery_app = Celery(
    "code2video",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["src.api.tasks.video_tasks"],
)

# Celery 配置
celery_app.conf.update(
    # 任务序列化
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    # 时区
    timezone="Asia/Shanghai",
    enable_utc=True,
    # 任务结果过期时间（秒）
    result_expires=86400,  # 24 小时
    # 任务确认
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # 并发控制
    worker_prefetch_multiplier=1,
    # 任务路由
    task_routes={
        "src.api.tasks.video_tasks.*": {"queue": "video_generation"},
    },
    # 任务时间限制
    task_time_limit=settings.task_time_limit_seconds,
    task_soft_time_limit=settings.task_soft_time_limit_seconds,
    # 结果后端配置
    result_backend_transport_options={
        "visibility_timeout": settings.task_time_limit_seconds,
    },
)

# 定义任务队列
celery_app.conf.task_queues = {
    "video_generation": {
        "exchange": "video_generation",
        "routing_key": "video_generation",
    },
}


@task_prerun.connect
def _mark_video_task_active(task_id=None, task=None, **_kwargs):
    if task_id and getattr(task, "name", "") == "src.api.tasks.video_tasks.generate_video_task":
        mark_task_active(settings.output_dir, str(task_id))


@task_postrun.connect
def _mark_video_task_finished(task_id=None, task=None, state=None, **_kwargs):
    if task_id and getattr(task, "name", "") == "src.api.tasks.video_tasks.generate_video_task":
        mark_task_finished(settings.output_dir, str(task_id), str(state or "UNKNOWN"))
