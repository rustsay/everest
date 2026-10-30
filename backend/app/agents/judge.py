import json
import logging
import re
from collections import Counter

from json_repair import repair_json

from openai import AsyncOpenAI

from app.agents.prompts.tasks import TASK_CONFIGS
from app.config import settings
from app.models.schemas import AgentVerdict, JudgeDecision

log = logging.getLogger(__name__)

_SYSTEM = """Ты — старший эксперт ЕГЭ. Трое проверяющих независимо оценили одно решение.
Твоя задача — принять финальное справедливое решение.

Если двое или трое согласны — следуй большинству.
Если все трое дали разные баллы — проанализируй аргументы и выбери верный балл самостоятельно.

Отвечай ТОЛЬКО валидным JSON:
{
  "final_score": <целое число>,
  "reasoning": "<почему выбран именно этот балл>",
  "consensus_level": "full" | "majority" | "judge_decision"
}

ЗАПРЕЩЕНО использовать LaTeX-нотацию (\\frac, \\sqrt, \\cdot и т.д.) — пиши формулы простым текстом."""


def _try_consensus(verdicts: list[AgentVerdict]) -> tuple[int | None, str]:
    scores = [v.score for v in verdicts]
    if len(set(scores)) == 1:
        return scores[0], "full"
    top_score, top_count = Counter(scores).most_common(1)[0]
    if top_count >= 2:
        return top_score, "majority"
    return None, "judge_decision"


def _extract_json(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    candidate = m.group(0) if m else text
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    repaired = repair_json(candidate, return_objects=True)
    if isinstance(repaired, dict):
        return repaired
    raise ValueError(f"Нет JSON в ответе судьи: {text[:300]}")


async def run_judge(task_id: int, verdicts: list[AgentVerdict]) -> JudgeDecision:
    max_score = TASK_CONFIGS[task_id]["max_score"]
    agent_scores = [v.score for v in verdicts]

    log.info("judge task=%d agent_scores=%s", task_id, agent_scores)

    # Оптимизация: при консенсусе не тратим LLM-вызов
    score, level = _try_consensus(verdicts)
    if score is not None:
        log.info("judge task=%d consensus=%s final_score=%d", task_id, level, score)
        best = next(v for v in verdicts if v.score == score)
        return JudgeDecision(
            final_score=score,
            max_score=max_score,
            reasoning=f"Консенсус ({level}). {best.reasoning}",
            consensus_level=level,
            agent_scores=agent_scores,
        )

    # Все трое дали разные баллы — вызываем судью
    log.info("judge task=%d no consensus — calling LLM judge", task_id)
    client = AsyncOpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)
    verdicts_text = "\n\n".join(
        f"Эксперт {v.agent_id} → {v.score}/{max_score}:\n{v.reasoning}\n"
        f"Ошибки: {'; '.join(v.errors_found) or 'не найдены'}"
        for v in verdicts
    )

    response = await client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {
                "role": "user",
                "content": f"Задание {task_id}, максимум {max_score} баллов.\n\n{verdicts_text}",
            },
        ],
        temperature=settings.judge_temperature,
    )

    raw_text = response.choices[0].message.content or "{}"
    log.debug("judge task=%d raw_response=%s", task_id, raw_text[:500])
    raw = _extract_json(raw_text)
    final = min(max(int(raw.get("final_score", 0)), 0), max_score)
    log.info("judge task=%d LLM decision final_score=%d", task_id, final)
    return JudgeDecision(
        final_score=final,
        max_score=max_score,
        reasoning=str(raw.get("reasoning", "")),
        consensus_level="judge_decision",
        agent_scores=agent_scores,
    )
