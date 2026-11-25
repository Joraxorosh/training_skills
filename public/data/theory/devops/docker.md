Docker упаковывает приложение со всеми зависимостями в образ и запускает его в изолированном контейнере. Это стандарт доставки в CI/CD и основа Kubernetes. На собеседовании спрашивают про устройство образов и слоёв, Dockerfile и кэш сборки, тома и сети, Docker Compose и безопасность.

## Образ, контейнер и изоляция

**Образ** — неизменяемый шаблон из слоёв файловой системы и метаданных. **Контейнер** — запущенный экземпляр образа с собственным тонким записываемым слоем. Из одного образа можно запустить много контейнеров.

Контейнер — это обычный процесс Linux, изолированный **namespaces** (pid, net, mnt, uts, ipc, user) и ограниченный **cgroups** (CPU, память). Ядро общее с хостом — это не виртуальная машина.

```bash
docker run -d --name web -p 8080:80 nginx:1.27   # хост:8080 → контейнер:80
docker ps -a                  # все контейнеры, включая остановленные
docker logs -f web            # логи в реальном времени
docker exec -it web sh        # оболочка в запущенном контейнере
docker stop web && docker rm web
docker images; docker image prune
```

## Dockerfile и кэш слоёв

Каждая инструкция (`RUN`, `COPY`, `ADD`) создаёт слой. Если инструкция и её входные данные не изменились, слой берётся из кэша; после первого изменения все последующие слои пересобираются. Поэтому сначала копируют манифест зависимостей, а уже потом исходники:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER nonroot
CMD ["dist/server.js"]
```

| Инструкция | Назначение |
|---|---|
| `COPY` | Копирует файлы из контекста сборки |
| `ADD` | Как COPY, но умеет **распаковывать локальные tar-архивы** и скачивать по URL; без нужды не используют |
| `ENV` / `ARG` | Переменная окружения в рантайме / переменная только времени сборки |
| `USER` | Пользователь для последующих инструкций и для запуска |
| `ENTRYPOINT` / `CMD` | Что запускать / аргументы по умолчанию |

**ENTRYPOINT + CMD**: если оба в exec-форме, команда = ENTRYPOINT + CMD. Аргументы `docker run image args` заменяют CMD, но не ENTRYPOINT.

> Частая ловушка: shell-форма `CMD node server.js` запускает процесс через `/bin/sh -c`, и PID 1 становится shell, который не передаёт SIGTERM приложению. В итоге `docker stop` ждёт 10 секунд и шлёт SIGKILL. Используйте exec-форму `CMD ["node", "server.js"]` или `--init`/tini.

Слои неизменяемы: `RUN apt-get install ... ` и отдельный `RUN rm -rf /var/lib/apt/lists/*` не уменьшат образ — удаляйте в том же `RUN`. Секрет, скопированный в слой и удалённый позже, остаётся в истории образа.

## Уменьшение образа и воспроизводимость

- Multi-stage сборка: в финальный образ попадает только артефакт.
- Минимальная база: `alpine`, `slim`, `distroless`, `scratch`.
- Объединение команд и очистка кэшей пакетного менеджера в одном `RUN`.
- `.dockerignore` исключает `.git`, `node_modules`, секреты из контекста сборки — сборка быстрее, утечек меньше.
- Для детерминизма фиксируют базовый образ по **digest**: `FROM python:3.12-slim@sha256:...`. Тег (даже `3.12.7`) может быть перезаписан.

**BuildKit** (сборщик по умолчанию): параллельная сборка независимых стадий, кэш-маунты (`RUN --mount=type=cache`), секреты сборки (`RUN --mount=type=secret`), которые не попадают в слои, мультиплатформенная сборка через `docker buildx`.

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
```

## Тома и сети

| | Named volume | Bind mount | tmpfs |
|---|---|---|---|
| Где данные | Управляет Docker (`/var/lib/docker/volumes`) | Конкретный путь хоста | Память |
| Пример | `-v pgdata:/var/lib/postgresql/data` | `-v ./src:/app` | `--tmpfs /tmp` |
| Для чего | Данные БД, переносимо | Разработка, конфиги | Временные данные |

В **пользовательской bridge-сети** (`docker network create`) работает встроенный DNS: контейнеры обращаются друг к другу по имени (`db:5432`). В дефолтной сети `bridge` разрешения имён нет.

## Docker Compose v2

Compose v2 — плагин `docker compose` (с пробелом), файл `compose.yaml`; поле `version:` устарело.

```yaml
services:
  app:
    build: .
    ports: ["8080:8080"]
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:17
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
volumes:
  pgdata:
```

Короткая форма `depends_on: [db]` гарантирует только **порядок запуска**, а не готовность БД. Для ожидания нужен healthcheck и `condition: service_healthy`.

```bash
docker compose up -d       # создать и запустить в фоне
docker compose logs -f app
docker compose down        # named volumes сохраняются
docker compose down -v     # удалить и тома
```

## Безопасность контейнеров

- Не запускать от root (`USER`), rootless-режим.
- `--read-only`, `--cap-drop ALL`, не использовать `--privileged` и не монтировать `docker.sock`.
- Сканировать образы (Trivy, Grype), подписывать (cosign), обновлять базу.
- Секреты — не в `ENV` и не в слоях, а через secrets/переменные рантайма.

## Частые вопросы на собеседовании

- Образ vs контейнер? → Шаблон vs запущенный экземпляр с записываемым слоем.
- CMD vs ENTRYPOINT? → ENTRYPOINT — исполняемая команда, CMD — аргументы по умолчанию, легко переопределяются.
- COPY vs ADD? → ADD дополнительно распаковывает tar и качает URL; по умолчанию используйте COPY.
- Почему stop занимает 10 секунд? → PID 1 не обрабатывает SIGTERM (shell-форма), Docker ждёт таймаут и шлёт SIGKILL.
- Что даёт depends_on? → Только порядок старта без healthcheck-условия.
- Чем контейнер отличается от ВМ? → Общее ядро, изоляция namespaces/cgroups, старт за доли секунды.

## Шпаргалка

- `docker run -d -p H:C --name n img`, `docker ps -a`, `docker logs -f`, `docker exec -it n sh`
- `docker build -t app:1.0 .`, `docker buildx build --platform linux/amd64,linux/arm64`
- Кэш: сначала зависимости, потом код; `.dockerignore`
- Multi-stage, distroless, digest-пиннинг, `USER`
- Exec-форма `CMD ["bin","arg"]`
- `docker compose up -d / down / down -v / logs -f`
- `docker network create`, `docker volume ls`, `docker system prune`
