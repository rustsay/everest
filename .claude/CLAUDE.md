# ЕГЭ Checker — Project Guide

Сервис автоматической проверки 2 части ЕГЭ по профильной математике (задания 13–19).
Мультиагентная проверка через OpenAI-совместимый LLM API.

## Быстрый старт

```bash
cp .env.example .env       # заполнить LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, SECRET_KEY
docker compose up --build  # поднимает backend + frontend + postgres
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/api
- Swagger docs: http://localhost:8000/docs

## Архитектура

```
frontend (React + Tailwind)  →  nginx  →  FastAPI backend  →  LLM API (OpenAI-compatible)
                                                          ↕
                                                    PostgreSQL
                                                    (сессии, результаты, юзеры)
                                                          ↕
                                                    /app/uploads volume
                                                    (scan files)
```

## Структура backend

```
backend/app/
├── main.py              # FastAPI app + lifespan (init DB)
├── config.py            # Settings из env (pydantic-settings)
├── storage.py           # Файловые операции (сканы на диск)
├── auth/
│   ├── service.py       # bcrypt + JWT (python-jose)
│   ├── router.py        # POST /auth/register, /auth/login
│   └── deps.py          # get_current_user dependency
├── db/
│   ├── database.py      # async SQLAlchemy engine + init_db()
│   ├── models.py        # ORM: User, Session, TaskResult
│   └── crud.py          # CRUD операции
├── ocr/
│   ├── preprocessor.py  # OpenCV: deskew, контраст, удаление линовки
│   ├── paddle_ocr.py    # PaddleOCR singleton wrapper
│   └── pipeline.py      # run_ocr() + get_scan_jpeg() для VLM
├── agents/
│   ├── prompts/tasks.py # Критерии для каждого задания (13–19)
│   ├── checker.py       # Один агент → AgentVerdict (JSON)
│   ├── judge.py         # Судья → JudgeDecision; при консенсусе LLM не вызывается
│   └── engine.py        # asyncio.gather(3 агента) → judge
├── api/
│   └── router.py        # REST + WebSocket; фоновая обработка через asyncio.create_task
└── models/
    └── schemas.py       # Pydantic: TaskResult, AgentVerdict, JudgeDecision, SessionResult
```

## Структура frontend

```
frontend/src/
├── App.tsx              # Auth state + routing (history / session)
├── types.ts             # TypeScript типы + TASK_INFO
├── api/client.ts        # fetch wrapper с JWT header
├── pages/
│   ├── Auth.tsx         # Login / Register (toggle)
│   ├── History.tsx      # Список прошлых сессий + "Новая проверка"
│   └── Session.tsx      # Upload 7 заданий + прогресс агентов в реальном времени
└── components/
    ├── TaskCard.tsx      # Карточка задания: drag-drop + статус + результат
    └── ResultModal.tsx   # Модальный разбор: судья + 3 эксперта + OCR-текст
```

## API endpoints

| Method | Path | Auth | Описание |
|--------|------|------|----------|
| POST | /api/auth/register | — | Регистрация |
| POST | /api/auth/login | — | Логин → JWT |
| POST | /api/sessions | ✓ | Создать сессию |
| GET | /api/sessions | ✓ | История сессий пользователя |
| POST | /api/sessions/{id}/tasks/{n}/upload | ✓ | Загрузить скан (jpg/png/pdf) |
| GET | /api/sessions/{id}/tasks/{n}/status | ✓ | Статус задания |
| GET | /api/sessions/{id}/results | ✓ | Полные результаты сессии |
| WS | /api/ws/{session_id} | — | Real-time события обработки |

## WebSocket события

```
ocr_started       → task_id
ocr_done          → task_id, confidence, low_confidence
agents_started    → task_id
agent_done        → task_id, agent_id, score
judge_done        → task_id, final_score
task_complete     → task_id, final_score, max_score
task_error        → task_id, error
```

## Мультиагентная проверка

3 агента запускаются параллельно через `asyncio.gather`:
- Agent 1: temperature=0.3 (строгий)
- Agent 2: temperature=0.7 (нейтральный)
- Agent 3: temperature=1.0 (лояльный)

Судья вызывается **только** если все 3 дали разные баллы (при консенсусе 2/3 — экономия LLM-вызова).
Итого ≤28 LLM-вызовов на полную сессию (7 заданий × 4 вызова макс.).
Максимальный балл: 20 (13:2 + 14:3 + 15:2 + 16:2 + 17:3 + 18:4 + 19:4).

Каждому агенту передаётся: системный промпт + критерии задания + OCR-текст + оригинальный скан (base64).
VLM видит формулы и чертежи напрямую; OCR-текст — вспомогательный контекст.

## Переменные окружения (.env)

| Переменная | Описание |
|-----------|----------|
| LLM_BASE_URL | URL OpenAI-совместимого API |
| LLM_API_KEY | API ключ (любая строка если не требуется) |
| LLM_MODEL | Название модели, например `google/gemma-4-26b-a4b-it` |
| POSTGRES_PASSWORD | Пароль PostgreSQL (default: postgres) |
| SECRET_KEY | Секрет для JWT подписи — **сменить в продакшене** |

## Разработка без Docker

```bash
# Backend
cd backend
pip install -r requirements.txt
export LLM_BASE_URL=... LLM_API_KEY=... DATABASE_URL=postgresql+asyncpg://...
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev   # vite proxy → localhost:8000
```

## Заметки по реализации

- OCR (PaddleOCR) — синхронный, запускается в thread pool через `run_in_executor`
- Сканы хранятся в Docker volume `/app/uploads` (не в БД — слишком большие)
- Результаты в PostgreSQL: таблицы `users`, `sessions`, `task_results` (JSONB для вердиктов)
- Таблицы создаются автоматически при старте через `Base.metadata.create_all`
- JWT токен живёт 30 дней, хранится в localStorage
