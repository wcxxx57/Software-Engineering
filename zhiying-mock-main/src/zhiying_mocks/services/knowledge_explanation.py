from __future__ import annotations

from pydantic import BaseModel

from ..config import Settings
from . import ServiceSpec


class GenerateRequest(BaseModel):
    task_id: int
    prompt: str


def build_finished(req: BaseModel, settings: Settings) -> dict:
    assert isinstance(req, GenerateRequest)
    prompt = req.prompt or "未指定主题"
    content = (
        f"# {prompt}\n\n"
        "## 概述\n\n这是 mock 生成的知识讲解，用于本地联调。\n\n"
        "## 关键点\n\n- 第一点：核心概念\n- 第二点：常见用法\n- 第三点：易错场景\n\n"
        "## 小结\n\n以上即为本主题的 mock 讲解，仅用于打通端到端流程。\n"
    )
    return {"status": "FINISHED", "content": content}


SPEC = ServiceSpec(
    name="knowledge_explanation",
    exchange="zhiying.knowledge_explanation",
    queue="zhiying.knowledge_explanation.generate",
    routing_key="generate",
    callback_method="PATCH",
    callback_path_template="/internal/knowledge-explanations/{task_id}",
    api_key_attr="knowledge_explanation_api_key",
    request_model=GenerateRequest,
    build_finished_payload=build_finished,
)
