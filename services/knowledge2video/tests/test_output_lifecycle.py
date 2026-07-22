from pathlib import Path

from src.output_lifecycle import (
    LifecycleConfig,
    OutputJanitor,
    mark_task_active,
    mark_task_finished,
    schedule_failed_cleanup,
    schedule_success_cleanup,
    task_workspace,
)


def config(root: Path) -> LifecycleConfig:
    return LifecycleConfig(
        output_dir=root,
        success_delay_seconds=0,
        failure_retention_seconds=0,
        active_marker_stale_seconds=3600,
        janitor_interval_seconds=1,
        disk_warning_percent=100,
        disk_min_free_bytes=0,
        alert_cooldown_seconds=3600,
        alert_webhook_url="",
    )


def test_uploaded_files_are_verified_and_active_task_is_protected(tmp_path: Path) -> None:
    cfg = config(tmp_path)
    celery_id = "task-1"
    workspace = task_workspace(str(tmp_path), celery_id)
    intermediate = workspace / "outline.json"
    intermediate.write_text("{}", encoding="utf-8")
    video = tmp_path / "videos" / "video.mp4"
    metadata = tmp_path / "metadata" / "video.json"
    video.parent.mkdir(parents=True)
    metadata.parent.mkdir(parents=True)
    video.write_bytes(b"video")
    metadata.write_text("{}", encoding="utf-8")
    schedule_success_cleanup(
        cfg,
        business_task_id=7,
        celery_task_id=celery_id,
        video_path=video,
        metadata_path=metadata,
        bucket="content",
        object_key="knowledge-videos/7.mp4",
        expected_size=5,
    )
    janitor = OutputJanitor(
        cfg,
        object_head=lambda _bucket, _key: {"ContentLength": 5},
        service_name="test",
    )

    mark_task_active(str(tmp_path), celery_id)
    assert janitor.run_once()["skipped_active"] == 1
    assert video.exists()
    assert workspace.exists()

    mark_task_finished(str(tmp_path), celery_id, "SUCCESS")
    assert janitor.run_once()["deleted_manifests"] == 1
    assert not video.exists()
    assert not metadata.exists()
    assert not workspace.exists()


def test_size_mismatch_keeps_local_files(tmp_path: Path) -> None:
    cfg = config(tmp_path)
    video = tmp_path / "videos" / "video.mp4"
    metadata = tmp_path / "metadata" / "video.json"
    video.parent.mkdir(parents=True)
    metadata.parent.mkdir(parents=True)
    video.write_bytes(b"video")
    metadata.write_text("{}", encoding="utf-8")
    schedule_success_cleanup(
        cfg,
        business_task_id=8,
        celery_task_id="task-2",
        video_path=video,
        metadata_path=metadata,
        bucket="content",
        object_key="knowledge-videos/8.mp4",
        expected_size=5,
    )
    janitor = OutputJanitor(
        cfg,
        object_head=lambda _bucket, _key: {"ContentLength": 4},
        service_name="test",
    )

    assert janitor.run_once()["skipped_unverified"] == 1
    assert video.exists()
    assert metadata.exists()


def test_failed_workspace_is_removed_after_retention(tmp_path: Path) -> None:
    cfg = config(tmp_path)
    workspace = task_workspace(str(tmp_path), "task-3")
    (workspace / "failed.log").write_text("failure", encoding="utf-8")
    failed_video = tmp_path / "videos" / "failed.mp4"
    failed_video.parent.mkdir(parents=True)
    failed_video.write_bytes(b"partial")
    schedule_failed_cleanup(
        cfg,
        business_task_id=9,
        celery_task_id="task-3",
        files=[failed_video],
    )
    # A later failure callback may schedule the same task again without knowing
    # the filename. Existing cleanup targets must not be lost.
    schedule_failed_cleanup(cfg, business_task_id=9, celery_task_id="task-3")
    janitor = OutputJanitor(
        cfg,
        object_head=lambda _bucket, _key: {},
        service_name="test",
    )

    assert janitor.run_once()["deleted_manifests"] == 1
    assert not workspace.exists()
    assert not failed_video.exists()
