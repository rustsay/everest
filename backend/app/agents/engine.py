import asyncio
from typing import Awaitable, Callable

from app.agents.checker import run_agent
from app.agents.judge import run_judge
from app.config import settings
from app.models.schemas import AgentVerdict, JudgeDecision

_TEMPERATURE_CONFIGS = [(1, 0.3), (2, 0.7), (3, 1.0)]

Emitter = Callable[[dict], Awaitable[None]]


async def check_task(
    task_id: int,
    ocr_text: str,
    image_bytes_list: list[bytes],
    emit: Emitter | None = None,
) -> tuple[list[AgentVerdict], JudgeDecision]:
    async def _emit(event: dict) -> None:
        if emit:
            await emit(event)

    await _emit({"event": "agents_started", "task_id": task_id})

    verdicts: list[AgentVerdict] = list(
        await asyncio.gather(
            *[
                run_agent(
                    agent_id=agent_id,
                    task_id=task_id,
                    ocr_text=ocr_text,
                    image_bytes_list=image_bytes_list,
                    temperature=temp,
                )
                for agent_id, temp in _TEMPERATURE_CONFIGS
            ]
        )
    )

    for v in verdicts:
        await _emit(
            {"event": "agent_done", "task_id": task_id, "agent_id": v.agent_id, "score": v.score}
        )

    judge = await run_judge(task_id=task_id, verdicts=verdicts)
    await _emit({"event": "judge_done", "task_id": task_id, "final_score": judge.final_score})

    return verdicts, judge
