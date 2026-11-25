DevSecOps встраивает безопасность в каждый этап поставки: от кода и зависимостей до образов, кластера и рантайма. На собеседовании проверяют виды сканирования (SAST, DAST, SCA), управление секретами, безопасность цепочки поставок (SBOM, подписи, SLSA), защиту Kubernetes и типовые атаки вроде SSRF.

## Принципы

- **Least privilege** — сервисный аккаунт получает только те права, которые нужны для его задачи, в минимальной области (namespace, ресурс) и, по возможности, на ограниченное время.
- **Defense in depth** — несколько независимых слоёв защиты.
- **Shift-left** — проверки максимально рано: в IDE, pre-commit, CI.
- **Zero Trust** — не доверять сети: каждый запрос аутентифицируется и авторизуется.

## Виды тестирования безопасности

| Вид | Что проверяет | Когда | Примеры |
|---|---|---|---|
| SAST | Исходный код без запуска (white-box) | Рано, в CI на PR | Semgrep, CodeQL, SonarQube |
| DAST | Запущенное приложение снаружи (black-box) | На стенде | OWASP ZAP, Burp |
| SCA | Сторонние зависимости на известные CVE и лицензии | В CI | Dependabot, Snyk, Trivy, Grype |
| Secret scanning | Ключи и пароли в коде и истории | pre-commit, CI | gitleaks, trufflehog |
| IaC scanning | Ошибки конфигурации Terraform, K8s | В CI | Checkov, tfsec/Trivy config |

```bash
trivy image nginx:1.27                      # уязвимости в образе
trivy image --severity HIGH,CRITICAL --exit-code 1 app:1.0  # упасть в CI при находках
trivy fs . ; trivy config ./terraform
```

Во втором примере шаг завершится с ошибкой, только если найдены уязвимости уровня HIGH или CRITICAL.

## Уязвимости и приоритизация

Шкала **CVSS v3**: 0.1–3.9 Low, 4.0–6.9 Medium, 7.0–8.9 High, **9.0–10.0 Critical**. Но базовая оценка — не всё: приоритет зависит от того, достижим ли уязвимый код, доступен ли сервис извне, есть ли эксплойт в дикой природе (**CISA KEV**, вероятность эксплуатации **EPSS**) и есть ли исправление. Уязвимость с CVSS 7.5 в публичном сервисе с активным эксплойтом важнее 9.8 в неиспользуемой библиотеке.

## Секреты

> Если действующий ключ попал в публичный репозиторий, **первым делом его отзывают и ротируют**. Удаление коммита или переписывание истории не помогает: ключ уже могли скопировать боты за секунды. Затем — проверка логов на использование и очистка истории.

Способы хранения:

- **HashiCorp Vault / OpenBao** — централизованное хранилище; **dynamic secrets** (например, database secrets engine создаёт временного пользователя PostgreSQL с TTL под каждый запрос и сам его удаляет).
- **SOPS** — шифрует **значения** в YAML/JSON, оставляя ключи читаемыми; файл можно хранить в Git, расшифровать может только владелец ключа (age, PGP, KMS).
- **Sealed Secrets** — `SealedSecret` зашифрован публичным ключом контроллера; расшифровать может только контроллер в кластере своим приватным ключом. Поэтому его безопасно хранить в Git.
- **External Secrets Operator** — синхронизирует секреты из Vault/AWS Secrets Manager в Kubernetes.
- При сборке образов — `RUN --mount=type=secret` в BuildKit, а не `ARG`/`ENV`/`COPY`, которые остаются в слоях и истории.

## Цепочка поставок

- **SBOM** — список компонентов ПО. Стандартные форматы: **SPDX** и **CycloneDX**. Генерация: `syft`, `trivy --format cyclonedx`.
- **Подпись образов cosign (Sigstore)**. При keyless-подписи CI получает OIDC-токен, **Fulcio** выдаёт краткоживущий сертификат, привязанный к идентичности (например, workflow GitHub), а **Rekor** — публичный прозрачный журнал, где фиксируется факт подписи.
- При проверке keyless-подписи указывают и `--certificate-identity`, и `--certificate-oidc-issuer`: иначе подпись, сделанная любым другим workflow или издателем, тоже прошла бы проверку.

```bash
cosign verify ghcr.io/org/app@sha256:... \
  --certificate-identity-regexp 'https://github.com/org/app/.github/workflows/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

- **SLSA provenance** — подписанная аттестация о том, **как, где и из чего** собран артефакт: исходный репозиторий и коммит, билд-система, параметры сборки.

## Безопасность Kubernetes

- **Pod Security Admission**: метка `pod-security.kubernetes.io/enforce: restricted` отклоняет поды с privileged, hostNetwork/hostPID, hostPath, запуском от root, без `allowPrivilegeEscalation: false`, без `seccompProfile` RuntimeDefault и без `capabilities.drop: ["ALL"]`.
- **NetworkPolicy**: как только под выбран хотя бы одной политикой с типом Ingress, разрешён только явно указанный входящий трафик. Пустой `podSelector: {}` с `policyTypes: [Ingress]` без правил — default deny для namespace. Работает только если CNI поддерживает политики (Calico, Cilium).
- В правиле `from` элементы списка объединяются по ИЛИ, а `namespaceSelector` и `podSelector` **в одном элементе** — по И.
- **Encryption at rest** для Secret в etcd: `EncryptionConfiguration` на kube-apiserver. Первый провайдер в списке используется для записи, остальные — для чтения; существующие Secret перешифровываются только при перезаписи. Если первым стоит `identity`, новые данные пишутся без шифрования.
- RBAC по минимуму, отдельные ServiceAccount, `automountServiceAccountToken: false`, где токен не нужен.

## Сеть и инфраструктура

**mTLS** — обе стороны предъявляют сертификаты и проверяют друг друга; в обычном TLS аутентифицируется только сервер. Используется в service mesh (Istio, Linkerd) для Zero Trust между сервисами.

Укрепление SSH в `/etc/ssh/sshd_config`:

```text
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
AllowUsers deploy
```

**SSRF** — сервер по URL от пользователя делает запрос, и злоумышленник подставляет внутренний адрес, например `http://169.254.169.254/` (метаданные облака с временными ключами IAM). Защита: allowlist доменов, запрет приватных и link-local диапазонов после резолва, IMDSv2 с обязательным токеном и hop limit.

Ошибка «unable to get local issuer certificate» в curl при работающем браузере — сервер не отдаёт промежуточный сертификат; нужно настроить полную цепочку.

## Частые вопросы на собеседовании

- SAST vs DAST? → Анализ кода без запуска vs тестирование работающего приложения снаружи.
- Что делает SCA? → Ищет известные уязвимости и проблемы лицензий в зависимостях.
- Ключ утёк в Git — что делать первым? → Отозвать и ротировать.
- Почему SealedSecret можно хранить в Git? → Расшифровать его может только контроллер в кластере.
- Форматы SBOM? → SPDX и CycloneDX.
- mTLS vs TLS? → Взаимная аутентификация клиента и сервера.

## Шпаргалка

- CVSS: 9.0+ Critical, 7.0–8.9 High; учитывать KEV, EPSS, достижимость
- SAST, DAST, SCA, secret scanning, IaC scanning
- `trivy image --severity HIGH,CRITICAL --exit-code 1 img`
- Секреты: Vault dynamic secrets, SOPS, Sealed Secrets, ESO, BuildKit secrets
- Supply chain: SBOM (SPDX/CycloneDX), cosign + Fulcio + Rekor, SLSA provenance
- K8s: PSA restricted, NetworkPolicy default deny, encryption at rest, RBAC
- SSH: без root и паролей; SSRF → блок 169.254.169.254, IMDSv2
