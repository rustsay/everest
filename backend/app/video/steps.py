"""Generate short board lines and narration for the existing interactive player."""
import re
from bs4 import BeautifulSoup
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from app.config import settings
from app.agents.checker import _extract_json

class SolutionStep(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    lines: list[str] = Field(min_length=1, max_length=4)
    text: str = Field(min_length=1, max_length=1000)

class Solution(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    steps: list[SolutionStep] = Field(min_length=2, max_length=12)

async def generate_steps(problem: str, images: list[str] | None = None) -> dict:
    """images: base64 PNG/JPEG of the condition (and of the known answer), for problems stored as pictures."""
    messages = [
        {'role': 'system', 'content': 'Ты репетитор математики. Реши задачу корректно и объясни по этапам, обязательно проверь ответ. Верни только JSON: {"title":"Название темы","steps":[{"title":"Название шага","lines":["Короткая запись на доске","Формула или вычисление"],"text":"Понятное устное пояснение Звёздочки к этому шагу"}]}. От 3 до 9 шагов. На каждом шаге 1–4 коротких строки до 90 символов каждая; длинные вычисления разделяй на шаги. В lines только ключевые записи и формулы, в text связное пояснение до 100 слов. Используй обычные символы: √, π, ², дробь через /; без LaTeX, markdown, HTML, SVG и кода. Последний шаг — ответ и проверка. Не выдумывай недостающие условия; если данных недостаточно, объясни это по шагам.'},
        {'role': 'user', 'content': problem if not images else [{'type': 'text', 'text': problem}]
         + [{'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{b}'}} for b in images]},
    ]
    async with AsyncOpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key, timeout=150, max_retries=0) as client:
        for attempt in range(3):
            r = await client.chat.completions.create(model=settings.llm_model, messages=messages, temperature=.3, max_tokens=6000)
            raw = r.choices[0].message.content or ''
            try:
                result = Solution.model_validate(_extract_json(raw))
                if any(not line.strip() or len(line) > 130 for s in result.steps for line in s.lines):
                    raise ValueError('Строки на доске должны быть непустыми и короче 130 символов')
                return result.model_dump()
            except (ValueError, TypeError) as exc:
                if attempt == 2:
                    raise ValueError('Не удалось получить пошаговое решение') from exc
                messages += [{'role':'assistant','content':raw}, {'role':'user','content':'Исправь формат ответа. Нужны title и steps: title, lines (1–4 короткие строки), text (пояснение). Только JSON.'}]

def display_steps(steps: list | None, board: str | None) -> list[dict]:
    """Use saved SVG text to display earlier generated videos in the same board UI."""
    if not steps:
        return []
    soup = BeautifulSoup(board or '', 'html.parser')
    groups = [g for g in soup.find_all('g') if re.fullmatch(r'step\d+', str(g.get('id', '')))]
    out = []
    for i, step in enumerate(steps):
        lines = step.get('lines')
        if not lines and i < len(groups):
            lines = [t.get_text(' ', strip=True) for t in groups[i].find_all('text')]
            lines = [t for t in lines if t and t != step.get('title')]
        out.append({'title': step.get('title') or f'Шаг {i+1}', 'lines': lines or [step.get('title') or 'Решение'], 'text': step.get('text') or ''})
    return out
