Браузер выполняет код и автоматически прикладывает cookie, поэтому многие атаки направлены не на сервер, а на пользователя через его браузер. На собеседовании спрашивают про типы XSS и контекстное кодирование, CSP, CSRF и `SameSite`, ошибки CORS, clickjacking и защитные заголовки.

## XSS: типы и причины

XSS (Cross-Site Scripting) — выполнение чужого JavaScript в контексте вашего сайта. Скрипт получает доступ к DOM, может отправлять запросы от имени пользователя и читать данные страницы.

| Тип | Где хранится полезная нагрузка | Пример |
|---|---|---|
| Reflected | В текущем запросе | `?q=<script>...` отражается в ответе |
| Stored | На сервере | Комментарий с `<img onerror=...>` |
| DOM-based | Только на клиенте | `location.hash` попадает в `innerHTML` |

```javascript
// Уязвимо: DOM XSS
el.innerHTML = "Привет, " + decodeURIComponent(location.hash.slice(1));

// Безопасно
el.textContent = "Привет, " + decodeURIComponent(location.hash.slice(1));
```

Современные фреймворки экранируют вывод по умолчанию, но есть лазейки: `dangerouslySetInnerHTML` в React, `v-html` во Vue, `|safe` в Jinja2. Если HTML от пользователя действительно нужен, его очищают санитайзером (DOMPurify).

## Контекстное кодирование

Экранирование зависит от того, куда вставляются данные:

- **Текст HTML** — кодировать `< > & " '`.
- **Атрибут** — всегда в кавычках и с кодированием. В атрибут без кавычек можно передать `x onmouseover=alert(1)` без спецсимволов.
- **URL в `href`/`src`** — проверять схему по allowlist (`http`, `https`), иначе `javascript:alert(1)` выполнится при клике.
- **Обработчики событий и `<script>`** — не вставлять данные вообще. В `onclick` браузер декодирует `&#39;` обратно в кавычку до выполнения JS. Данные передают через `data-*` атрибуты или JSON.

## CSP и защита cookie

Content-Security-Policy ограничивает, откуда браузер берёт скрипты. Это второй слой: если XSS просочилась, CSP может не дать ей выполниться.

```text
# Слабо: inline-скрипты разрешены, внедрённый код выполнится
Content-Security-Policy: script-src 'self' 'unsafe-inline'

# Сильно: только скрипты с одноразовым nonce
Content-Security-Policy: script-src 'nonce-R4nd0m' 'strict-dynamic'; object-src 'none'; base-uri 'none'
```

Nonce генерируется заново для каждого ответа. `'strict-dynamic'` разрешает доверенным скриптам подгружать другие скрипты.

Атрибуты cookie:

- `HttpOnly` — недоступна из JS, XSS не украдёт сессию напрямую.
- `Secure` — только по HTTPS.
- `SameSite` — ограничивает отправку в межсайтовых запросах.
- Префикс `__Host-` — обязательны `Secure` и `Path=/`, без `Domain`, поэтому поддомены не перезапишут cookie.

## CSRF и SameSite

CSRF использует то, что браузер сам прикладывает cookie: форма на `evil.com` отправляет POST на `bank.com/transfer`.

| Защита | Как работает | Ограничения |
|---|---|---|
| CSRF-токен | Случайное значение в форме, сверяется с сессией | Нужно во всех изменяющих запросах |
| `SameSite=Lax` | Cookie не уходит в межсайтовых POST, iframe, fetch | Уходит при GET-навигации верхнего уровня |
| `SameSite=Strict` | Cookie не уходит ни в одном межсайтовом запросе | Переход по внешней ссылке — без сессии |
| Проверка `Origin` / `Sec-Fetch-Site` | Сервер отвергает чужие источники | Нужно аккуратно обрабатывать отсутствие заголовка |

GET никогда не должен менять состояние. `HttpOnly` и проверка «только POST» от CSRF не защищают.

## CORS и его ошибки

Same-origin policy запрещает чужому сайту **читать** ответы. CORS ослабляет это правило для доверенных источников. CORS не защищает от CSRF: простой межсайтовый запрос дойдёт до сервера, браузер лишь не отдаст ответ скрипту.

```python
# Уязвимо: любой сайт читает ответы с cookie пользователя
resp.headers["Access-Control-Allow-Origin"] = request.headers["Origin"]
resp.headers["Access-Control-Allow-Credentials"] = "true"

# Безопасно: точный allowlist
if origin in {"https://app.example.com"}:
    resp.headers["Access-Control-Allow-Origin"] = origin
    resp.headers["Vary"] = "Origin"
```

Комбинацию `*` и credentials браузер не примет. Опасны также проверки по подстроке (`example.com.evil.com`) и разрешение `null`.

## Clickjacking, open redirect и заголовки

**Clickjacking** — страницу встраивают в прозрачный iframe и заставляют пользователя кликнуть. Защита — `Content-Security-Policy: frame-ancestors 'none'` или `'self'`.

**Open redirect** — `redirect(request.args["next"])` превращает ваш домен в трамплин для фишинга и обхода проверок `redirect_uri`. Проверка `startswith("/")` обходится через `//evil.com`. Разрешайте только пути без схемы и хоста или домены из allowlist.

Полезные заголовки:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — только HTTPS.
- `X-Content-Type-Options: nosniff` — запрет угадывания MIME-типа.
- `Referrer-Policy: strict-origin-when-cross-origin` — меньше утечек URL.
- Не раскрывать версии в `Server` и `X-Powered-By`.

## Частые вопросы на собеседовании

- **Чем DOM XSS отличается от reflected?** → Полезная нагрузка не проходит через сервер, уязвим клиентский код.
- **Почему HTML-экранирования мало для `href`?** → `javascript:` URL не содержит спецсимволов, нужна проверка схемы.
- **Защищает ли `HttpOnly` от XSS?** → Нет, только мешает украсть cookie; скрипт всё равно действует от имени пользователя.
- **Что оставляет открытым `SameSite=Lax`?** → Изменение состояния через GET-навигацию.
- **Защищает ли CORS от CSRF?** → Нет, CORS управляет чтением ответов.
- **Чем плох `'unsafe-inline'` в CSP?** → Разрешает именно тот код, который внедряет атакующий.

## Шпаргалка

- XSS: `textContent` вместо `innerHTML`, санитайзер для HTML, проверка схем URL.
- CSP: nonce и `'strict-dynamic'`, без `'unsafe-inline'`.
- Cookie: `HttpOnly; Secure; SameSite=Lax`, префикс `__Host-`.
- CSRF: токен, SameSite, проверка `Origin`, GET без побочных эффектов.
- CORS: точный allowlist, никогда не отражать `Origin` с credentials.
- `frame-ancestors`, HSTS, `nosniff`; редиректы — только по allowlist.
