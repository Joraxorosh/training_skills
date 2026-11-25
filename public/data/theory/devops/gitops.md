Helm — пакетный менеджер Kubernetes: шаблонизирует манифесты и управляет релизами. GitOps — подход, при котором желаемое состояние кластера хранится в Git, а специальный агент (Argo CD или Flux) непрерывно приводит кластер к этому состоянию. На собеседовании проверяют устройство чарта и работу с values, жизненный цикл релиза, принципы GitOps, ресурсы Argo CD и стратегии работы с несколькими окружениями.

## Helm: чарты, values, релизы

**Chart** — пакет: шаблоны манифестов + значения по умолчанию + метаданные. **Release** — установленный экземпляр чарта в кластере с собственным именем и историей ревизий. Helm 3 работает без серверного компонента (Tiller удалён), данные релиза хранятся в Secret в namespace релиза.

```text
mychart/
  Chart.yaml        # name, version (чарта), appVersion (приложения), dependencies
  values.yaml       # значения по умолчанию
  templates/        # шаблоны Go template + функции Sprig
    deployment.yaml
    _helpers.tpl    # именованные шаблоны (define/include)
  charts/           # зависимости
```

```yaml
# templates/deployment.yaml (фрагмент)
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: app
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          {{- with .Values.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
```

Приоритет значений (от низшего к высшему): `values.yaml` чарта → values родительского чарта → файлы `-f` (последний побеждает) → `--set`/`--set-string`.

## Основные команды Helm

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami && helm repo update
helm install web ./mychart -n prod --create-namespace -f values-prod.yaml
helm upgrade --install web ./mychart -f values-prod.yaml --atomic --wait
helm list -A
helm history web -n prod
helm rollback web 3 -n prod
helm template web ./mychart -f values-prod.yaml   # отрендерить локально
helm lint ./mychart
helm diff upgrade web ./mychart                   # плагин helm-diff
helm uninstall web -n prod
helm push mychart-1.2.0.tgz oci://ghcr.io/org/charts   # OCI-реестр
```

- `upgrade --install` — идемпотентная команда для CI: установит, если релиза нет.
- `--atomic` — при неудаче автоматически откатывает релиз (подразумевает `--wait`). В Helm 4 (ноябрь 2025) флаг переименован в `--rollback-on-failure`, а `--wait` по умолчанию использует kstatus-проверку готовности.
- **Hooks** (`helm.sh/hook: pre-upgrade`) — например, Job миграции БД перед обновлением.
- Чарты всё чаще распространяются через **OCI-реестры** вместо классических index.yaml-репозиториев.

> Частая ловушка: `helm rollback` откатывает манифесты, но не данные и не схему БД. А в GitOps-режиме ручной `helm upgrade` будет перезаписан агентом при следующей синхронизации — правка должна идти через Git.

## Принципы GitOps

Принципы OpenGitOps:

1. **Декларативность** — желаемое состояние описано декларативно.
2. **Версионирование и неизменяемость** — состояние хранится в Git с полной историей.
3. **Pull-модель** — агенты сами вытягивают желаемое состояние из источника.
4. **Непрерывная сверка (reconciliation)** — агенты постоянно сравнивают фактическое состояние с желаемым и устраняют расхождения (drift).

| | Push (классический CI/CD) | Pull (GitOps) |
|---|---|---|
| Кто применяет | CI-раннер (`kubectl apply`, `helm upgrade`) | Агент внутри кластера |
| Доступ к кластеру | Креды кластера в CI | CI не нужен доступ к кластеру |
| Drift | Не обнаруживается | Обнаруживается и исправляется |
| Откат | Перезапуск старого пайплайна | `git revert` |

Обычно разделяют репозиторий приложения (код, Dockerfile, CI собирает образ) и **репозиторий конфигурации** (манифесты/values для окружений). CI после сборки обновляет тег образа в конфиг-репозитории коммитом или PR, либо это делает Argo CD Image Updater / Flux Image Automation.

## Argo CD

Argo CD — GitOps-контроллер с веб-интерфейсом. Основной ресурс — **Application**: откуда брать манифесты (repo, path, revision; поддерживает plain YAML, Helm, Kustomize) и куда применять.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: web-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/deploy.git
    targetRevision: main
    path: apps/web
    helm:
      valueFiles: [values-prod.yaml]
  destination:
    server: https://kubernetes.default.svc
    namespace: prod
  syncPolicy:
    automated:
      prune: true       # удалять ресурсы, которых больше нет в Git
      selfHeal: true    # откатывать ручные изменения в кластере
    syncOptions: [CreateNamespace=true]
```

Статусы: **Sync status** — Synced / OutOfSync (совпадает ли кластер с Git); **Health status** — Healthy / Progressing / Degraded / Missing. Без `automated` синхронизация запускается вручную. Без `selfHeal` ручной `kubectl scale` покажет OutOfSync, но не будет откатан автоматически.

- **AppProject** — ограничения: разрешённые репозитории, кластеры, namespace, типы ресурсов; основа мультиарендности.
- **App of Apps** — корневое Application, которое создаёт другие Application.
- **ApplicationSet** — генерирует Application из шаблона по генераторам (список кластеров, каталоги в Git, PR) — удобно для множества окружений и кластеров.
- **Sync waves и hooks** (`argocd.argoproj.io/sync-wave`) задают порядок применения: например, сначала CRD и миграции, потом приложение.
- Для прогрессивных выкаток используют **Argo Rollouts** (canary, blue-green с анализом метрик).

## Flux и секреты в GitOps

**Flux** — альтернатива без обязательного UI, набор контроллеров: `GitRepository`/`OCIRepository` (источник), `Kustomization` (применение), `HelmRelease` (управление Helm-релизами). Argo CD и Flux — проекты CNCF graduated.

Секреты в Git открытым текстом хранить нельзя. Варианты: **Sealed Secrets**, **SOPS** (Flux умеет расшифровывать нативно, для Argo CD — плагины), **External Secrets Operator** с Vault или облачным менеджером секретов.

## Kustomize и окружения

**Kustomize** (встроен в `kubectl apply -k`) работает без шаблонов: базовые манифесты + overlays с патчами для окружений.

```text
base/          deployment.yaml, service.yaml, kustomization.yaml
overlays/dev/  kustomization.yaml (replicas: 1, image tag)
overlays/prod/ kustomization.yaml (replicas: 5, resources)
```

Продвижение между окружениями в GitOps — это изменение в Git (коммит/PR в каталог следующего окружения), а не перезапуск пайплайна. Для окружений предпочитают каталоги или отдельные репозитории, а не долгоживущие ветки на каждое окружение.

## Частые вопросы на собеседовании

- Что такое Helm release? → Установленный экземпляр чарта с историей ревизий.
- Как переопределить values? → `-f values.yaml` (последний файл побеждает) и `--set` (самый высокий приоритет).
- Push vs pull деплой? → В pull агент в кластере сам тянет состояние из Git, CI не нужны креды кластера.
- Что делают prune и selfHeal? → Удаляют ресурсы, исчезнувшие из Git, и откатывают ручные изменения.
- Как откатиться в GitOps? → `git revert` коммита в конфиг-репозитории.
- Как хранить секреты в GitOps? → Sealed Secrets, SOPS или External Secrets Operator.

## Шпаргалка

- Chart = Chart.yaml + values.yaml + templates/; release = установка чарта
- `helm upgrade --install --atomic -f values.yaml`, `helm template`, `helm history`, `helm rollback`
- Приоритет: values.yaml < `-f` < `--set`
- GitOps: декларативно, в Git, pull, непрерывная сверка
- Argo CD: Application, AppProject, ApplicationSet, App of Apps, sync waves
- `syncPolicy.automated: {prune: true, selfHeal: true}`; Synced/OutOfSync, Healthy/Degraded
- Flux: GitRepository, Kustomization, HelmRelease
- Kustomize: base + overlays; секреты — Sealed Secrets / SOPS / ESO
