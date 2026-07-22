# 存储生命周期、备份与垃圾回收运维说明

本文说明视频输出卷清理、磁盘告警、PostgreSQL/MinIO 配套备份，以及无引用视频资源垃圾回收的当前实现和操作方式。

## 1. 视频输出卷生命周期

每个 Celery 视频任务现在使用独立目录：

```text
/outputs/tasks/<celery_task_id>/
```

Celery `task_prerun` 会在 `/outputs/lifecycle/active/` 创建活动标记，`task_postrun` 删除活动标记并写入结束状态。清理程序发现未过期的活动标记时不会删除对应任务目录。

成功流程：

1. bridge 从 `/outputs/videos` 读取最终视频。
2. 上传 MinIO。
3. 调用 S3 `HEAD`，确认远端对象大小与本地文件一致。
4. 后端成功写入 `FINISHED + object_key`。
5. 创建延迟清理清单。
6. 到达延迟时间后，janitor 再次执行 S3 `HEAD`。
7. 只有对象仍然存在且大小一致、任务也不活跃时，才删除本地最终视频、元数据和任务工作目录。

失败流程：

1. 后端写入 `FAILED`。
2. 创建失败清理清单。
3. 工作目录保留一段时间供排错。
4. 保留期到达且任务不活跃时删除任务目录。

主要配置：

| 变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `OUTPUT_SUCCESS_CLEANUP_DELAY_HOURS` | 6 | 成功上传后的本地副本延迟清理时间 |
| `OUTPUT_FAILED_RETENTION_HOURS` | 24 | 失败任务目录保留时间 |
| `OUTPUT_ACTIVE_MARKER_STALE_HOURS` | 16 | 活动标记最大有效时间，必须大于任务最长运行时间 |
| `OUTPUT_JANITOR_INTERVAL_SECONDS` | 300 | 本地清理扫描周期 |
| `OUTPUT_DISK_WARNING_PERCENT` | 85 | 输出卷使用率告警阈值 |
| `OUTPUT_DISK_MIN_FREE_GB` | 10 | 输出卷最小剩余空间告警阈值 |
| `OUTPUT_DISK_ALERT_COOLDOWN_SECONDS` | 3600 | 重复告警冷却时间 |
| `OUTPUT_DISK_ALERT_WEBHOOK_URL` | 空 | 可选的 JSON 告警 webhook |

达到磁盘阈值时，bridge 日志会输出以 `ALERT` 开头的结构化 JSON；配置 webhook 后还会向该地址发送同一份 JSON。

## 2. MinIO 上传确认

上传不再以 `upload_file()` 返回作为唯一成功条件。bridge 会立即调用：

```text
HEAD <bucket>/<object_key>
```

并比较：

```text
远端 ContentLength == 本地文件字节数
```

不一致时任务不会回调 `FINISHED`，也不会创建成功清理清单，因此本地文件会被保留。

## 3. 垃圾回收

知识视频和代码视频 bridge 会周期性执行垃圾回收：

1. 通过内部 API 向后端请求 GC 快照。
2. 后端只把已经处于 `FINISHED`/`FAILED`、超过宽限期，并且没有用户关联、也没有学习任务引用的资源列为候选。
3. bridge 请求后端再次复核候选并删除数据库主记录。
4. 数据库删除成功后，bridge 删除对应 MinIO 对象。
5. 如果对象删除失败，对象会成为无数据库引用的孤儿；后续的对象扫描会再次清理。
6. bridge 同时扫描各自前缀下超过宽限期、且不在任何数据库记录中的孤儿对象。

这种“先复核并删除数据库记录，再删除对象”的顺序优先保证业务不会留下指向不存在对象的有效数据库记录。对象删除暂时失败只会留下可再次清理的孤儿文件。

相关配置：

| 变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `STORAGE_GC_INTERVAL_SECONDS` | 3600 | GC 周期 |
| `STORAGE_GC_RECORD_GRACE_HOURS` | 24 | 无引用数据库记录的宽限期 |
| `STORAGE_GC_ORPHAN_GRACE_HOURS` | 24 | 无数据库引用对象的宽限期 |

GC 只处理 `knowledge-videos/` 和 `code-videos/` 前缀，不会扫描其他对象类型。

## 4. PostgreSQL 与 MinIO 配套备份

备份脚本：

```bash
sh scripts/backup-data.sh
```

默认输出到：

```text
backups/<UTC timestamp>/
├── manifest.json
├── SHA256SUMS
├── postgres/
│   └── database.dump
└── minio/
    └── <bucket objects>
```

默认会短暂停止后端、核心生成服务和两个视频 bridge，阻止备份窗口内产生新的数据库引用或 MinIO 上传。视频 Celery worker 可以继续渲染本地文件；bridge 恢复后会继续处理持久化消息和任务结果。

如果业务明确接受非静默在线备份，可设置：

```bash
QUIESCE_BACKUP=false sh scripts/backup-data.sh
```

但在线备份无法严格保证数据库 dump 和对象列表属于同一时刻，因此不建议作为主要灾备方式。

可以通过 `BACKUP_ROOT` 修改输出目录：

```bash
BACKUP_ROOT=/mnt/backup/zhiying sh scripts/backup-data.sh
```

## 5. 恢复

恢复会覆盖当前 PostgreSQL 数据库，并使用备份目录同步 MinIO 存储桶，因此必须提供显式确认：

```bash
RESTORE_CONFIRM=restore-postgres-and-minio \
  sh scripts/restore-data.sh backups/20260721T120000Z
```

恢复脚本会先验证 `SHA256SUMS`，然后停止写入服务、重建数据库、恢复 MinIO，最后重新启动服务。

执行恢复前仍应另外保存当前环境的临时快照，并确保备份中的 `manifest.json`、数据库 dump 和 MinIO 目录来自同一备份批次。

## 6. 监控建议

- 收集 bridge 容器日志中的 `ALERT`、`output janitor failed` 和 `storage garbage collection failed`。
- 对 `postgres-data`、`minio-data`、`knowledge-video-output`、`code-video-output` 分别设置宿主机容量告警。
- 定期检查备份的 `SHA256SUMS`，并在隔离环境执行恢复演练。
- 关注 `/outputs/lifecycle/cleanup` 中长期不消失的清单；这通常表示 S3 `HEAD` 失败或远端对象大小不一致。
- `OUTPUT_ACTIVE_MARKER_STALE_HOURS` 不得小于视频任务最大超时时间，否则极长任务可能被误判为陈旧任务。
