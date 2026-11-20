# Разработка фронтенда

Из корня проекта:

```sh
docker compose up -d --build
```

Сайт: http://localhost:3000. Vite автоматически подхватывает изменения
исходников из `frontend/` и обновляет страницу через HMR. Polling включён
для надёжного отслеживания файлов в Docker Desktop. Запросы `/api` и
WebSocket `/api/ws` проксируются в контейнер backend.

После изменения зависимостей в `package.json` пересоберите фронтенд
и обновите анонимный том с `node_modules`:

```sh
docker compose up -d --build --no-deps --renew-anon-volumes frontend
```

Для запуска Vite вне Docker: `npm install` и `npm run dev` из `frontend/`.
По умолчанию API проксируется на `http://localhost:8000`.

В Dockerfile сохранён финальный этап `production`: он собирает приложение
и раздаёт статику через nginx на порту 80. Обычная сборка этого Dockerfile
без `--target` использует именно его; Compose выбирает этап `development`.
