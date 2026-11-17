# ЕГЭ Checker — Project Guide

«Эверест» - подготовка к экзаменам по математике (ЕГЭ профиль и база, ОГЭ, школьная программа 5-10 классов).
Ядро - автоматическая проверка 2 части ЕГЭ профиль (задания 13–19) по фото: мультиагентная проверка через OpenAI-совместимый LLM API.
Вокруг неё (ветка `new-design`): входная диагностика, прогноз балла, карта знаний с первопричиной, расписание до экзамена,
задача дня, звёзды и высота, помощник, разборы заданий, кабинет учителя, конспекты и презентации по учебникам.

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
├── report.py            # PDF-отчёт по сессии (fpdf)
├── auth/
│   ├── service.py       # bcrypt + JWT (python-jose)
│   ├── router.py        # POST /auth/register (+ имя, роль, класс, экзамен), /auth/login, /auth/demo
│   └── deps.py          # get_current_user dependency
├── db/
│   ├── database.py      # async SQLAlchemy engine + init_db()
│   ├── models.py        # ORM: User, Session, TaskResult, Trajectory + таблицы нового дизайна (см. ниже)
│   ├── crud.py          # CRUD проверки по фото
│   └── crud_learning.py # CRUD нового дизайна: диагностики, классы, задания, чат, учебники, материалы
├── ocr/
│   ├── preprocessor.py  # OpenCV: deskew, контраст, удаление линовки
│   ├── paddle_ocr.py    # PaddleOCR singleton wrapper
│   └── pipeline.py      # run_ocr() + get_scan_jpeg() для VLM
├── agents/
│   ├── prompts/tasks.py # Критерии для каждого задания (13–19)
│   ├── checker.py       # Один агент → AgentVerdict (JSON)
│   ├── judge.py         # Судья → JudgeDecision; при консенсусе LLM не вызывается
│   ├── trajectory.py    # LLM-траектория по результатам сессии
│   └── engine.py        # asyncio.gather(3 агента) → judge
├── learning/            # модель ученика (новый дизайн)
│   ├── content.py       # граф тем NODES, экзамены EXAMS, задания диагностики с ключами, звёзды, этапы
│   ├── engine.py        # чистые функции: освоение, прогноз, первопричина, what-if, расписание (без БД, тестируются отдельно)
│   ├── service.py       # состояние ученика (LearnerState), замеры, уведомления, хук после проверки по фото
│   ├── llm.py           # помощник, анализ пробелов, конспект и презентация строго по тексту учебника
│   └── demo.py          # демо-ученик для «Посмотреть пример»
├── api/
│   ├── router.py        # проверка по фото: REST + WebSocket; фоновая обработка через asyncio.create_task
│   ├── learning.py      # ученик: профиль, диагностика, главная, расписание, задача дня, звёзды, чат, карта
│   └── teacher.py       # учитель: классы, обзор, спорные работы, домашние задания, учебники, материалы
└── models/
    └── schemas.py       # Pydantic: TaskResult, AgentVerdict, JudgeDecision, SessionResult
```

## Структура frontend

```
frontend/src/
├── App.tsx              # стадии: онбординг → профиль → диагностика → результат → приложение (+ тур)
├── types.ts             # TypeScript типы + TASK_INFO
├── api/client.ts        # fetch wrapper с JWT header, все эндпоинты
├── design/
│   ├── everest.css      # дизайн-система: токены, компоненты, анимации, тёмная тема (Tailwind оставлен, но почти не нужен)
│   └── ui.tsx           # Icon, StarBot (Звёздочка), Typed, горы, орнамент, звук
├── app/
│   ├── store.tsx        # AppProvider: me, dashboard, hash-роутинг (#home, #plan, #map, #video/13…), модалка, тосты
│   └── Shell.tsx        # сайдбар, верхняя панель, нижнее меню на телефоне, уведомления, перерывы
├── pages/
│   ├── Onboarding.tsx   # «привет», роль, имя, класс, экзамен, аккаунт; вход; демо
│   ├── Diagnostic.tsx   # входная диагностика и пробники (ответы проверяет сервер)
│   ├── Result.tsx       # итог диагностики; Tour.tsx - тур по главной
│   ├── Home.tsx         # прогноз, маршрут на сегодня, график, первопричина, задача дня
│   ├── Plan.tsx         # расписание до экзамена; KnowledgeMap.tsx - карта знаний
│   ├── Videos.tsx       # пошаговые разборы (videoData.ts); генерация видео не реализована
│   ├── Chat.tsx         # помощник ученика и учителя; Stars.tsx - звёзды и высота
│   ├── Check.tsx        # история проверок по фото; Session.tsx - загрузка 7 заданий
│   ├── Teacher.tsx      # кабинет учителя; Materials.tsx - конспекты и презентации
│   └── Trajectory.tsx   # траектория по сессии
└── components/
    ├── TaskCard.tsx      # Карточка задания: drag-drop + статус + результат
    └── ResultModal.tsx   # Модальный разбор: судья + 3 эксперта (через portal)
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
| POST | /api/auth/demo | — | Демо-ученик |
| GET/PUT | /api/me, /api/me/profile, /api/me/settings | ✓ | Профиль и настройки (расписание, перерывы, звук) |
| POST | /api/diagnostics (`first`/`mock`) | ✓ | Начать или продолжить диагностику / пробник |
| PUT | /api/diagnostics/{id}/answer | ✓ | Сохранить ответ |
| POST | /api/diagnostics/{id}/finish, /api/diagnostics/skip | ✓ | Итог (прогноз, первопричина, план); пропуск для 5-8 классов |
| GET | /api/dashboard, /api/plan | ✓ | Главная и расписание |
| POST | /api/plan/done, /api/daily/hint, /api/daily/answer | ✓ | Блоки расписания, задача дня |
| POST | /api/events, /api/nodes/{id}/quiz | ✓ | Звёзды, секреты, разборы; мини-проверка темы |
| GET/POST | /api/notifications, /api/notifications/read | ✓ | Уведомления |
| GET/POST/DELETE | /api/chat/{student\|teacher} | ✓ | Помощник (LLM) |
| POST | /api/map/analysis | ✓ | Разбор пробелов (LLM) |
| POST | /api/classes/join, /api/assignments/{id}/done | ✓ | Ученик: вступить в класс, сдать ДЗ |
| GET | /api/teacher/overview, /api/teacher/students/{id} | учитель | Обзор класса, карточка ученика |
| POST | /api/teacher/classes, /api/teacher/reviews/{task_result_id} | учитель | Класс с кодом; балл учителя за спорную работу |
| POST/DELETE | /api/teacher/assignments | учитель | Домашние задания |
| GET/POST/DELETE | /api/textbooks | учитель | Учебники (PDF с текстовым слоем → pypdf) |
| POST/GET | /api/materials/generate, /api/materials | учитель | Конспект / презентация по учебнику (LLM) |

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
- Таблицы создаются автоматически при старте через `Base.metadata.create_all`; новые колонки `users`
  (name, role, grade, exam, is_demo) добавляются в существующую БД через `ALTER TABLE … IF NOT EXISTS` в `init_db()`
- Таблицы нового дизайна: `learner_states` (JSONB-документ ученика), `diagnostics`, `measurements` (история прогноза),
  `notifications`, `chat_messages`, `class_groups`, `class_members`, `assignments`, `teacher_reviews`, `textbooks`, `materials`
- Ключи ответов диагностики хранятся только на сервере (`learning/content.py`), клиент получает задания без них
- После проверки по фото `api/router.py` вызывает `learning.service.on_task_checked`: балл обновляет оценку
  самого задания (`obs`, вес 60% в прогнозе), а через неё прогноз и расписание; освоение тем на карте не меняется.
  Точка на графике появляется только после диагностики
- Логика модели в `learning/engine.py` без БД и сети: её удобно проверять обычными вызовами функций
- JWT токен живёт 30 дней, хранится в localStorage
