import base64
import json
import logging
import re

from json_repair import repair_json

from openai import AsyncOpenAI

from app.agents.prompts.tasks import TASK_CONFIGS
from app.config import settings
from app.models.schemas import AgentVerdict

log = logging.getLogger(__name__)

_SYSTEM = """Ты — эксперт предметной комиссии ЕГЭ по профильной математике.

Общие правила:
1. Оценивай только то, что написано в решении — не додумывай за ученика.
2. Если OCR-текст и скан расходятся — доверяй скану: формулы и чертежи видны на изображении.
3. Нестандартное, но математически верное решение засчитывай полностью.
4. Отвечай ТОЛЬКО валидным JSON без markdown-обёрток и пояснений вне JSON.
5. ЗАПРЕЩЕНО использовать LaTeX-нотацию (\\frac, \\sqrt, \\cdot и т.д.) — пиши формулы простым текстом: дроби через /, корень как sqrt(), степень через ^."""


def _user_content(task_id: int, ocr_text: str, image_b64_list: list[str]) -> list:
    cfg = TASK_CONFIGS[task_id]
    n = len(image_b64_list)
    img_note = f"(прикреплено {n} изображени{'е' if n == 1 else 'я' if n < 5 else 'й'})" if n > 1 else ""
    text = (
        f"# Задание {task_id} — {cfg['topic']} (максимум {cfg['max_score']} баллов)\n\n"
        f"{cfg['criteria']}\n\n"
        f"---\n\n"
        f"## Распознанный текст решения (OCR — вспомогательно, возможны ошибки распознавания): {img_note}\n\n"
        f"{ocr_text or '(OCR не дал результата — используй только скан)'}"
    )
    content: list = [{"type": "text", "text": text}]
    for b64 in image_b64_list:
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
    return content


def _extract_json(text: str) -> dict:
    # Try strict parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Strip markdown fences
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = m.group(1) if m else None
    # Fall back to first {...} block
    if not candidate:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        candidate = m.group(0) if m else text
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    # Last resort: auto-repair (handles unescaped quotes, missing commas, LaTeX escapes, etc.)
    repaired = repair_json(candidate, return_objects=True)
    if isinstance(repaired, dict):
        return repaired
    raise ValueError(f"Нет JSON в ответе модели: {text[:300]}")


async def run_agent(
    agent_id: int,
    task_id: int,
    ocr_text: str,
    image_bytes_list: list[bytes],
    temperature: float,
    model: str | None = None,
) -> AgentVerdict:
    log.info("agent=%d task=%d temp=%.1f images=%d start", agent_id, task_id, temperature, len(image_bytes_list))
    client = AsyncOpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)
    image_b64_list = [base64.b64encode(b).decode() for b in image_bytes_list]
    max_score = TASK_CONFIGS[task_id]["max_score"]

    response = await client.chat.completions.create(
        model=model or settings.llm_model,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": _user_content(task_id, ocr_text, image_b64_list)},
        ],
        temperature=temperature,
    )

    raw_text = response.choices[0].message.content or "{}"
    log.debug("agent=%d task=%d raw_response=%s", agent_id, task_id, raw_text[:500])
    raw = _extract_json(raw_text)
    verdict = AgentVerdict(
        agent_id=agent_id,
        score=min(max(int(raw.get("score", 0)), 0), max_score),
        max_score=max_score,
        reasoning=str(raw.get("reasoning", "")),
        errors_found=list(raw.get("errors_found", [])),
        correct_steps=list(raw.get("correct_steps", [])),
        confidence=float(raw.get("confidence", 0.5)),
    )
    log.info("agent=%d task=%d score=%d/%d conf=%.2f", agent_id, task_id, verdict.score, max_score, verdict.confidence)
    return verdict
