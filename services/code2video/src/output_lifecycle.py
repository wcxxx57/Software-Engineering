"""Safe lifecycle management for the shared video output volume."""

from __future__ import annotations

import json
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import requests


def _hours(name: str, default: float) -> float:
    return max(0.0, float(os.getenv(name, str(default))))


def _seconds(name: str, default: int) -> int:
    return max(1, int(os.getenv(name, str(default))))


@dataclass(frozen=True)
class LifecycleConfig:
    output_dir: Path
    success_delay_seconds: int
    failure_retention_seconds: int
    active_marker_stale_seconds: int
    janitor_interval_seconds: int
    disk_warning_percent: float
    disk_min_free_bytes: int
    alert_cooldown_seconds: int
    alert_webhook_url: str

    @classmethod
    def from_env(cls, output_dir: str) -> "LifecycleConfig":
        return cls(
            output_dir=Path(output_dir).resolve(),
            success_delay_seconds=int(_hours("OUTPUT_SUCCESS_CLEANUP_DELAY_HOURS", 6) * 3600),
            failure_retention_seconds=int(_hours("OUTPUT_FAILED_RETENTION_HOURS", 24) * 3600),
            active_marker_stale_seconds=int(_hours("OUTPUT_ACTIVE_MARKER_STALE_HOURS", 16) * 3600),
            janitor_interval_seconds=_seconds("OUTPUT_JANITOR_INTERVAL_SECONDS", 300),
            disk_warning_percent=min(100.0, max(1.0, float(os.getenv("OUTPUT_DISK_WARNING_PERCENT", "85")))),
            disk_min_free_bytes=max(0, int(float(os.getenv("OUTPUT_DISK_MIN_FREE_GB", "10")) * 1024**3)),
            alert_cooldown_seconds=_seconds("OUTPUT_DISK_ALERT_COOLDOWN_SECONDS", 3600),
            alert_webhook_url=os.getenv("OUTPUT_DISK_ALERT_WEBHOOK_URL", "").strip(),
        )


def lifecycle_root(config: LifecycleConfig) -> Path:
    root = config.output_dir / "lifecycle"
    for child in ("active", "states", "cleanup"):
        (root / child).mkdir(parents=True, exist_ok=True)
    return root


def task_workspace(output_dir: str, celery_task_id: str) -> Path:
    path = Path(output_dir).resolve() / "tasks" / celery_task_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def mark_task_active(output_dir: str, celery_task_id: str) -> None:
    config = LifecycleConfig.from_env(output_dir)
    marker = lifecycle_root(config) / "active" / f"{celery_task_id}.json"
    _atomic_json(marker, {"task_id": celery_task_id, "started_at": time.time()})


def mark_task_finished(output_dir: str, celery_task_id: str, state: str) -> None:
    config = LifecycleConfig.from_env(output_dir)
    root = lifecycle_root(config)
    (root / "active" / f"{celery_task_id}.json").unlink(missing_ok=True)
    _atomic_json(
        root / "states" / f"{celery_task_id}.json",
        {"task_id": celery_task_id, "state": state, "finished_at": time.time()},
    )


def schedule_success_cleanup(
    config: LifecycleConfig,
    *,
    business_task_id: int,
    celery_task_id: str,
    video_path: Path,
    metadata_path: Path,
    bucket: str,
    object_key: str,
    expected_size: int,
) -> None:
    _schedule(
        config,
        business_task_id=business_task_id,
        celery_task_id=celery_task_id,
        status="uploaded",
        not_before=time.time() + config.success_delay_seconds,
        files=[video_path, metadata_path],
        bucket=bucket,
        object_key=object_key,
        expected_size=expected_size,
    )


def schedule_failed_cleanup(
    config: LifecycleConfig,
    *,
    business_task_id: int,
    celery_task_id: str,
    files: list[Path] | None = None,
) -> None:
    _schedule(
        config,
        business_task_id=business_task_id,
        celery_task_id=celery_task_id,
        status="failed",
        not_before=time.time() + config.failure_retention_seconds,
        files=files or [],
        bucket=None,
        object_key=None,
        expected_size=None,
    )


def _schedule(
    config: LifecycleConfig,
    *,
    business_task_id: int,
    celery_task_id: str,
    status: str,
    not_before: float,
    files: list[Path],
    bucket: str | None,
    object_key: str | None,
    expected_size: int | None,
) -> None:
    root = lifecycle_root(config)
    manifest_path = root / "cleanup" / f"{celery_task_id}.json"
    previous_files: list[str] = []
    if manifest_path.exists():
        try:
            previous_files = list(json.loads(manifest_path.read_text(encoding="utf-8")).get("files") or [])
        except Exception:
            previous_files = []
    manifest = {
        "business_task_id": business_task_id,
        "celery_task_id": celery_task_id,
        "status": status,
        "created_at": time.time(),
        "not_before": not_before,
        "task_dir": str(config.output_dir / "tasks" / celery_task_id),
        "files": sorted(set(previous_files + [str(path) for path in files])),
        "bucket": bucket,
        "object_key": object_key,
        "expected_size": expected_size,
    }
    _atomic_json(manifest_path, manifest)


class OutputJanitor:
    def __init__(
        self,
        config: LifecycleConfig,
        *,
        object_head: Callable[[str, str], dict[str, Any]],
        service_name: str,
    ) -> None:
        self.config = config
        self.object_head = object_head
        self.service_name = service_name
        self.last_alert_at = 0.0

    def run_once(self) -> dict[str, int]:
        root = lifecycle_root(self.config)
        stats = {"deleted_manifests": 0, "skipped_active": 0, "skipped_unverified": 0}
        now = time.time()
        self._check_disk(now)
        for manifest_path in sorted((root / "cleanup").glob("*.json")):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                if float(manifest.get("not_before", 0)) > now:
                    continue
                celery_task_id = str(manifest["celery_task_id"])
                if self._is_active(celery_task_id, now):
                    stats["skipped_active"] += 1
                    continue
                if manifest.get("status") == "uploaded" and not self._object_verified(manifest):
                    stats["skipped_unverified"] += 1
                    continue
                self._delete_manifest_targets(manifest)
                manifest_path.unlink(missing_ok=True)
                (root / "states" / f"{celery_task_id}.json").unlink(missing_ok=True)
                stats["deleted_manifests"] += 1
            except Exception as exc:
                print(f"output janitor manifest failed path={manifest_path}: {exc}", flush=True)
        return stats

    def _is_active(self, celery_task_id: str, now: float) -> bool:
        marker = lifecycle_root(self.config) / "active" / f"{celery_task_id}.json"
        if not marker.exists():
            return False
        age = now - marker.stat().st_mtime
        if age <= self.config.active_marker_stale_seconds:
            return True
        print(f"stale active marker ignored task_id={celery_task_id} age_seconds={int(age)}", flush=True)
        marker.unlink(missing_ok=True)
        return False

    def _object_verified(self, manifest: dict[str, Any]) -> bool:
        bucket = manifest.get("bucket")
        object_key = manifest.get("object_key")
        expected_size = manifest.get("expected_size")
        if not bucket or not object_key or expected_size is None:
            return False
        try:
            head = self.object_head(str(bucket), str(object_key))
            return int(head.get("ContentLength", -1)) == int(expected_size)
        except Exception as exc:
            print(f"object verification failed key={object_key}: {exc}", flush=True)
            return False

    def _delete_manifest_targets(self, manifest: dict[str, Any]) -> None:
        for raw in manifest.get("files") or []:
            path = Path(str(raw))
            if self._inside_output(path):
                path.unlink(missing_ok=True)
        task_dir = Path(str(manifest.get("task_dir") or ""))
        if task_dir.name and self._inside_output(task_dir) and task_dir.exists():
            shutil.rmtree(task_dir)

    def _inside_output(self, path: Path) -> bool:
        try:
            path.resolve().relative_to(self.config.output_dir)
            return path.resolve() != self.config.output_dir
        except ValueError:
            print(f"refusing unsafe cleanup path={path}", flush=True)
            return False

    def _check_disk(self, now: float) -> None:
        usage = shutil.disk_usage(self.config.output_dir)
        used_percent = (usage.used / usage.total * 100.0) if usage.total else 0.0
        warning = used_percent >= self.config.disk_warning_percent or usage.free <= self.config.disk_min_free_bytes
        if not warning or now - self.last_alert_at < self.config.alert_cooldown_seconds:
            return
        self.last_alert_at = now
        payload = {
            "event": "video_output_disk_warning",
            "service": self.service_name,
            "output_dir": str(self.config.output_dir),
            "used_percent": round(used_percent, 2),
            "free_bytes": usage.free,
            "total_bytes": usage.total,
        }
        print(f"ALERT {json.dumps(payload, ensure_ascii=False)}", flush=True)
        if self.config.alert_webhook_url:
            try:
                requests.post(self.config.alert_webhook_url, json=payload, timeout=10).raise_for_status()
            except Exception as exc:
                print(f"disk alert webhook failed: {exc}", flush=True)


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)
