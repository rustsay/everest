# ЕГЭ Checker — Project Guide

«Эверест» - подготовка к экзаменам по математике (ЕГЭ профиль и база, ОГЭ, школьная программа 5-10 классов).
Ядро - автоматическая проверка 2 части ЕГЭ профиль (задания 13–19) по фото: мультиагентная проверка через OpenAI-совместимый LLM API.
Вокруг неё (ветка `new-design`): необязательная входная диагностика, прогноз балла, карты заданий 1-19 с первопричиной, расписание до экзамена,
банк задач для ученика и учителя, варианты учителя из банка,
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
│   ├── taskmaps.py      # карты заданий 1-19: прототипы, 38 сквозных умений (u1-u38), задачи задания 1 с ответами
│   ├── textbook_search.py # поиск страниц учебника по умению (ключевые слова, без LLM)
│   ├── llm.py           # помощник, анализ пробелов, конспект и презентация строго по тексту учебника
│   └── demo.py          # демо-ученик для «Посмотреть пример»
├── api/
│   ├── router.py        # проверка по фото: REST + WebSocket; фоновая обработка через asyncio.create_task
│   ├── learning.py      # ученик: профиль, диагностика, главная, расписание, задача дня, звёзды, чат, разбор пробелов
│   ├── teacher.py       # учитель: классы, обзор, спорные работы, домашние задания, учебники, материалы
│   ├── taskmaps.py      # карта задания: проценты, проверка ответов, файлы учителя, объяснение умения по учебнику
│   ├── bank.py          # банк задач: импорт JSON/CSV/PDF/TXT → черновики → проверка → публикация
│   └── practice.py      # банк для ученика (/practice) и варианты учителя из банка (/variants)
└── models/
    └── schemas.py       # Pydantic: TaskResult, AgentVerdict, JudgeDecision, SessionResult
```

## Структура frontend

```
frontend/src/
├── App.tsx              # стадии: онбординг → профиль → (диагностика, можно пропустить) → приложение (+ тур)
├── types.ts             # TypeScript типы + TASK_INFO
├── api/client.ts        # fetch wrapper с JWT header, все эндпоинты
├── design/
│   ├── everest.css      # дизайн-система: токены, компоненты, анимации, тёмная тема (Tailwind оставлен, но почти не нужен)
│   └── ui.tsx           # Icon, StarBot (Звёздочка), Typed, горы, орнамент, звук
├── app/
│   ├── store.tsx        # AppProvider: me, dashboard, hash-роутинг (#home, #plan, #task/1, #practice, #variant/3…), модалка, тосты
│   └── Shell.tsx        # сайдбар, верхняя панель, нижнее меню на телефоне, уведомления, перерывы
├── pages/
│   ├── Onboarding.tsx   # «привет», роль, имя, класс, экзамен, аккаунт; вход; демо
│   ├── Diagnostic.tsx   # входная диагностика и пробники (ответы проверяет сервер)
│   ├── Result.tsx       # итог диагностики; Tour.tsx - тур по главной
│   ├── Home.tsx         # прогноз, маршрут на сегодня, график, первопричина, задача дня
│   ├── Plan.tsx         # расписание до экзамена (общей карты знаний больше нет, вместо неё карты заданий)
│   ├── TaskMap.tsx      # карта задания (#task/1…19): прототипы → задание, умения; панель с задачами, файлами, объяснением
│   ├── Bank.tsx         # банк задач учителя (#bank): импорт, черновики, публикация
│   ├── Practice.tsx     # банк задач ученика (#practice): задачи по заданиям и прототипам + варианты от учителя
│   ├── Variants.tsx     # варианты учителя (#variants): автоматически или вручную, выдача классу; страница варианта (#variant/N)
│   ├── Videos.tsx       # пошаговые разборы (videoData.ts); генерация видео не реализована
│   ├── Chat.tsx         # помощник ученика и учителя; Stars.tsx - звёзды и высота
│   ├── Check.tsx        # история проверок по фото; Session.tsx - загрузка 7 заданий
│   ├── Teacher.tsx      # кабинет учителя; Materials.tsx - конспекты и презентации
│   └── Trajectory.tsx   # траектория по сессии
└── components/
    ├── TaskCard.tsx      # Карточка задания: drag-drop + статус + результат
    ├── ResultModal.tsx   # Модальный разбор: судья + 3 эксперта (через portal)
    └── GeoFig.tsx        # SVG-чертежи прототипов планиметрии
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
| GET | /api/taskmaps, /api/taskmaps/{n} | ✓ | Карты заданий; карта с процентами по прототипам и умениям |
| POST | /api/taskmaps/{n}/answer | ✓ | Ответ на задачу прототипа (в процент идёт первая попытка) |
| POST | /api/taskmaps/{n}/files | учитель | Прикрепить файл к прототипу (pdf, картинки, docx, pptx до 20 МБ) |
| GET/DELETE | /api/taskfiles/{id} | ✓ | Скачать (свои файлы и файлы учителей своих классов) / удалить свой |
| POST | /api/skills/{id}/explain | ✓ | Объяснение умения строго по учебнику (страницы + LLM, кэш в БД) |
| POST | /api/bank/import | учитель | Импорт задач: JSON/CSV точно, PDF с текстом/TXT через LLM → черновики |
| GET/PUT/DELETE | /api/bank, /api/bank/{id} | учитель | Черновики и опубликованные; публикация после проверки |
| GET | /api/bank/protos, /api/bank/template.csv | учитель | Список прототипов; шаблон CSV |
| GET | /api/practice?task=&proto= | ✓ | Банк для ученика: опубликованные задачи без ответов |
| GET | /api/variants/candidates?task= | учитель | Задачи банка с ответами для ручного выбора |
| POST/PUT/DELETE | /api/variants, /api/variants/{id} | учитель | Вариант: `items` вручную или `auto_tasks` (по одной случайной задаче на задание), класс, срок |
| GET | /api/variants, /api/variants/{id} | ✓ | Учитель видит свои с результатами; ученик - выданные его классам |
| POST | /api/variants/{id}/submit | ✓ | Сдать вариант (одна попытка); ответы идут в проценты карт заданий |

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
  `notifications`, `chat_messages`, `class_groups`, `class_members`, `assignments`, `teacher_reviews`, `textbooks`, `materials`,
  `task_files` (файлы к прототипам, сами файлы в `/app/uploads/taskfiles`), `bank_problems` (банк задач: draft/approved),
  `skill_explanations` (кэш объяснений: умение × учебник)
- Карта задания: процент прототипа = доля верных первых попыток по его задачам + задание этого номера из диагностик
  и пробников (`TASK_MAPS[n]["diag"]` связывает вариант диагностики с прототипом). Ответы `state.data["tm"]`.
  Карты готовы для 1-19 (прототипы и умения согласованы с методистом). Задачи: свои у задания 1 + опубликованные из банка.
  Ученику коды кодификатора не показываются, умения сформулированы как действия.
- Объяснение умения: учебники учителя (ученику - учителей его классов) → `textbook_search.best_pages` по ключевым словам →
  LLM пишет только по этим страницам со ссылками «стр. N» (PDF хранится с метками [[стр. N]]); нет страниц → без LLM, честное «не нашлось»
- Банк задач: импорт ничего не публикует; для 1-12 ответ обязателен, для 13-19 задача без ответа решается через проверку по фото
- Диагностика необязательна (`engine.diag_required` → False): после регистрации её предлагают один раз, можно пропустить.
  Пока её нет, `dashboard.diag_done = false`, и главная вместо прогноза показывает приглашение пройти диагностику
- Маршрут и расписание строятся правилами `engine.build_plan`, без LLM. Первая попытка задачи с коротким ответом
  (карта задания, банк, вариант учителя) идёт в `state.data["prac"]` (T{n} → [верно, всего]) и подмешивается к оценке задания:
  вес 0.6·k/(k+2) при k ответах, с проверкой по фото - пополам с её результатом. Темы под заданиями, где 2+ ответа и меньше
  половины верных, встают в очередь тем раньше. `route_basis` (diag/practice/start) - на чём держится маршрут,
  клиент честно пишет «Стартовый маршрут», пока данных нет
- Задачи адресуются ссылками: `s1:r2` - встроенная задача задания 1, `b12` - задача банка (`learning/problems.py`).
  Ученик получает задачи без ответов; решение видно после первой попытки
- Ключи ответов диагностики хранятся только на сервере (`learning/content.py`), клиент получает задания без них
- После проверки по фото `api/router.py` вызывает `learning.service.on_task_checked`: балл обновляет оценку
  самого задания (`obs`, вес 60% в прогнозе), а через неё прогноз и расписание; освоение тем на карте не меняется.
  Точка на графике появляется только после диагностики
- Логика модели в `learning/engine.py` без БД и сети: её удобно проверять обычными вызовами функций
- JWT токен живёт 30 дней, хранится в localStorage
