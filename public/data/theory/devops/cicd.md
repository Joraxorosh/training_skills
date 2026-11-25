CI/CD автоматизирует путь кода от коммита до продакшена: сборка, тесты, проверки безопасности, публикация артефактов и деплой. На собеседовании ждут понимания терминов, устройства пайплайнов в GitHub Actions и GitLab CI, стратегий деплоя и безопасной работы с секретами.

## CI, Continuous Delivery и Continuous Deployment

- **Continuous Integration** — разработчики часто (минимум ежедневно) сливают изменения в общую ветку, и каждое слияние автоматически собирается и тестируется.
- **Continuous Delivery** — каждое изменение, прошедшее пайплайн, готово к релизу; выкатка в прод — **по ручному решению**.
- **Continuous Deployment** — выкатка в прод **полностью автоматическая**, без ручного шага.

Принцип **build once, deploy many**: артефакт (образ) собирается один раз и продвигается между окружениями dev → stage → prod. Так в прод попадает ровно то, что тестировалось, а различия задаются конфигурацией.

## GitHub Actions

Workflow лежат в `.github/workflows/*.yml`. Джобы по умолчанию выполняются **параллельно**; зависимость задаётся `needs`.

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
permissions:
  contents: read
  id-token: write          # для OIDC в облако
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python: ["3.11", "3.12"]
        os: [ubuntu-latest, windows-latest]   # 2 x 2 = 4 джобы
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: pip-${{ runner.os }}-${{ hashFiles('requirements.txt') }}
      - run: pytest
  build:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.meta.outputs.tag }}
    steps:
      - id: meta
        run: echo "tag=${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
  deploy:
    needs: [test, build]
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh ${{ needs.build.outputs.tag }}
        env:
          API_TOKEN: ${{ secrets.API_TOKEN }}
```

Кэш (`actions/cache`) ищется по точному `key`, затем по `restore-keys`; кэш неизменяем — при совпадении ключа он не перезаписывается. Кэш — для ускорения (зависимости), а **артефакты** — для передачи результатов между джобами и скачивания.

> Опасный паттерн: `pull_request_target` выполняется в контексте базового репозитория с доступом к секретам и токену с правами записи. Если в нём сделать checkout кода из PR форка и запустить его, злоумышленник выполнит свой код с вашими секретами.

## GitLab CI

Файл — `.gitlab-ci.yml` в корне. Джобы группируются в **stages**: стадии идут последовательно, джобы внутри одной стадии — параллельно. Стадии по умолчанию: `.pre`, `build`, `test`, `deploy`, `.post`. `needs:` позволяет строить DAG без ожидания всей стадии.

```yaml
stages: [build, test, deploy]
build:
  stage: build
  script: make build
  artifacts:
    paths: [dist/]
    expire_in: 1 week
test:
  stage: test
  script: make test
deploy:
  stage: deploy
  script: ./deploy.sh
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
  environment: production
```

`artifacts` сохраняет файлы после джобы и передаёт их джобам следующих стадий. `rules` проверяются по порядку, срабатывает первое совпадение; если ни одно не совпало — джоба не добавляется.

## Стратегии деплоя

| Стратегия | Суть | Плюсы / минусы |
|---|---|---|
| Recreate | Остановить старое, запустить новое | Просто, но простой |
| Rolling update | Постепенная замена подов (`maxSurge`, `maxUnavailable`) | Без простоя, две версии одновременно |
| Blue-green | Два полных окружения, переключение трафика целиком | Мгновенный откат, двойные ресурсы |
| Canary | Новая версия получает малую долю трафика, затем больше | Минимальный риск, нужны метрики и автоматика |

> Для blue-green и rolling самый тонкий момент — **схема БД**: обе версии приложения работают с одной базой. Миграции делают обратно совместимыми (паттерн expand/contract): сначала добавить колонку, потом перевести код, потом удалить старое.

## Секреты и безопасность пайплайна

- Хранить секреты в secret store CI (GitHub Secrets, GitLab masked/protected variables) или во внешнем Vault, не в репозитории.
- Использовать **OIDC** вместо долгоживущих ключей: в GitHub Actions нужно `permissions: id-token: write`, облако выдаёт краткоживущие креды по доверенному токену.
- Минимальные `permissions` для `GITHUB_TOKEN`, пиннинг сторонних actions по SHA.
- Защищённые ветки и окружения с ручным approve для прода.

## Версионирование и прослеживаемость

**SemVer** `MAJOR.MINOR.PATCH`: исправление бага без изменения API → PATCH (`2.4.1` → `2.4.2`), новая обратно совместимая функциональность → MINOR, ломающие изменения → MAJOR.

Воспроизводимость: теги образов по git SHA или версии (не `latest`), деплой по digest, неизменяемые теги в registry, подпись образов и SBOM.

## GitOps

Желаемое состояние кластера хранится в Git; агент (Argo CD, Flux) в кластере **сам тянет** (pull) изменения и постоянно сверяет состояние. Ручной `kubectl scale` будет обнаружен как drift и при включённом self-heal откатится к значению из Git.

## Частые вопросы на собеседовании

- Delivery vs Deployment? → Ручной vs автоматический шаг выкатки в прод.
- Blue-green vs canary? → Переключение всего трафика vs постепенная доля трафика.
- Где лежат workflow GitHub Actions? → `.github/workflows/`.
- Как джобы GitLab выполняются по умолчанию? → Стадии последовательно, джобы в стадии параллельно.
- Как безопасно ходить в облако из CI? → OIDC с краткоживущими токенами.
- Зачем build once? → В прод попадает именно протестированный артефакт.

## Шпаргалка

- GitHub: `.github/workflows`, `needs`, `matrix`, `${{ secrets.X }}`, `$GITHUB_OUTPUT`, `needs.job.outputs.x`
- GitLab: `.gitlab-ci.yml`, `stages`, `artifacts`, `rules`, `needs`, `when: manual`
- Деплой: recreate, rolling, blue-green, canary
- SemVer: MAJOR.MINOR.PATCH
- Секреты: secret store, OIDC, минимальные permissions, не логировать
- Образы: тег = SHA, деплой по digest, build once deploy many
