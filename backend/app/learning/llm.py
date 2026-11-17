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


# ---------- task bank: problems out of a document ----------

async def extract_problems(text: str, task_n: int, protos: list[dict]) -> list[dict]:
    """Split a document (variant, collection, open bank export) into problems of one exam task.
    The model copies, it does not invent: an answer only if the document states it."""
    plist = "\n".join(f"- {p['id']}: {p['name']}" for p in protos)
    prompt = f"""Перед тобой текст документа с задачами по математике (вариант, сборник или выгрузка открытого банка заданий).
Найди в нём задачи, которые подходят к заданию № {task_n} профильного ЕГЭ, и отнеси каждую к прототипу из списка:
{plist}
Правила:
1) Условие переписывай дословно, ничего не меняй и не дополняй. Формулы обычным текстом.
2) Ответ пиши только если он есть в документе (строка «Ответ: …», ключ ответов). Иначе answer = null. Не решай задачи сам.
3) Решение переписывай только если оно есть в документе, иначе solution = "".
4) Если задача не подходит ни к одному прототипу, пропусти её. Если в тексте нет подходящих задач, верни пустой список.
Ответь только JSON: {{"problems":[{{"text":"...","answer":"..." или null,"proto":"id","solution":"..."}}]}}
ТЕКСТ:
\"\"\"{text}\"\"\""""
    data = parse_json(await complete([{"role": "user", "content": prompt}], 0.0))
    ids = {p["id"] for p in protos}
    out = []
    for it in (data.get("problems") or []):
        if not isinstance(it, dict) or not str(it.get("text") or "").strip():
            continue
        ans = it.get("answer")
        out.append({"text": str(it["text"]).strip()[:4000], "answer": (str(ans).strip()[:80] or None) if ans not in (None, "") else None,
                    "proto": it.get("proto") if it.get("proto") in ids else "", "solution": str(it.get("solution") or "")[:6000]})
    return out


# ---------- explanation of a cross-cutting skill from a textbook ----------

async def explain_skill(skill_name: str, book: dict, fragments: str) -> str:
    prompt = f"""Ты помощник ученика при подготовке к ЕГЭ по математике. Объясни умение «{skill_name}» СТРОГО по фрагментам учебника ниже.
Учебник: «{book.get('title', '')}», {book.get('authors', '')}.
Правила:
1) Определения, формулы и теоремы переписывай дословно из фрагментов и после каждой ставь страницу в скобках, например (стр. 12). Страница указана в метках [[стр. N]].
2) Пример бери только из фрагментов, с его номером. Новых фактов, формул и примеров от себя не добавляй.
3) Если во фрагментах нет нужного, так и напиши: «В этих страницах учебника этого нет». Не дополняй из памяти.
4) Пиши просто, на «ты», по-русски, до 220 слов. Формулы обычным текстом (sin²x, π/6, log₂x).
Структура: **Коротко** (1-2 предложения), **Что запомнить** (определения и формулы со страницами), **Пример из учебника**, **Где пригодится на ЕГЭ** (одно предложение).
ФРАГМЕНТЫ:
\"\"\"{fragments}\"\"\""""
    return await complete([{"role": "user", "content": prompt}], 0.2)
