"""LLM calls for the new screens: assistant chat, gap analysis, conspects and slides.
Same client and settings as the checking agents (OpenAI-compatible API)."""
from __future__ import annotations

import json
import logging
import re

from json_repair import repair_json
from openai import AsyncOpenAI

from app.config import settings

log = logging.getLogger(__name__)

RULES_STUDENT = """Ты помощник «Эверест» для подготовки к экзамену по математике.
Правила: веди к решению наводящими вопросами, не давай готовый ответ сразу. Лесенка: вопрос → метод → первый шаг → полное решение только после трёх подсказок или после попытки ученика.
Отвечай коротко (до 120 слов), на «ты», по-русски. Формулы пиши обычным текстом (sin²x, π/6). Хвали за конкретный шаг. Не обсуждай темы вне учёбы, мягко возвращай к математике. Не ставь баллы: их ставит проверка по фото и учитель."""

RULES_TEACHER = """Ты помощник учителя математики в сервисе «Эверест». Обращайся на «вы», коротко, по делу, с цифрами.
Опирайся только на данные класса ниже и на общеизвестные требования ЕГЭ и ОГЭ; если чего-то нет в данных, так и скажи. Не меняй оценки сам, предлагай. Формулы обычным текстом. До 200 слов."""

CONSPECT_TEMPLATE = [
    "Тема и параграф", "Цель урока", "Что повторить", "Определения (дословно из учебника)",
    "Теоремы и формулы (дословно)", "Разобранный пример из учебника", "Задачи из учебника: базовые и повышенные",
    "Связь с экзаменом", "Типичные ошибки по критериям ФИПИ", "Домашнее задание (номера из учебника)",
]


def _client() -> AsyncOpenAI:
    return AsyncOpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)


async def complete(messages: list[dict], temperature: float = 0.4) -> str:
    resp = await _client().chat.completions.create(model=settings.llm_model, messages=messages, temperature=temperature)
    return (resp.choices[0].message.content or "").strip()


def parse_json(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        cand = m.group(0) if m else raw
        try:
            return json.loads(cand)
        except json.JSONDecodeError:
            fixed = repair_json(cand, return_objects=True)
            return fixed if isinstance(fixed, dict) else {}


async def chat(kind: str, context: str, history: list[dict], image_b64: str | None = None) -> str:
    system = (RULES_TEACHER if kind == "teacher" else RULES_STUDENT) + "\n\n" + context
    msgs: list[dict] = [{"role": "system", "content": system}]
    for i, m in enumerate(history[-12:]):
        last = i == len(history[-12:]) - 1
        if last and image_b64 and m["role"] == "user":
            msgs.append({"role": "user", "content": [
                {"type": "text", "text": m["content"]},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
            ]})
        else:
            msgs.append({"role": m["role"], "content": m["content"]})
    return await complete(msgs, 0.5)


async def gap_analysis(nodes_text: str, tasks_text: str, root_name: str | None) -> str:
    prompt = f"""Ты методист по подготовке к экзамену по математике. Вот карта знаний ученика (проценты освоения) и задания экзамена.
ТЕМЫ:\n{nodes_text}\nЗАДАНИЯ:\n{tasks_text}\nПервопричина по правилам системы: {root_name or 'нет'}.
Напиши ученику коротко и по делу, на «ты», без воды:
**Где корень проблемы** (1-2 предложения, почему именно эта тема).
**Что ты теряешь** (какие темы и задания проседают из-за первопричины и сколько баллов на кону).
**План на неделю** (5 коротких шагов по дням, от первопричины к заданиям).
Не придумывай данных, которых нет выше. Формулы обычным текстом. До 180 слов."""
    return await complete([{"role": "user", "content": prompt}], 0.4)


def _material_head(kind: str, topic: str, book: dict, section: str, who: str, minutes: str, text: str, exam_link: str) -> str:
    return f"""Ты методист по математике. Составь {'презентацию' if kind == 'slides' else 'конспект урока'} СТРОГО по тексту учебника ниже.
Учебник: «{book.get('title', '')}», {book.get('authors', '')}. Параграф/пункт: {section or 'не указан'}. Тема: «{topic}». Аудитория: {who}. Длительность: {minutes} минут.
Правила:
1) Определения, формулировки теорем и формулы переписывай дословно из текста учебника, указывай пункт или страницу, если они есть в тексте.
2) Примеры и задачи бери только из учебника, с их номерами. Новых задач не придумывай.
3) Если чего-то из шаблона нет в тексте, напиши «в учебнике нет» и ничего не добавляй от себя.
4) В разделе «Связь с экзаменом» используй: {exam_link}. И что проверяют критерии ФИПИ.
5) Формулы обычным текстом (sin²x, π/6, log₂x). Пиши просто, без воды, по-русски.
ТЕКСТ УЧЕБНИКА:
\"\"\"{text[:60000]}\"\"\""""


async def conspect(topic: str, book: dict, section: str, who: str, minutes: str, text: str, exam_link: str) -> str:
    prompt = _material_head("conspect", topic, book, section, who, minutes, text, exam_link) + \
        "\nСтруктура строго такая, заголовки через **:\n" + "\n".join(f"**{s}.**" for s in CONSPECT_TEMPLATE)
    return await complete([{"role": "user", "content": prompt}], 0.3)


async def slides(topic: str, book: dict, section: str, who: str, minutes: str, text: str, exam_link: str) -> list[dict]:
    prompt = _material_head("slides", topic, book, section, who, minutes, text, exam_link) + \
        f"\nСделай 8-10 слайдов по разделам шаблона: {'; '.join(CONSPECT_TEMPLATE)}. На слайде до 5 коротких пунктов. К каждому слайду заметка учителю.\n" \
        'Ответь только JSON: {"slides":[{"title":"...","bullets":["..."],"note":"..."}]}'
    data = parse_json(await complete([{"role": "user", "content": prompt}], 0.3))
    out = []
    for s in (data.get("slides") or [])[:14]:
        if isinstance(s, dict) and s.get("title"):
            out.append({"title": str(s["title"])[:140], "bullets": [str(b)[:240] for b in (s.get("bullets") or [])[:6]],
                        "note": str(s.get("note") or "")[:400]})
    return out
