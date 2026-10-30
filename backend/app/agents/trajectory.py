"""Generate a personalized learning trajectory based on session results."""
from __future__ import annotations

import json
import logging
from datetime import date, datetime

from json_repair import repair_json
from openai import AsyncOpenAI

from app.agents.prompts.tasks import TASK_CONFIGS
from app.config import settings

log = logging.getLogger(__name__)

EXAM_DATE = date(datetime.now().year, 6, 5)  # профильная математика ~5 июня


def _days_until_exam() -> int:
    delta = (EXAM_DATE - date.today()).days
    return max(delta, 1)


def _weeks_until_exam() -> int:
    return max(1, round(_days_until_exam() / 7))


_SYSTEM = """Ты — опытный репетитор по математике ЕГЭ профильного уровня.
Твоя задача — на основе результатов проверки работы ученика составить персональный план подготовки.

Правила:
1. Анализируй конкретные ошибки, указанные экспертами, а не пиши общие фразы.
2. Распредели время реалистично с учётом оставшихся дней.
3. Для каждого слабого задания сгенерируй 3 практических задания (оригинальных, не из демоварианта).
4. Задания для практики пиши конкретно и полностью, с решением.
5. Пиши формулы простым текстом: дроби через /, степень через ^, корень как sqrt().
6. Отвечай ТОЛЬКО валидным JSON — никаких LaTeX, никакого markdown вне JSON."""

_SCHEMA_HINT = """{
  "overall_analysis": "общий анализ работы ученика (3-5 предложений)",
  "current_score": <число, сумма баллов>,
  "days_until_exam": <число>,
  "strong_topics": ["тема1", ...],
  "weak_topics": ["тема1", ...],
  "week_plans": [
    {
      "week_label": "12-18 мая",
      "focus_tasks": [14, 18],
      "hours_per_day": 2.5,
      "goals": ["цель1", "цель2"]
    }
  ],
  "task_plans": [
    {
      "task_id": 14,
      "topic": "Стереометрия",
      "current_score": 0,
      "max_score": 3,
      "target_score": 3,
      "priority": "высокий",
      "weak_aspects": ["построение сечений", "нахождение углов"],
      "recommended_hours": 8,
      "key_theory": ["теорема о трёх перпендикулярах", "..."],
      "practice_problems": [
        {
          "problem": "полный текст задания",
          "hint": "подсказка",
          "solution": "подробное решение"
        }
      ]
    }
  ]
}"""


def _build_results_summary(task_rows: list) -> str:
    lines = []
    for tid, cfg in sorted(TASK_CONFIGS.items()):
        row = next((r for r in task_rows if r.task_id == tid), None)
        if not row or row.status != "done" or not row.judge_decision:
            lines.append(f"Задание {tid} ({cfg['topic']}, макс {cfg['max_score']}): НЕ ПРОВЕРЕНО")
            continue
        j = row.judge_decision
        score = j.get("final_score", 0)
        verdict_text = j.get("reasoning", "")[:400]
        errors = []
        if row.agent_verdicts:
            for v in row.agent_verdicts:
                errors.extend(v.get("errors_found", []))
        unique_errors = list(dict.fromkeys(errors))[:6]
        lines.append(
            f"Задание {tid} ({cfg['topic']}, макс {cfg['max_score']}): "
            f"{score}/{cfg['max_score']} баллов\n"
            f"  Вердикт: {verdict_text}\n"
            f"  Ошибки: {'; '.join(unique_errors) if unique_errors else 'не найдены'}"
        )
    return "\n\n".join(lines)


async def generate_trajectory(task_rows: list) -> dict:
    days = _days_until_exam()
    weeks = _weeks_until_exam()
    today_str = date.today().strftime("%d.%m.%Y")
    exam_str = EXAM_DATE.strftime("%d.%m.%Y")
    results_summary = _build_results_summary(task_rows)

    current_total = sum(
        r.judge_decision.get("final_score", 0)
        for r in task_rows
        if r.status == "done" and r.judge_decision
    )
    max_total = sum(cfg["max_score"] for cfg in TASK_CONFIGS.values())

    user_prompt = f"""Сегодня {today_str}. До экзамена ({exam_str}) осталось {days} дней ({weeks} недель).

Текущий результат ученика: {current_total}/{max_total} баллов.

=== РЕЗУЛЬТАТЫ ПРОВЕРКИ ===
{results_summary}

=== ТВОЯ ЗАДАЧА ===
Составь персональный план подготовки. Распредели {days} дней на {weeks} недели.
Для заданий с неполным баллом сгенерируй 3 практических задания.
Для заданий с полным баллом достаточно 1 задания для поддержания навыка.

Верни JSON строго по схеме:
{_SCHEMA_HINT}"""

    log.info("trajectory: generating for %d tasks, days_left=%d", len(task_rows), days)
    client = AsyncOpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)
    response = await client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
    )

    raw = response.choices[0].message.content or "{}"
    log.debug("trajectory raw: %s", raw[:500])

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        import re
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        candidate = m.group(0) if m else raw
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            repaired = repair_json(candidate, return_objects=True)
            data = repaired if isinstance(repaired, dict) else {}

    # Ensure required fields
    data.setdefault("current_score", current_total)
    data.setdefault("days_until_exam", days)
    data.setdefault("overall_analysis", "")
    data.setdefault("strong_topics", [])
    data.setdefault("weak_topics", [])
    data.setdefault("week_plans", [])
    data.setdefault("task_plans", [])
    log.info("trajectory: generated ok tasks=%d weeks=%d", len(data["task_plans"]), len(data["week_plans"]))
    return data
