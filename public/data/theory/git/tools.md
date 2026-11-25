Продуктивность разработчика складывается не только из знания языка, но и из владения окружением: терминалом, отладчиком, менеджерами пакетов, контейнерами и автоматическими проверками. На собеседовании это проверяют вопросами вроде «как воспроизвести окружение коллеги», «зачем lockfile» или «как не закоммитить секрет».

## Shell: пайпы, grep, rg, jq

Пайп `|` передаёт stdout одной программы на stdin следующей. Из маленьких утилит собираются мощные однострочники:

```bash
grep -c ERROR app.log                       # число строк с ERROR
grep -rn "TODO" src/ | wc -l                # рекурсивно, с номерами строк
rg "fn main" -t rust                        # ripgrep: быстрее, учитывает .gitignore
tail -f app.log | grep --line-buffered 500  # живой фильтр лога
curl -s api/items | jq -r '.items[].name'   # извлечь поля из JSON
```

`jq` — «sed для JSON»: `.items[]` разворачивает массив, `-r` выводит строки без кавычек, `select(.status=="failed")` фильтрует. В скриптах начинайте с `set -euo pipefail`: `-e` — выход при ошибке, `-u` — ошибка на неопределённой переменной, `pipefail` — пайплайн падает, если упала любая его часть (без него `false | true` вернёт 0).

## IDE и отладчик

Отладка принтами работает, но отладчик быстрее: можно остановиться, посмотреть стек и переменные, вычислить выражение.

- **Breakpoint** — остановка на строке; **conditional** — только при условии (`user.id == 42`).
- **Logpoint** — вывод сообщения без остановки.
- **Exception breakpoint** — остановка при выбросе исключения.
- Step over / step into / step out, watch-выражения, call stack.

Полезные функции IDE: навигация к определению и использованиям, безопасный рефакторинг (rename symbol), встроенный git blame и разрешение конфликтов.

## Make и менеджеры пакетов

Make описывает задачи проекта единообразно: `make test`, `make lint`, `make run`. Цели — это файлы, поэтому задачи-команды объявляют `.PHONY`, иначе при существовании каталога `test/` make скажет «up to date».

```makefile
.PHONY: test lint
test:
	pytest -q
lint:
	ruff check .
```

Менеджеры пакетов (npm, pip/poetry/uv, cargo, go mod) разрешают зависимости по диапазонам из манифеста, а **lockfile** фиксирует точные версии всего дерева. Lockfile приложения коммитят; в CI ставят строго по нему (`npm ci`, `poetry install --sync`, `pip install -r requirements.lock`).

## Semver и диапазоны

Версия MAJOR.MINOR.PATCH: MAJOR — несовместимые изменения, MINOR — новая функциональность, PATCH — исправления.

| Диапазон (npm) | Допускает |
|---|---|
| `^1.2.3` | `>=1.2.3 <2.0.0` |
| `~1.2.3` | `>=1.2.3 <1.3.0` |
| `^0.2.3` | `>=0.2.3 <0.3.0` |
| `1.2.3` | только `1.2.3` |

Для `0.y.z` API считается нестабильным, поэтому caret фиксирует самую левую ненулевую цифру.

## Окружения и Docker для локальной разработки

Менеджеры версий рантайма (pyenv, nvm, asdf/mise) переключают версию Python/Node по файлам `.python-version`, `.nvmrc`, `.tool-versions`. Виртуальные окружения (venv) изолируют пакеты проекта.

Docker Compose поднимает зависимости (БД, очередь, кэш) одной командой:

```yaml
services:
  app:
    build: .
    volumes: ["./src:/app/src"]   # hot reload
    env_file: .env
    depends_on:
      db: { condition: service_healthy }
  db:
    image: postgres:16
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 5s
```

Простой `depends_on` ждёт только старта контейнера, а не готовности сервиса. Секреты при сборке передают через BuildKit `--mount=type=secret`: значения `ARG`/`ENV` видны в `docker history`, а файл, удалённый следующим слоем, остаётся в предыдущем.

## Линтеры, форматтеры и хуки

- **Форматтер** (Prettier, Black, gofmt) меняет только стиль; **линтер** (ESLint, Ruff, golangci-lint) ищет баги и антипаттерны.
- **.editorconfig** — единые отступы, кодировка и EOL во всех редакторах.
- **pre-commit** — фреймворк хуков: `.pre-commit-config.yaml` + `pre-commit install`. Хуки обходятся через `--no-verify`, поэтому те же проверки обязательны в CI.
- Git-хуки из `.git/hooks` не клонируются; общий каталог подключают через `git config core.hooksPath .githooks` (так работает и husky).
- Секреты: `.env` в `.gitignore`, в репозитории — `.env.example`; сканеры вроде gitleaks ловят утечки до коммита.

Монорепозиторий даёт атомарные изменения через несколько проектов и простое переиспользование кода, но требует инструментов селективной сборки (Nx, Turborepo, Bazel). Polyrepo проще в правах доступа и независимых релизах, но тяжелее в синхронизации версий.

## Частые вопросы на собеседовании

- Зачем lockfile? → Воспроизводимая установка: одинаковые версии у всех и в CI.
- Чем `^` отличается от `~`? → `^` разрешает minor и patch, `~` — только patch.
- Почему pre-commit недостаточно? → Хуки можно не установить или обойти; источник правды — CI.
- `depends_on` не помогает, БД не готова? → Healthcheck и `condition: service_healthy`, плюс retry в приложении.
- Монорепо или polyrepo? → Монорепо для тесно связанных частей и атомарных изменений, polyrepo для независимых команд и релизов.

## Шпаргалка

```bash
set -euo pipefail
grep -rn pattern dir | rg pattern | jq -r '.a[].b'
make test                     # .PHONY для задач-команд
npm ci / poetry install       # строго по lockfile
pyenv local 3.12 / nvm use
docker compose up -d / logs -f / down -v
pre-commit install / pre-commit run --all-files
git config core.hooksPath .githooks
```
