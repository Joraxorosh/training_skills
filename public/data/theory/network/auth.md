Аутентификация отвечает на вопрос «кто вы», авторизация — «что вам можно». Отсюда разница между 401 и 403. В вебе к этому добавляются ограничения браузера: same-origin policy, CORS, атрибуты cookie. На собеседовании разбирают сессии против токенов, устройство JWT, потоки OAuth 2.0 и типичные уязвимости.

## Сессии, токены и API-ключи

| Подход | Где состояние | Отзыв | Типичное применение |
|---|---|---|---|
| Серверная сессия | Redis/БД, в cookie только случайный id | Мгновенный | Классические веб-приложения, BFF |
| JWT (self-contained) | В самом токене, проверка по подписи | Сложен до `exp` | Микросервисы, мобильные клиенты |
| API-ключ | В БД сервиса | Мгновенный | Сервер-сервер, публичные API |
| mTLS | Сертификат клиента | Через CA / CRL | Service mesh, B2B-интеграции |

API-ключ передают в заголовке (`Authorization` или `X-API-Key`), а не в URL: URL оседает в логах, истории и Referer.

## JWT

JWS-токен — это три части в base64url: `header.payload.signature`.

```json
{ "alg": "RS256", "typ": "JWT", "kid": "2026-11" }
{ "sub": "user_42", "aud": "orders-api", "iss": "https://auth.example.com", "exp": 1764054900 }
```

Payload **не зашифрован**: прочитать его может любой. Подпись лишь защищает от изменения. Типичные ошибки:

- принимать `alg: none` или брать алгоритм из заголовка токена — алгоритм фиксируется на сервере
- путаница RS256/HS256: публичный ключ используется как HMAC-секрет
- не проверять `exp`, `iss`, `aud` — токен для одного сервиса примут в другом
- слабый HS256-секрет подбирается офлайн
- класть в payload секреты и персональные данные

Для проверки в десятках сервисов используют **асимметричную подпись** (RS256/ES256): сервисы берут публичные ключи из JWKS по `kid`, а подписывать может только сервер авторизации. С HS256 любой сервис с секретом может выпускать токены.

**Access + refresh**: access token живёт минуты и проверяется без хранилища, refresh token — долго, ходит только к серверу авторизации и может быть отозван. Ротация refresh token с детекцией повторного использования выявляет кражу.

## OAuth 2.0 и OpenID Connect

OAuth 2.0 — делегированная авторизация: приложение получает доступ к API от имени пользователя, не зная его пароля. OIDC добавляет аутентификацию: scope `openid`, **ID token** (JWT с `sub`, `aud` = `client_id`, `nonce`), `userinfo`, discovery. ID token предназначен клиенту; в API отправляют access token.

| Flow | Когда |
|---|---|
| Authorization Code + PKCE | Веб, SPA, мобильные приложения — стандарт для пользователей |
| Client Credentials | Сервис-сервис без пользователя |
| Device Authorization | ТВ, CLI, устройства без браузера |
| Implicit, Password | Устарели, удалены в OAuth 2.1 |

**PKCE**: клиент создаёт случайный `code_verifier`, отправляет `code_challenge = BASE64URL(SHA256(verifier))` в запросе авторизации, а при обмене кода на токен — сам verifier. Перехваченный код без verifier бесполезен. `state` защищает callback от CSRF.

**Implicit** возвращал токен во фрагменте URL: утечки через историю и Referer, token injection, нет refresh token. Его заменил Authorization Code + PKCE.

В SPA наиболее безопасен паттерн **BFF**: токены хранит серверный backend-for-frontend, браузер получает только cookie `HttpOnly; Secure; SameSite`. Всё, что лежит в `localStorage`, украдёт любой XSS.

## Same-origin policy и CORS

**Origin** = схема + хост + порт. `https://app.example.com` и `https://app.example.com:443/x` — один origin; `http://app.example.com` и `https://api.example.com` — разные.

CORS — механизм браузера, которым сервер разрешает чужому origin читать ответы. Простые запросы (GET/HEAD/POST с безопасными заголовками и Content-Type `text/plain`, `multipart/form-data`, `application/x-www-form-urlencoded`) отправляются сразу. Остальные (PUT, DELETE, `application/json`, свои заголовки) требуют **preflight**:

```http
OPTIONS /items/7
Origin: https://app.example.com
Access-Control-Request-Method: PUT
Access-Control-Request-Headers: content-type

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, PUT, DELETE
Access-Control-Allow-Headers: content-type
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 600
Vary: Origin
```

С `credentials: "include"` значение `*` запрещено: нужен точный origin из белого списка. CORS — не защита сервера: curl его игнорирует.

## CSRF и SameSite

CSRF работает, потому что браузер сам прикладывает cookie к запросу с чужого сайта. Защита:

- `SameSite=Lax` (по умолчанию в Chromium): cookie уходит только при top-level навигации безопасным методом, не при кросс-сайтовом POST, `fetch` или `iframe`
- `SameSite=Strict` — не отправляется даже при переходе по ссылке; `None` требует `Secure`
- CSRF-токен в форме или заголовке, проверка `Origin`

Bearer-токен в `Authorization` к классическому CSRF не уязвим: браузер не добавляет его сам. Зато токен в JavaScript уязвим к XSS.

## mTLS

В mutual TLS сервер запрашивает сертификат клиента, клиент доказывает владение закрытым ключом, сервер проверяет цепочку по доверенному CA и берёт идентичность из Subject/SAN (например, SPIFFE ID). Это обычный TLS с двусторонней проверкой, от версии HTTP не зависит.

## Частые вопросы на собеседовании

- 401 или 403? → Не аутентифицирован против нет прав.
- Можно ли хранить данные в JWT? → Только не секретные: payload читается всеми.
- Как отозвать JWT? → Короткий `exp`, refresh token, denylist по `jti`.
- Зачем PKCE? → Защита authorization code у публичных клиентов.
- Почему CORS-запрос с cookie падает при `*`? → С credentials нужен конкретный origin.
- Чем OIDC отличается от OAuth? → Добавляет аутентификацию и ID token.

## Шпаргалка

- Сессия — состояние на сервере; JWT — подпись, не шифрование
- Проверять `alg` (белый список), `exp`, `iss`, `aud`; RS256/ES256 + JWKS
- Пользователь → Code + PKCE; сервис → Client Credentials; implicit — нет
- Origin = схема + хост + порт; preflight для PUT/DELETE/JSON
- Credentials + CORS → точный origin, `Allow-Credentials: true`, `Vary: Origin`
- SameSite=Lax блокирует кросс-сайтовый POST; BFF + HttpOnly для SPA
