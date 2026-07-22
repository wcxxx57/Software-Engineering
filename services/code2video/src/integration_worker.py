"""RabbitMQ bridge from Zhiying's code-video contract to Code2Video."""

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
from src.api.tasks.celery_app import VIDEO_TASK_QUEUE
from src.api.tasks.video_tasks import generate_video_task
from src.integration_payload import request_data
from src.output_lifecycle import (
    LifecycleConfig,
    OutputJanitor,
    schedule_failed_cleanup,
    schedule_success_cleanup,
)

EXCHANGE = "zhiying.code_video"
QUEUE = "zhiying.code_video.generate"
ROUTING_KEY = "generate"


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


RABBITMQ_URL = required("RABBITMQ_URL")
BACKEND_BASE_URL = required("BACKEND_BASE_URL").rstrip("/")
BACKEND_API_KEY = required("CODE_VIDEO_API_KEY")
STORAGE_ENDPOINT = required("STORAGE_ENDPOINT")
STORAGE_ACCESS_KEY = required("STORAGE_ACCESS_KEY")
STORAGE_SECRET_KEY = required("STORAGE_SECRET_KEY")
STORAGE_REGION = os.getenv("STORAGE_REGION", "us-east-1")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "zhiying-content")
WORKER_PREFETCH = max(1, int(os.getenv("INTEGRATION_WORKER_PREFETCH", "1")))
RESULT_TIMEOUT = int(os.getenv("VIDEO_TASK_TIMEOUT_SECONDS", "43200")) + 300
CELERY_RESULT_BACKEND = required("CELERY_RESULT_BACKEND")
TASK_LOCK_TTL = RESULT_TIMEOUT + 3600
TERMINAL_KEY_TTL = max(TASK_LOCK_TTL, 24 * 3600)
task_store = redis.from_url(CELERY_RESULT_BACKEND)
LIFECYCLE = LifecycleConfig.from_env(settings.output_dir)
RESOURCE_PATH = "/internal/code-videos/gc"
OBJECT_PREFIX = "code-videos/"
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
    return f"zhiying-code-video-{task_id}"


def terminal_key(task_id: int) -> str:
    return f"zhiying:code-video:terminal:{task_id}"


def terminal_status(task_id: int) -> str | None:
    value = task_store.get(terminal_key(task_id))
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    status = str(value).strip().upper()
    return status if status in {"FINISHED", "FAILED"} else None


def mark_terminal(task_id: int, status: str) -> None:
    normalized = status.strip().upper()
    if normalized not in {"FINISHED", "FAILED"}:
        raise ValueError(f"invalid terminal code_video status: {status}")
    task_store.set(terminal_key(task_id), normalized, ex=TERMINAL_KEY_TTL)


def is_idempotent_terminal_callback_error(
    error: Exception,
    *,
    status: str,
    celery_state: str,
) -> bool:
    response = getattr(error, "response", None)
    expected_state = {"FAILED": "FAILURE", "FINISHED": "SUCCESS"}.get(status)
    return (
        response is not None
        and response.status_code == 400
        and expected_state is not None
        and celery_state == expected_state
    )


def backend_callback(task_id: int, status: str, object_key: str | None = None) -> None:
    payload: dict[str, Any] = {"status": status}
    if object_key is not None:
        payload["object_key"] = object_key
    response = requests.patch(
        f"{BACKEND_BASE_URL}/internal/code-videos/{task_id}",
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
    object_key = f"code-videos/{task_id}-{uuid.uuid4().hex}{suffix}"
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
    completed_status = terminal_status(task_id)
    if completed_status:
        print(
            f"code_video duplicate delivery acknowledged task_id={task_id} "
            f"terminal_status={completed_status}",
            flush=True,
        )
        return
    lock_key = f"zhiying:code-video:submitted:{task_id}"
    submitted = bool(task_store.set(lock_key, celery_id, nx=True, ex=TASK_LOCK_TTL))
    filename = ""
    try:
        if submitted:
            backend_callback(task_id, "GENERATING")
            async_result = generate_video_task.apply_async(
                args=[request_data(message), f"zhiying_code_video_{task_id}_{uuid.uuid4().hex}"],
                queue=VIDEO_TASK_QUEUE,
                task_id=celery_id,
            )
        else:
            async_result = generate_video_task.AsyncResult(celery_id)
            print(f"code_video task resumed task_id={task_id} celery_id={celery_id}", flush=True)
        result = async_result.get(timeout=RESULT_TIMEOUT, propagate=True)
        filename = str((result or {}).get("video_file") or "").strip()
        if not filename:
            raise RuntimeError("video task completed without video_file")
        object_key, video_path, expected_size = upload_video(task_id, filename)
        backend_callback(task_id, "FINISHED", object_key)
        mark_terminal(task_id, "FINISHED")
        try:
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
        except Exception as cleanup_error:
            print(
                f"code_video success cleanup scheduling failed task_id={task_id}: "
                f"{cleanup_error}",
                flush=True,
            )
        task_store.delete(lock_key)
        print(f"code_video task finished task_id={task_id} object_key={object_key}", flush=True)
    except Exception:
        task_store.delete(lock_key)
        raise


def _schedule_ack(
    connection: pika.BlockingConnection,
    channel: pika.channel.Channel,
    delivery_tag: int,
) -> None:
    def ack() -> None:
        if channel.is_open:
            channel.basic_ack(delivery_tag)

    connection.add_callback_threadsafe(ack)


def _schedule_nack(
    connection: pika.BlockingConnection,
    channel: pika.channel.Channel,
    delivery_tag: int,
) -> None:
    def nack() -> None:
        if channel.is_open:
            channel.basic_nack(delivery_tag, requeue=True)

    connection.add_callback_threadsafe(nack)


def process_delivery(
    connection: pika.BlockingConnection,
    channel: pika.channel.Channel,
    delivery_tag: int,
    body: bytes,
) -> None:
    task_id: int | None = None
    try:
        message = json.loads(body.decode("utf-8"))
        task_id = message.get("task_id") if isinstance(message, dict) else None
        handle(message)
        _schedule_ack(connection, channel, delivery_tag)
    except Exception as error:
        print(f"code_video task failed task_id={task_id}: {error}", flush=True)
        if not isinstance(task_id, int):
            _schedule_ack(connection, channel, delivery_tag)
            return

        celery_state = generate_video_task.AsyncResult(celery_task_id(task_id)).state
        try:
            backend_callback(task_id, "FAILED")
        except Exception as callback_error:
            if is_idempotent_terminal_callback_error(
                callback_error,
                status="FAILED",
                celery_state=celery_state,
            ):
                mark_terminal(task_id, "FAILED")
                print(
                    f"code_video duplicate failed callback treated as terminal "
                    f"task_id={task_id} celery_state={celery_state}",
                    flush=True,
                )
                _schedule_ack(connection, channel, delivery_tag)
                return
            print(
                f"code_video failure callback failed task_id={task_id}: {callback_error}",
                flush=True,
            )
            time.sleep(5)
            _schedule_nack(connection, channel, delivery_tag)
            return

        mark_terminal(task_id, "FAILED")
        try:
            schedule_failed_cleanup(
                LIFECYCLE,
                business_task_id=task_id,
                celery_task_id=celery_task_id(task_id),
            )
        except Exception as cleanup_error:
            print(
                f"code_video failure cleanup scheduling failed task_id={task_id}: "
                f"{cleanup_error}",
                flush=True,
            )
        _schedule_ack(connection, channel, delivery_tag)


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
    janitor = OutputJanitor(LIFECYCLE, object_head=_object_head, service_name="code2video")
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
        raise RuntimeError("CODE_VIDEO_API_KEY must start with sk-")
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
        threading.Thread(
            target=process_delivery,
            args=(connection, ch, method.delivery_tag, body),
            name=f"code-video-delivery-{method.delivery_tag}",
            daemon=True,
        ).start()

    channel.basic_consume(queue=QUEUE, on_message_callback=consume)
    print(f"Code2Video integration worker ready queue={QUEUE}", flush=True)
    channel.start_consuming()


if __name__ == "__main__":
    main()
