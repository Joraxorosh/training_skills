systemd — система инициализации и менеджер сервисов почти во всех современных дистрибутивах. Он запускается первым процессом (PID 1), поднимает сервисы по зависимостям, следит за ними, перезапускает упавшие и собирает логи в journald. На собеседовании проверяют порядок загрузки, устройство unit-файлов, разницу между `Wants`, `Requires` и `After`, работу с `journalctl` и выбор между cron и таймерами.

## Процесс загрузки

1. **UEFI/BIOS** инициализирует оборудование и находит загрузчик.
2. **Загрузчик (GRUB)** загружает ядро и initramfs, передаёт параметры командной строки ядра.
3. **Ядро** инициализирует драйверы и распаковывает **initramfs** — временный корень с модулями и утилитами для монтирования настоящего корня (LVM, RAID, LUKS).
4. Запускается **systemd** (PID 1).
5. systemd поднимает юниты до `default.target` (обычно `multi-user.target` или `graphical.target`).

```bash
systemd-analyze               # время загрузки по этапам
systemd-analyze blame         # самые медленные юниты
systemctl get-default
systemctl isolate rescue.target
```

| Target | Аналог runlevel | Назначение |
|---|---|---|
| `rescue.target` | 1 | Однопользовательский режим |
| `multi-user.target` | 3 | Сервер без GUI |
| `graphical.target` | 5 | С графическим интерфейсом |
| `reboot.target` | 6 | Перезагрузка |

## Unit-файлы и типы сервисов

Юниты бывают разных типов: `.service`, `.socket`, `.timer`, `.target`, `.mount`, `.path`. Пакетные лежат в `/usr/lib/systemd/system`, локальные и переопределения — в `/etc/systemd/system` (у них приоритет).

```ini
[Unit]
Description=My API
Wants=postgresql.service
After=network-online.target postgresql.service

[Service]
Type=simple
User=app
ExecStart=/opt/app/bin/server --port 8080
Restart=on-failure
RestartSec=5s
LimitNOFILE=65535
Environment=APP_ENV=prod

[Install]
WantedBy=multi-user.target
```

| `Type=` | Когда сервис считается запущенным |
|---|---|
| `simple` (по умолчанию) | Сразу после `fork` |
| `exec` | После успешного `exec` бинарника |
| `forking` | Когда родитель завершился (демон ушёл в фон), PID из `PIDFile=` |
| `oneshot` | Когда процесс завершился (для скриптов) |
| `notify` | Когда демон сам сообщил о готовности через `sd_notify` |

После изменения unit-файлов нужен `systemctl daemon-reload`. Пакетный юнит правят через drop-in: `systemctl edit nginx` создаёт `/etc/systemd/system/nginx.service.d/override.conf`, который переживает обновление пакета. Итоговую конфигурацию показывает `systemctl cat nginx`.

## Управление сервисами и перезапуски

```bash
systemctl start|stop|restart|reload nginx
systemctl enable --now nginx      # автозапуск + запуск сейчас
systemctl status nginx
systemctl is-enabled nginx; systemctl is-active nginx
systemctl mask bluetooth          # симлинк на /dev/null, запуск невозможен
systemctl list-units --failed
systemctl reset-failed app
```

`enable` только создаёт симлинк в `*.wants/` целевого target, но не запускает сервис. `disable` убирает автозапуск, а `mask` полностью запрещает запуск, в том числе как зависимости.

`Restart=on-failure` перезапускает при ненулевом коде, смерти от сигнала, таймауте и срабатывании watchdog; `Restart=always` — ещё и после выхода с кодом 0. Ручной `systemctl stop` перезапуск не вызывает. Защита от бесконечного цикла — `StartLimitIntervalSec=` и `StartLimitBurst=` (по умолчанию 5 запусков за 10 с), после чего юнит переходит в `failed` с сообщением `Start request repeated too quickly`.

При `systemctl stop` все процессы cgroup юнита получают SIGTERM (`KillMode=control-group`), а через `TimeoutStopSec` (90 с по умолчанию) — SIGKILL.

## Зависимости

- `Wants=` — слабая зависимость: подтянуть юнит, но не падать без него.
- `Requires=` — жёсткая: если зависимость остановлена, юнит тоже останавливается.
- `After=` / `Before=` — **только порядок**, зависимость они не создают.

> Частая ошибка — написать только `After=postgresql.service`. Тогда postgresql не будет запущен вместе с приложением, если его не запустил кто-то другой. Правильно — пара `Wants=` (или `Requires=`) + `After=`.

## Журналы: journalctl и logrotate

```bash
journalctl -u nginx -f                    # хвост логов сервиса
journalctl -u nginx --since "1 hour ago"  # или --since -1h
journalctl -b -1 -p err                   # ошибки и хуже за прошлую загрузку
journalctl -k                             # сообщения ядра
journalctl --disk-usage
journalctl --vacuum-size=500M
```

`-p err` показывает этот уровень и более серьёзные. По умолчанию (`Storage=auto`) журнал хранится на диске, только если существует `/var/log/journal`, иначе — в `/run/log/journal` и теряется при перезагрузке.

Текстовые логи ротирует **logrotate**:

```
/var/log/app/*.log {
    daily
    rotate 14
    compress
    missingok
    postrotate
        systemctl kill -s HUP app.service
    endscript
}
```

Без `copytruncate` файл переименовывается, а приложение должно переоткрыть лог (обычно по сигналу). `copytruncate` копирует и обрезает файл — подходит приложениям, которые не умеют переоткрывать логи, но может потерять строки.

## cron и systemd-таймеры

```bash
# минута час день месяц день_недели
0 3 * * 1   /usr/local/bin/backup.sh       # понедельник 03:00
*/15 * * * * /usr/local/bin/check.sh       # каждые 15 минут
```

Типичные проблемы cron: урезанный `PATH`, нет переменных из `.bashrc`, рабочий каталог — домашний, `%` нужно экранировать (`\%`).

```ini
# backup.timer
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
```

Таймер запускает одноимённый `backup.service`. Преимущества: логи в journal, `Persistent=true` догоняет пропущенный запуск, доступны зависимости и лимиты ресурсов. Посмотреть таймеры — `systemctl list-timers`, проверить расписание — `systemd-analyze calendar`.

## Частые вопросы на собеседовании

- Чем `enable` отличается от `start`? → Автозапуск при загрузке против запуска сейчас.
- `After=` подтягивает зависимость? → Нет, только задаёт порядок.
- Как переопределить пакетный юнит? → `systemctl edit` (drop-in) + перезапуск.
- Сервис упал и не перезапускается? → Сработал StartLimit, нужен `reset-failed` и исправление причины.
- Почему пропали логи после перезагрузки? → Нет `/var/log/journal`, журнал хранился в RAM.
- cron или таймер? → Таймер: логи, догон пропусков, зависимости.

## Шпаргалка

- Загрузка: UEFI → GRUB → ядро + initramfs → systemd → default.target
- `daemon-reload`, `enable --now`, `mask`, `edit`, `cat`, `reset-failed`
- `Type=simple|exec|forking|oneshot|notify`
- `Restart=on-failure`, `RestartSec=`, `StartLimitBurst=`, `TimeoutStopSec=`
- `Wants`/`Requires` — зависимость, `After`/`Before` — порядок
- `journalctl -u X -f`, `-b -1`, `-p err`, `--since`, `-k`, `--vacuum-size`
- `systemctl list-timers`, `OnCalendar=`, `Persistent=true`
