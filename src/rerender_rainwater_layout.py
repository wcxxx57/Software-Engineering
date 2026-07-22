import json
import shutil
import subprocess
import sys
import time
from functools import partial
from pathlib import Path

from finalize_trapping_rain_water import (
    PROBLEM_DESCRIPTION,
    SOLUTION_CODE,
    _latest_with_audio,
    _load_sections,
)
from prompts.user_profile import create_profile_from_text
from src.agent import RunConfig, TeachingVideoAgent
from src.gpt_request import request_gpt5_token


TARGETS = {
    "section_0_intro": "Section0IntroScene",
    "section_1": "Section1Scene",
    "section_2": "Section2Scene",
    "section_6": "Section6Scene",
}


def main() -> None:
    started = time.time()
    output_parent = Path("/app/src/CASES/API_gpt-5/88a1b127-fb1b-462e-9d73-e8ac51fdb87b")
    profile = create_profile_from_text("Economics and management student learning algorithms with basic Python.")
    cfg = RunConfig(
        api=partial(request_gpt5_token, max_retries=1),
        use_feedback=False,
        use_assets=False,
        duration=10,
        render_profile="4k30",
        preview_render_profile="1080p30",
        user_profile=profile,
        forced_difficulty_level="simple",
    )
    agent = TeachingVideoAgent(
        idx=0,
        folder=output_parent,
        cfg=cfg,
        problem_description=PROBLEM_DESCRIPTION,
        solution_code=SOLUTION_CODE,
    )
    agent.actual_render_profile = agent.preview_render_profile
    _load_sections(agent)

    output_dir = agent.output_dir
    statuses = {}
    for section in agent.sections:
        if section.id in TARGETS:
            continue
        existing = _latest_with_audio(output_dir, section.id)
        if not existing:
            raise FileNotFoundError(f"Missing reusable section video: {section.id}")
        agent.section_videos[section.id] = existing
        statuses[section.id] = "reuse"

    for section_id, scene_name in TARGETS.items():
        source = output_dir / f"{section_id}.py"
        render_root = output_dir / "layout_repair_render" / section_id
        remux_root = output_dir / "layout_repair_audio" / section_id
        if render_root.exists():
            shutil.rmtree(render_root)
        if remux_root.exists():
            shutil.rmtree(remux_root)
        render_root.mkdir(parents=True)
        remux_root.mkdir(parents=True)

        command = [
            sys.executable,
            "-m",
            "manim",
            "render",
            "-r",
            "1920,1080",
            "--fps",
            "30",
            "--media_dir",
            str(render_root),
            "--disable_caching",
            "-o",
            f"{section_id}_layout_repaired.mp4",
            source.name,
            scene_name,
        ]
        result = subprocess.run(command, cwd=output_dir, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr or result.stdout)
        candidates = sorted(render_root.rglob(f"{section_id}_layout_repaired.mp4"), key=lambda path: path.stat().st_mtime)
        if not candidates:
            raise FileNotFoundError(f"No render output for {section_id}")
        raw_video = candidates[-1]
        previous_video = Path(_latest_with_audio(output_dir, section_id))
        remuxed = remux_root / f"{section_id}_with_audio.mp4"
        mux = [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(raw_video),
            "-i", str(previous_video),
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-c:a", "copy", "-shortest", str(remuxed),
        ]
        subprocess.run(mux, check=True)
        agent.section_videos[section_id] = str(remuxed)
        statuses[section_id] = "layout_repaired"

    final_video = agent.merge_videos("接雨水_1080p30_layout_repaired.mp4")
    summary = {
        "final_video": final_video,
        "section_status": statuses,
        "actual_duration_seconds": agent.actual_duration_seconds,
        "media_metadata": agent.media_metadata,
        "elapsed_seconds": time.time() - started,
    }
    (output_dir / "layout_repair_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
