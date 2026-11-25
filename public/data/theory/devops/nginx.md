Nginx — самый популярный веб-сервер и reverse proxy: отдаёт статику, терминирует TLS, балансирует нагрузку между бэкендами, кэширует и ограничивает запросы. На собеседовании любят «задачки на конфиг»: какой location сработает, какой URI получит бэкенд, что значит код 499 или 502. Рядом спрашивают про альтернативы: HAProxy, Caddy, Envoy, Traefik.

## Структура конфигурации и управление

Конфигурация иерархична: `main` → `events` → `http` → `server` → `location`. Директивы наследуются вниз.

```bash
nginx -t                 # проверить синтаксис
nginx -s reload          # graceful reload
systemctl reload nginx   # то же через systemd
nginx -T                 # вывести итоговую конфигурацию целиком
```

**Reload** отправляет мастер-процессу SIGHUP: он проверяет конфиг, запускает новые worker-ы, а старые дообслуживают текущие соединения и завершаются. Обслуживание не прерывается. `restart` же останавливает процесс.

## Выбор server-блока

Nginx выбирает server по `listen` (IP:порт), затем по заголовку **Host** и `server_name`: точное имя → wildcard в начале (`*.example.com`) → wildcard в конце → regex. Если ничего не совпало, запрос обрабатывает **default server** для этого порта: блок с `listen 80 default_server`, а без него — **первый** server в конфиге для этого `listen`.

```nginx
server {
    listen 80 default_server;
    server_name _;
    return 444;          # закрыть соединение без ответа
}
```

## Выбор location

| Модификатор | Тип | Приоритет |
|---|---|---|
| `= /path` | Точное совпадение | Высший, поиск сразу останавливается |
| `^~ /path` | Префикс, отключающий проверку regex | Если это самый длинный префикс — выбирается сразу |
| `~` / `~*` | Regex с учётом / без учёта регистра | Проверяются по порядку в конфиге, первый совпавший |
| `/path` | Обычный префикс | Самый длинный, если не сработал regex |

Алгоритм: найти точное `=`; иначе найти **самый длинный префикс**; если он с `^~` — взять его; иначе проверить regex **по порядку**, первый совпавший побеждает; если regex не сработал — взять запомненный самый длинный префикс.

Пример: при `location ^~ /images/` и `location ~* \.(png|jpg)$` запрос `/images/logo.png` уйдёт в `^~ /images/`. При `location /admin/` и `location ~ \.php$` запрос `/admin/index.php` уйдёт в regex `\.php$`.

## proxy_pass и URI бэкенда

Ключевое правило: **есть ли URI (хотя бы `/`) после адреса в proxy_pass**.

| Конфиг | Запрос | Бэкенд получит |
|---|---|---|
| `location /api/ { proxy_pass http://b; }` | `/api/users?id=7` | `/api/users?id=7` (URI без изменений) |
| `location /api/ { proxy_pass http://b/; }` | `/api/users` | `/users` (префикс заменён на `/`) |
| `location /api/ { proxy_pass http://b/v2/; }` | `/api/users` | `/v2/users` |

Query-строка передаётся в обоих случаях.

```nginx
location /api/ {
    proxy_pass http://backend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

По умолчанию nginx отправляет бэкенду `Host` равный `$proxy_host` — имени из `proxy_pass` (например, `backend`), а не исходный Host клиента. Для виртуальных хостов на бэкенде нужен `proxy_set_header Host $host`. `$proxy_add_x_forwarded_for` **дописывает** адрес клиента к пришедшему X-Forwarded-For: запрос с 203.0.113.7 и заголовком `198.51.100.20` даст `198.51.100.20, 203.0.113.7`. Доверять левым значениям нельзя — их подделывает клиент.

## Балансировка нагрузки

```nginx
upstream backend {
    least_conn;
    server 10.0.0.1:8080 max_fails=3 fail_timeout=30s;
    server 10.0.0.2:8080 weight=2;
    server 10.0.0.3:8080 backup;
    keepalive 32;
}
server {
    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

- По умолчанию — **round robin** (с учётом `weight`).
- `least_conn` — на сервер с наименьшим числом активных соединений.
- `ip_hash` — привязка клиента по IP. Если все пользователи выходят через один NAT офиса, почти вся нагрузка уйдёт на один бэкенд.
- `hash $key consistent` — консистентное хеширование.
- `max_fails=3 fail_timeout=30s` — если за 30 секунд было 3 неудачных попытки, сервер считается недоступным на 30 секунд.
- `keepalive` к upstream требует `proxy_http_version 1.1` и пустого заголовка `Connection` (в nginx 1.26 это нужно задавать явно).

| | L4-балансировка | L7-балансировка |
|---|---|---|
| Видит | IP, порты, TCP/UDP | HTTP: путь, заголовки, cookie |
| Умеет | Быстро проксировать соединения | Маршрутизацию по URL/Host, TLS-терминацию, кэш, ретраи, модификацию заголовков |
| Примеры | nginx stream, HAProxy (mode tcp), AWS NLB | nginx http, HAProxy (mode http), Envoy, AWS ALB |

## TLS, сжатие, кэш, rate limiting

**TLS-терминация** — nginx расшифровывает HTTPS и передаёт бэкенду обычный HTTP по внутренней сети. **Caddy** — сервер, который по умолчанию сам получает и продлевает сертификаты Let's Encrypt; для nginx обычно используют certbot или cert-manager.

`gzip on;` сжимает по умолчанию только `text/html`. Для JSON нужно `gzip_types application/json text/css application/javascript;`.

```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
location /api/ { limit_req zone=api burst=20 nodelay; }
```

Запросы сверх `rate` + `burst` отклоняются с кодом **503** по умолчанию (меняется через `limit_req_status 429`).

`proxy_cache` по умолчанию не кэширует ответы с `Set-Cookie`, `Cache-Control: private/no-cache/no-store` и `Vary: *`, а также не-GET/HEAD запросы.

SPA и редиректы:

```nginx
location / { try_files $uri $uri/ /index.html; }  # нет файла — отдать index.html (200)
location /old/ { return 301 /new/; }
rewrite ^/old/(.*)$ /new/$1 permanent;
```

## Коды ошибок прокси

| Код | Причина |
|---|---|
| 499 | Клиент закрыл соединение, не дождавшись ответа (нестандартный код nginx) |
| 502 | Бэкенд недоступен (connection refused), упал, вернул некорректный ответ, сокет не найден |
| 503 | Нет живых серверов в upstream или сработал limit_req |
| 504 | Бэкенд не ответил за `proxy_read_timeout` (по умолчанию 60 с) |

## Частые вопросы на собеседовании

- Метод балансировки по умолчанию? → Round robin.
- Как применить конфиг без простоя? → `nginx -t && nginx -s reload`.
- Чем отличается `proxy_pass http://b` от `http://b/`? → Без слеша URI передаётся как есть, со слешем префикс location заменяется.
- Что такое 499? → Клиент сам закрыл соединение.
- Кто обработает запрос с неизвестным Host? → default_server, а без него первый server для этого listen.
- L4 vs L7? → L7 видит HTTP и может маршрутизировать по пути и заголовкам.

## Шпаргалка

- `nginx -t`, `nginx -s reload`, `nginx -T`
- location: `=` → самый длинный `^~` → regex по порядку → самый длинный префикс
- `proxy_pass` со слешем/URI заменяет префикс
- `proxy_set_header Host $host`, `X-Forwarded-For $proxy_add_x_forwarded_for`
- upstream: round robin, `least_conn`, `ip_hash`, `hash`, `max_fails`, `backup`, `keepalive`
- `gzip_types`, `limit_req` (503), `try_files ... /index.html`, `return 301`
- 499 / 502 / 503 / 504
