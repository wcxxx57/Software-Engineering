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
import time
import uuid
from pathlib import Path
from typing import Any

import boto3
import pika
import requests

from src.api.config import settings
from src.api.tasks.video_tasks import generate_video_task
from src.integration_payload import request_data

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


def upload_video(task_id: int, filename: str) -> str:
    path = Path(settings.video_dir) / filename
    if not path.is_file():
        raise FileNotFoundError(f"rendered video not found: {path}")
    suffix = path.suffix.lower() or ".mp4"
    object_key = f"knowledge-videos/{task_id}-{uuid.uuid4().hex}{suffix}"
    client = boto3.client(
        "s3",
        endpoint_url=STORAGE_ENDPOINT,
        aws_access_key_id=STORAGE_ACCESS_KEY,
        aws_secret_access_key=STORAGE_SECRET_KEY,
        region_name=STORAGE_REGION,
    )
    client.upload_file(
        str(path),
        STORAGE_BUCKET,
        object_key,
        ExtraArgs={"ContentType": "video/mp4"},
    )
    return object_key


def handle(message: dict[str, Any]) -> None:
    task_id = int(message["task_id"])
    backend_callback(task_id, "GENERATING")
    async_result = generate_video_task.apply_async(
        args=[request_data(message), f"zhiying_video_{task_id}_{uuid.uuid4().hex}"],
        queue="video_generation",
    )
    result = async_result.get(timeout=RESULT_TIMEOUT, propagate=True)
    filename = str((result or {}).get("video_file") or "").strip()
    if not filename:
        raise RuntimeError("video task completed without video_file")
    object_key = upload_video(task_id, filename)
    backend_callback(task_id, "FINISHED", object_key)
    print(
        f"knowledge_video task finished task_id={task_id} object_key={object_key}",
        flush=True,
    )


def main() -> None:
    if not BACKEND_API_KEY.startswith("sk-"):
        raise RuntimeError("KNOWLEDGE_VIDEO_API_KEY must start with sk-")
    parameters = pika.URLParameters(RABBITMQ_URL)
    parameters.heartbeat = 60
    parameters.blocked_connection_timeout = 300
    connection = pika.BlockingConnection(parameters)
    channel = connection.channel()
    channel.exchange_declare(exchange=EXCHANGE, exchange_type="direct", durable=True)
    channel.queue_declare(queue=QUEUE, durable=True)
    channel.queue_bind(queue=QUEUE, exchange=EXCHANGE, routing_key=ROUTING_KEY)
    channel.basic_qos(prefetch_count=WORKER_PREFETCH)

    def consume(
        ch: pika.channel.Channel, method: Any, _properties: Any, body: bytes
    ) -> None:
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
