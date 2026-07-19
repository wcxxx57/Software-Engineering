"""Submit a K2V request directly to Celery and print the task ID."""

import json
import sys
from pathlib import Path

from src.api.tasks.video_tasks import generate_video_task


def main() -> None:
    request_path = Path(sys.argv[1])
    channel_name = sys.argv[2] if len(sys.argv) > 2 else "manual_k2v"
    with request_path.open("r", encoding="utf-8") as file:
        request_data = json.load(file)
    task = generate_video_task.delay(request_data, channel_name)
    print(task.id)


if __name__ == "__main__":
    main()
