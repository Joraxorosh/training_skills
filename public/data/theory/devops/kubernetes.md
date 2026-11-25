Kubernetes — оркестратор контейнеров: он поддерживает желаемое состояние, описанное в манифестах, — запускает поды на нодах, перезапускает упавшие, масштабирует и обновляет без простоя. На собеседовании проверяют архитектуру кластера, основные объекты, пробы, ресурсы и QoS, сеть (Service, Ingress), RBAC и планирование.

## Архитектура кластера

| Компонент | Где | Роль |
|---|---|---|
| kube-apiserver | control plane | Единая точка входа в API, аутентификация, валидация |
| etcd | control plane | Key-value хранилище **всего состояния кластера** |
| kube-scheduler | control plane | Выбирает ноду для пода |
| kube-controller-manager | control plane | Контроллеры, приводящие факт к желаемому состоянию |
| kubelet | каждая нода | Запускает контейнеры пода через container runtime (containerd, CRI-O) и докладывает статус |
| kube-proxy | каждая нода | Правила iptables/IPVS для Service (некоторые CNI, например Cilium, заменяют его) |

Начиная с 1.24 dockershim удалён: Kubernetes работает с runtime через CRI, обычно containerd.

## Рабочие нагрузки

**Pod** — минимальная единица развёртывания: один или несколько контейнеров с общей сетью и томами. Напрямую поды почти не создают — ими управляют контроллеры:

| Контроллер | Для чего |
|---|---|
| Deployment | Stateless-приложения, rolling update, откат |
| StatefulSet | Стабильные имена (`db-0`, `db-1`), упорядоченный запуск, свой PVC на под |
| DaemonSet | Один под на каждой подходящей ноде (агенты логов, мониторинга, CNI) |
| Job / CronJob | Разовые и периодические задачи |

Rolling update управляется `maxSurge` (сколько подов можно создать сверх `replicas`) и `maxUnavailable` (сколько может быть недоступно). При `replicas: 10`, `maxSurge: 25%` максимум подов — 13 (25% от 10 = 2.5, surge округляется вверх).

```bash
kubectl get pods -n kube-system
kubectl describe pod web
kubectl logs web --previous        # логи предыдущего упавшего контейнера
kubectl rollout status deploy/web
kubectl rollout undo deploy/web    # откат к предыдущей ревизии
kubectl port-forward pod/web 8080:80
kubectl exec -it web -- sh
```

## Пробы

- **livenessProbe** — провал → kubelet **перезапускает** контейнер.
- **readinessProbe** — провал → под **исключается из endpoints Service**, но не перезапускается.
- **startupProbe** — пока не пройдёт, liveness и readiness не выполняются; для медленно стартующих приложений.

> Частая ошибка: делать liveness зависимой от базы данных. Если БД недоступна, Kubernetes начнёт перезапускать все поды, усугубляя аварию. Зависимости проверяют в readiness, а liveness — только «процесс жив».

## Ресурсы, QoS и автомасштабирование

`requests` — гарантированный объём, по нему планировщик выбирает ноду. `limits` — потолок. Превышение лимита по **памяти** → контейнер убивается (**OOMKilled**); по **CPU** → троттлинг.

| QoS-класс | Условие |
|---|---|
| Guaranteed | У всех контейнеров requests = limits по CPU и памяти |
| Burstable | Заданы requests или limits хотя бы где-то, но не Guaranteed |
| BestEffort | Ничего не задано; вытесняется первым |

**HPA** масштабирует по метрикам (нужен metrics-server). Если в TARGETS `<unknown>/50%` — обычно нет metrics-server или у контейнеров не заданы `requests.cpu` (процент считается от requests).

## Сеть: Service и Ingress

| Тип Service | Доступ |
|---|---|
| ClusterIP | Только внутри кластера (по умолчанию) |
| NodePort | Статический порт (30000–32767) на каждой ноде |
| LoadBalancer | Внешний балансировщик облака |
| Headless (`clusterIP: None`) | DNS отдаёт IP подов напрямую, для StatefulSet |

**Ingress** — L7-правила маршрутизации HTTP. Сам по себе ничего не делает: нужен **Ingress Controller** (ingress-nginx, Traefik и др.). Новый стандарт — **Gateway API** (Gateway, HTTPRoute).

## Конфигурация и хранение

- **ConfigMap** — несекретная конфигурация (env, файлы).
- **Secret** — данные в **base64, это не шифрование**. По умолчанию в etcd лежат открыто; нужно включать encryption at rest и ограничивать доступ RBAC.
- **PV/PVC/StorageClass** — PVC запрашивает том, StorageClass создаёт PV динамически. `reclaimPolicy: Retain` — после удаления PVC том и данные сохраняются (PV переходит в Released, повторно не привязывается автоматически); `Delete` — удаляются.

## RBAC и планирование

RBAC: **Role** (права в namespace) + **RoleBinding** (кому). **ClusterRole/ClusterRoleBinding** — на уровне кластера. Чтобы ServiceAccount `ci` читал поды только в `dev`: Role с `get, list, watch` на `pods` в `dev` + RoleBinding в `dev`.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: pod-reader, namespace: dev }
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
```

Планирование:

- **taint** на ноде отталкивает поды; **toleration** разрешает поду туда попасть, но **не притягивает** его. Чтобы под шёл именно на ноду — нужен ещё nodeSelector/nodeAffinity.
- **podAntiAffinity** с `requiredDuringScheduling...` по `kubernetes.io/hostname` — не более одного пода на ноду; 4 реплики на 3 нодах → одна останется Pending.
- Pending + FailedScheduling: не хватает requests, taint без toleration, affinity, PVC не привязан.

## Частые вопросы на собеседовании

- Что хранится в etcd? → Всё состояние кластера (все объекты API).
- liveness vs readiness? → Перезапуск vs исключение из балансировки.
- Что будет при превышении memory limit? → OOMKilled и рестарт.
- Deployment vs StatefulSet? → StatefulSet даёт стабильные имена, порядок и персональные тома.
- Ingress не работает, ошибок нет? → Нет Ingress Controller или неверный ingressClassName.
- Secret зашифрован? → Нет, base64; нужен encryption at rest/внешний менеджер секретов.

## Шпаргалка

- `kubectl get/describe/logs --previous/exec -it/port-forward`
- `kubectl rollout status|history|undo deploy/x`
- `kubectl top pod` (metrics-server), `kubectl get events --sort-by=.lastTimestamp`
- Pod → ReplicaSet → Deployment; StatefulSet; DaemonSet; Job/CronJob
- startup → liveness (рестарт), readiness (трафик)
- QoS: Guaranteed / Burstable / BestEffort
- Service: ClusterIP / NodePort / LoadBalancer / Headless
- Role+RoleBinding, taint+toleration, affinity
