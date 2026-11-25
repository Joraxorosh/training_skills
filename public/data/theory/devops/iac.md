Infrastructure as Code — описание инфраструктуры в виде кода, который хранится в Git, ревьюится и применяется автоматически. Terraform (и его открытый форк OpenTofu) создаёт облачные ресурсы, Ansible настраивает серверы. На собеседовании проверяют жизненный цикл Terraform, работу со state, модули и мета-аргументы, а также устройство Ansible: inventory, плейбуки, handlers, идемпотентность.

## Декларативность и идемпотентность

**Идемпотентность** — повторное применение одной и той же конфигурации даёт тот же результат и не вносит лишних изменений. Terraform декларативен: вы описываете желаемое состояние, он вычисляет разницу. Ansible в основном декларативен на уровне модулей, но порядок задач важен.

| | Terraform / OpenTofu | Ansible |
|---|---|---|
| Основная задача | Provisioning (создание ресурсов) | Configuration management |
| Подход | Декларативный, граф зависимостей | Процедурные задачи из идемпотентных модулей |
| Состояние | state-файл | Без state, проверяет факт на хосте |
| Подключение | API провайдеров | SSH (Linux), WinRM (Windows), без агента |

## Жизненный цикл Terraform

```bash
terraform init       # скачать провайдеры и модули, настроить backend
terraform fmt && terraform validate
terraform plan       # показать, что будет создано/изменено/удалено; ничего не меняет
terraform apply
terraform destroy
terraform apply -refresh-only   # обновить state по реальности, не меняя ресурсы
```

В `plan` символы: `+` создание, `~` изменение на месте, `-` удаление, `-/+` **замена** (удалить и создать). Если меняется атрибут, требующий пересоздания (например, `ami` у инстанса), будет `-/+`. Порядок можно изменить через `lifecycle { create_before_destroy = true }`.

## State и backend

State связывает ресурсы в коде с реальными объектами (ID), хранит атрибуты и зависимости, ускоряет планирование. Он может содержать **секреты в открытом виде**, поэтому его хранят в удалённом backend с шифрованием и ограниченным доступом.

```hcl
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }  # >= 5.0, < 6.0
  }
  backend "s3" {
    bucket         = "tf-state-prod"
    key            = "network/terraform.tfstate"
    region         = "eu-central-1"
    encrypt        = true
    dynamodb_table = "tf-locks"     # блокировка state
  }
}
```

`dynamodb_table` нужен для **блокировки**: два одновременных apply не испортят state. В новых версиях есть `use_lockfile = true` — нативная блокировка в S3.

**Drift** — реальность разошлась с кодом (кто-то поменял инстанс в консоли). Следующий `plan` покажет изменение, а `apply` вернёт значение из кода.

> Не коммитьте в Git: `terraform.tfstate*`, каталог `.terraform/`, `*.tfvars` с секретами. Коммитьте `.terraform.lock.hcl` — он фиксирует версии провайдеров.

## Переменные, count и for_each

Приоритет переменных (от низшего к высшему): default в `variable` → переменные окружения `TF_VAR_x` → `terraform.tfvars` → `*.auto.tfvars` → `-var` и `-var-file` в командной строке (побеждает последний).

```hcl
resource "aws_iam_user" "u" {
  for_each = toset(["alice", "bob"])
  name     = each.key
}
# адрес: aws_iam_user.u["bob"]
```

С `count` ресурсы адресуются индексом: `aws_iam_user.u[0]`. Если из `["a","b","c"]` удалить `"a"`, индексы сдвигаются, и Terraform **пересоздаст/переименует** b и c. `for_each` по ключам этой проблемы не имеет.

## Модули, workspaces, рефакторинг

**Модуль** — каталог с `.tf`-файлами, переиспользуемый через блок `module` с входами (variables) и выходами (outputs). **Workspace** (`terraform workspace new staging`) — отдельный state для той же конфигурации; для серьёзного разделения окружений чаще используют отдельные каталоги/backend.

```hcl
moved {
  from = aws_instance.web
  to   = aws_instance.app
}

import {               # Terraform 1.5+: импорт в коде
  to = aws_s3_bucket.logs
  id = "my-logs-bucket"
}
```

Переименование ресурса без пересоздания: блок `moved` или `terraform state mv`. Блок `import` вместе с `terraform plan -generate-config-out=gen.tf` позволяет взять под управление существующий ресурс.

## Ansible

**Inventory** — список управляемых хостов и групп (INI/YAML или динамический из облака). Ansible работает **без агента**, по SSH, и требует Python на целевых Linux-хостах.

```yaml
- hosts: web
  become: true
  serial: 3                  # батчами по 3 хоста: 3, 3, 3, 1
  tasks:
    - name: Install nginx
      ansible.builtin.apt: { name: nginx, state: present }
    - name: Config
      ansible.builtin.template: { src: nginx.conf.j2, dest: /etc/nginx/nginx.conf }
      notify: restart nginx
  handlers:
    - name: restart nginx
      ansible.builtin.service: { name: nginx, state: restarted }
```

**Handler** выполняется **один раз в конце play** (или при `meta: flush_handlers`), только если хотя бы одна задача с `notify` вернула `changed`.

Задачи `command`/`shell` всегда сообщают `changed`, потому что Ansible не знает, что они сделали. Исправляют через `creates`/`removes` или `changed_when`. Без `serial` Ansible идёт по всем хостам параллельно (ограничено `forks`, по умолчанию 5).

**Ansible Vault** шифрует секреты (файлы или переменные) в репозитории: `ansible-vault encrypt secrets.yml`, запуск с `--ask-vault-pass` или `--vault-password-file`.

## Частые вопросы на собеседовании

- Зачем state? → Сопоставление кода с реальными ресурсами, метаданные, производительность.
- Что делает plan? → Вычисляет и показывает изменения, ничего не применяя.
- count vs for_each? → for_each адресует по ключу, удаление элемента не сдвигает остальные.
- Что значит `~> 5.0`? → Любая 5.x, но не 6.0.
- Когда выполнится handler? → В конце play, если notify-задача была changed.
- Как Ansible подключается к хостам? → По SSH, без агента.

## Шпаргалка

- `init → validate → plan → apply`, `destroy`, `apply -refresh-only`
- Remote backend + lock (DynamoDB / `use_lockfile`), шифрование state
- Не коммитить state, `.terraform/`, секретные tfvars; коммитить `.terraform.lock.hcl`
- `moved`, `import`, `terraform state mv/rm/list`
- `for_each` вместо `count` для коллекций
- OpenTofu — открытый форк Terraform (MPL), совместимые команды `tofu`
- Ansible: inventory, playbook, role, handler, `serial`, `changed_when`, `ansible-vault`
