"""RabbitMQ adapter for the Zhiying knowledge-video contract.

The original FastAPI/Celery/SSE application remains intact.  This process is
an additional deployment entry point that consumes the platform queue,
submits the existing Celery render task, uploads the finished MP4 to the
shared S3-compatible store, and updates the Rust backend through its existing
internal callback.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import boto3
import pika
import redis
import requests
from botocore.exceptions import ClientError

from src.api.config import settings
from src.api.tasks.video_tasks import generate_video_task
from src.integration_payload import request_data
from src.output_lifecycle import (
    LifecycleConfig,
    OutputJanitor,
    schedule_failed_cleanup,
    schedule_success_cleanup,
)

EXCHANGE = "zhiying.knowledge_video"
QUEUE = "zhiying.knowledge_video.generate"
ROUTING_KEY = "generate"


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


RABBITMQ_URL = required("RABBITMQ_URL")
BACKEND_BASE_URL = required("BACKEND_BASE_URL").rstrip("/")
BACKEND_API_KEY = required("KNOWLEDGE_VIDEO_API_KEY")
STORAGE_ENDPOINT = required("STORAGE_ENDPOINT")
STORAGE_ACCESS_KEY = required("STORAGE_ACCESS_KEY")
STORAGE_SECRET_KEY = required("STORAGE_SECRET_KEY")
STORAGE_REGION = os.getenv("STORAGE_REGION", "us-east-1")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "zhiying-content")
WORKER_PREFETCH = max(1, int(os.getenv("INTEGRATION_WORKER_PREFETCH", "1")))
RESULT_TIMEOUT = int(os.getenv("VIDEO_TASK_TIME_LIMIT_SECONDS", "43200")) + 300
CELERY_RESULT_BACKEND = required("CELERY_RESULT_BACKEND")
TASK_LOCK_TTL = RESULT_TIMEOUT + 3600
task_store = redis.from_url(CELERY_RESULT_BACKEND)
LIFECYCLE = LifecycleConfig.from_env(settings.output_dir)
RESOURCE_PATH = "/internal/knowledge-videos/gc"
OBJECT_PREFIX = "knowledge-videos/"
GC_INTERVAL_SECONDS = max(60, int(os.getenv("STORAGE_GC_INTERVAL_SECONDS", "3600")))
GC_RECORD_GRACE_SECONDS = max(3600, int(float(os.getenv("STORAGE_GC_RECORD_GRACE_HOURS", "24")) * 3600))
GC_ORPHAN_GRACE_SECONDS = max(3600, int(float(os.getenv("STORAGE_GC_ORPHAN_GRACE_HOURS", "24")) * 3600))


storage_client = boto3.client(
    "s3",
    endpoint_url=STORAGE_ENDPOINT,
    aws_access_key_id=STORAGE_ACCESS_KEY,
    aws_secret_access_key=STORAGE_SECRET_KEY,
    region_name=STORAGE_REGION,
)


def celery_task_id(task_id: int) -> str:
    return f"zhiying-knowledge-video-{task_id}"


def backend_callback(task_id: int, status: str, object_key: str | None = None) -> None:
    payload: dict[str, Any] = {"status": status}
    if object_key is not None:
        payload["object_key"] = object_key
    response = requests.patch(
        f"{BACKEND_BASE_URL}/internal/knowledge-videos/{task_id}",
        headers={"Authorization": f"Bearer {BACKEND_API_KEY}"},
        json=payload,
        timeout=30,
    )
    response.raise_for_status()


def upload_video(task_id: int, filename: str) -> tuple[str, Path, int]:
    path = Path(settings.video_dir) / filename
    if not path.is_file():
        raise FileNotFoundError(f"rendered video not found: {path}")
    suffix = path.suffix.lower() or ".mp4"
    object_key = f"knowledge-videos/{task_id}-{uuid.uuid4().hex}{suffix}"
    expected_size = path.stat().st_size
    storage_client.upload_file(
        str(path),
        STORAGE_BUCKET,
        object_key,
        ExtraArgs={"ContentType": "video/mp4"},
    )
    head = storage_client.head_object(Bucket=STORAGE_BUCKET, Key=object_key)
    if int(head.get("ContentLength", -1)) != expected_size:
        raise RuntimeError(
            f"uploaded object size mismatch key={object_key} local={expected_size} "
            f"remote={head.get('ContentLength')}"
        )
    return object_key, path, expected_size


def handle(message: dict[str, Any]) -> None:
    task_id = int(message["task_id"])
    celery_id = celery_task_id(task_id)
    lock_key = f"zhiying:knowledge-video:submitted:{task_id}"
    submitted = bool(task_store.set(lock_key, celery_id, nx=True, ex=TASK_LOCK_TTL))
    filename = ""
    try:
        if submitted:
            backend_callback(task_id, "GENERATING")
            async_result = generate_video_task.apply_async(
                args=[request_data(message), f"zhiying_video_{task_id}_{uuid.uuid4().hex}"],
                queue="video_generation",
                task_id=celery_id,
            )
        else:
            async_result = generate_video_task.AsyncResult(celery_id)
            print(
                f"knowledge_video task resumed task_id={task_id} celery_id={celery_id}",
                flush=True,
            )
        result = async_result.get(timeout=RESULT_TIMEOUT, propagate=True)
        filename = str((result or {}).get("video_file") or "").strip()
        if not filename:
            raise RuntimeError("video task completed without video_file")
        object_key, video_path, expected_size = upload_video(task_id, filename)
        backend_callback(task_id, "FINISHED", object_key)
        schedule_success_cleanup(
            LIFECYCLE,
            business_task_id=task_id,
            celery_task_id=celery_id,
            video_path=video_path,
            metadata_path=Path(settings.metadata_dir) / f"{video_path.stem}.json",
            bucket=STORAGE_BUCKET,
            object_key=object_key,
            expected_size=expected_size,
        )
        task_store.delete(lock_key)
        print(
            f"knowledge_video task finished task_id={task_id} object_key={object_key}",
            flush=True,
        )
    except Exception:
        failure_files: list[Path] = []
        if filename:
            video_path = Path(settings.video_dir) / filename
            failure_files.extend([video_path, Path(settings.metadata_dir) / f"{video_path.stem}.json"])
        schedule_failed_cleanup(
            LIFECYCLE,
            business_task_id=task_id,
            celery_task_id=celery_id,
            files=failure_files,
        )
        task_store.delete(lock_key)
        raise


def _object_head(bucket: str, object_key: str) -> dict[str, Any]:
    return storage_client.head_object(Bucket=bucket, Key=object_key)


def _delete_object_if_present(object_key: str) -> None:
    try:
        storage_client.head_object(Bucket=STORAGE_BUCKET, Key=object_key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return
        raise
    storage_client.delete_object(Bucket=STORAGE_BUCKET, Key=object_key)


def run_storage_gc() -> None:
    response = requests.get(
        f"{BACKEND_BASE_URL}{RESOURCE_PATH}",
        headers={"Authorization": f"Bearer {BACKEND_API_KEY}"},
        params={"grace_seconds": GC_RECORD_GRACE_SECONDS},
        timeout=30,
    )
    response.raise_for_status()
    snapshot = response.json().get("data", {})
    referenced = set(snapshot.get("referenced_object_keys") or [])

    for candidate in snapshot.get("candidates") or []:
        object_key = candidate.get("object_key")
        confirm = requests.post(
            f"{BACKEND_BASE_URL}{RESOURCE_PATH}/{int(candidate['id'])}/confirm",
            headers={"Authorization": f"Bearer {BACKEND_API_KEY}"},
            json={"object_key": object_key},
            timeout=30,
        )
        confirm.raise_for_status()
        if object_key:
            _delete_object_if_present(str(object_key))
            referenced.discard(str(object_key))

    cutoff = time.time() - GC_ORPHAN_GRACE_SECONDS
    paginator = storage_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=STORAGE_BUCKET, Prefix=OBJECT_PREFIX):
        for item in page.get("Contents") or []:
            key = str(item["Key"])
            modified = item["LastModified"].timestamp()
            if key not in referenced and modified <= cutoff:
                storage_client.delete_object(Bucket=STORAGE_BUCKET, Key=key)
                print(f"deleted orphan storage object key={key}", flush=True)


def maintenance_loop() -> None:
    janitor = OutputJanitor(LIFECYCLE, object_head=_object_head, service_name="knowledge2video")
    next_gc = 0.0
    while True:
        try:
            stats = janitor.run_once()
            if stats["deleted_manifests"]:
                print(f"output janitor stats={stats}", flush=True)
        except Exception as exc:
            print(f"output janitor failed: {exc}", flush=True)
        if time.time() >= next_gc:
            try:
                run_storage_gc()
            except Exception as exc:
                print(f"storage garbage collection failed: {exc}", flush=True)
            next_gc = time.time() + GC_INTERVAL_SECONDS
        time.sleep(LIFECYCLE.janitor_interval_seconds)


def main() -> None:
    if not BACKEND_API_KEY.startswith("sk-"):
        raise RuntimeError("KNOWLEDGE_VIDEO_API_KEY must start with sk-")
    threading.Thread(target=maintenance_loop, name="output-maintenance", daemon=True).start()
    parameters = pika.URLParameters(RABBITMQ_URL)
    parameters.heartbeat = 60
    parameters.blocked_connection_timeout = 300
    connection = pika.BlockingConnection(parameters)
    channel = connection.channel()
    channel.exchange_declare(exchange=EXCHANGE, exchange_type="direct", durable=True)
    channel.queue_declare(queue=QUEUE, durable=True)
    channel.queue_bind(queue=QUEUE, exchange=EXCHANGE, routing_key=ROUTING_KEY)
    channel.basic_qos(prefetch_count=WORKER_PREFETCH)

    def consume(ch: pika.channel.Channel, method: Any, _properties: Any, body: bytes) -> None:
        task_id: int | None = None
        try:
            message = json.loads(body.decode("utf-8"))
            task_id = message.get("task_id") if isinstance(message, dict) else None
            handle(message)
            ch.basic_ack(method.delivery_tag)
        except Exception as error:
            print(f"knowledge_video task failed task_id={task_id}: {error}", flush=True)
            if isinstance(task_id, int):
                try:
                    backend_callback(task_id, "FAILED")
                    schedule_failed_cleanup(
                        LIFECYCLE,
                        business_task_id=task_id,
                        celery_task_id=celery_task_id(task_id),
                    )
                except Exception as callback_error:
                    print(
                        f"knowledge_video failure callback failed task_id={task_id}: {callback_error}",
                        flush=True,
                    )
                    ch.basic_nack(method.delivery_tag, requeue=True)
                    time.sleep(5)
                    return
            ch.basic_ack(method.delivery_tag)

    channel.basic_consume(queue=QUEUE, on_message_callback=consume)
    print(f"Knowledge2Video integration worker ready queue={QUEUE}", flush=True)
    channel.start_consuming()


if __name__ == "__main__":
    main()
