import os

import requests


ENV_DEFAULTS = {
    "RABBITMQ_URL": "amqp://guest:guest@rabbitmq:5672/%2f",
    "BACKEND_BASE_URL": "http://backend:9000",
    "CODE_VIDEO_API_KEY": "sk-test-code-video",
    "STORAGE_ENDPOINT": "http://minio:9000",
    "STORAGE_ACCESS_KEY": "test-access",
    "STORAGE_SECRET_KEY": "test-secret",
    "CELERY_RESULT_BACKEND": "redis://redis:6379/1",
}
for name, value in ENV_DEFAULTS.items():
    os.environ.setdefault(name, value)

from src import integration_worker


class FakeStore:
    def __init__(self, values=None):
        self.values = dict(values or {})

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value, **_kwargs):
        self.values[key] = value
        return True

    def delete(self, key):
        self.values.pop(key, None)


class FakeConnection:
    def add_callback_threadsafe(self, callback):
        callback()


class FakeChannel:
    is_open = True

    def __init__(self):
        self.acked = []
        self.nacked = []

    def basic_ack(self, delivery_tag):
        self.acked.append(delivery_tag)

    def basic_nack(self, delivery_tag, requeue):
        self.nacked.append((delivery_tag, requeue))


def http_400_error():
    response = requests.Response()
    response.status_code = 400
    error = requests.HTTPError("bad request")
    error.response = response
    return error


def test_terminal_duplicate_skips_resubmission(monkeypatch):
    store = FakeStore({integration_worker.terminal_key(7): b"FAILED"})
    monkeypatch.setattr(integration_worker, "task_store", store)
    monkeypatch.setattr(
        integration_worker,
        "backend_callback",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("callback called")),
    )

    integration_worker.handle({"task_id": 7})


def test_failure_callback_conflict_is_idempotent_for_failed_celery_task():
    assert integration_worker.is_idempotent_terminal_callback_error(
        http_400_error(),
        status="FAILED",
        celery_state="FAILURE",
    )
    assert not integration_worker.is_idempotent_terminal_callback_error(
        http_400_error(),
        status="FAILED",
        celery_state="PENDING",
    )


def test_redelivered_failed_task_is_marked_terminal_and_acked(monkeypatch):
    store = FakeStore()
    channel = FakeChannel()
    monkeypatch.setattr(integration_worker, "task_store", store)
    monkeypatch.setattr(
        integration_worker,
        "handle",
        lambda _message: (_ for _ in ()).throw(RuntimeError("already failed")),
    )
    monkeypatch.setattr(
        integration_worker.generate_video_task,
        "AsyncResult",
        lambda _task_id: type("Result", (), {"state": "FAILURE"})(),
    )
    monkeypatch.setattr(
        integration_worker,
        "backend_callback",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(http_400_error()),
    )

    integration_worker.process_delivery(
        FakeConnection(),
        channel,
        12,
        b'{"task_id": 2}',
    )

    assert channel.acked == [12]
    assert channel.nacked == []
    assert store.get(integration_worker.terminal_key(2)) == "FAILED"
