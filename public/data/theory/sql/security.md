Безопасность базы данных складывается из двух частей: кто и к чему имеет доступ (роли и привилегии) и как приложение формирует запросы (защита от SQL-инъекций). На собеседовании бэкенд-разработчика и аналитика спрашивают про принцип наименьших привилегий, `GRANT`/`REVOKE`, row-level security и, почти всегда, — как устроена SQL-инъекция и чем от неё защищаться.

## Роли и пользователи

В PostgreSQL нет отдельного понятия «пользователь» — есть **роли**. Роль с атрибутом `LOGIN` может подключаться (это и есть пользователь), роль без него — группа прав.

```sql
CREATE ROLE readonly NOLOGIN;
CREATE ROLE app_user LOGIN PASSWORD 'secret';
GRANT readonly TO app_user;          -- членство: app_user наследует права readonly
ALTER ROLE app_user CONNECTION LIMIT 20;
```

`CREATE USER` — то же, что `CREATE ROLE ... LOGIN`. Важные атрибуты: `SUPERUSER` (обходит все проверки), `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, `INHERIT`. Приложение **никогда** не должно работать под суперпользователем или владельцем таблиц.

Владелец объекта (тот, кто его создал) имеет на него все права, может их раздавать и выполнять `ALTER`/`DROP`. Сменить владельца: `ALTER TABLE t OWNER TO role`.

## Привилегии: GRANT и REVOKE

```sql
GRANT CONNECT ON DATABASE shop TO readonly;
GRANT USAGE ON SCHEMA reports TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA reports TO readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA reports GRANT SELECT ON TABLES TO readonly;

GRANT SELECT, INSERT, UPDATE ON orders TO app_user;
GRANT SELECT (id, name) ON customers TO support;   -- права на столбцы
GRANT USAGE ON SEQUENCE orders_id_seq TO app_user;
REVOKE DELETE ON orders FROM app_user;
```

| Уровень | Привилегии |
|---|---|
| База | CONNECT, CREATE, TEMP |
| Схема | USAGE (видеть объекты), CREATE |
| Таблица | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER |
| Последовательность | USAGE, SELECT, UPDATE |
| Функция | EXECUTE |

Ключевые моменты:

- Для чтения таблицы нужны **и** `USAGE` на схему, **и** `SELECT` на таблицу.
- `GRANT ... ON ALL TABLES` действует только на **существующие** таблицы; для будущих — `ALTER DEFAULT PRIVILEGES`.
- `WITH GRANT OPTION` разрешает передавать право дальше.
- `PUBLIC` — псевдороль «все». В PostgreSQL 15+ у `PUBLIC` отобрано право `CREATE` в схеме `public`; раньше любой пользователь мог создавать там объекты.
- Проверить права: `\dp` в psql или `has_table_privilege('role', 'table', 'SELECT')`.

## Row-Level Security

RLS ограничивает, какие **строки** видит и может менять роль:

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.tenant_id')::int)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::int);
```

- `USING` фильтрует видимые строки (SELECT, UPDATE, DELETE), `WITH CHECK` проверяет новые строки (INSERT, UPDATE).
- Если RLS включён, а политик нет — роль не видит **ни одной** строки.
- Владелец таблицы и суперпользователь обходят RLS, если не указано `ALTER TABLE ... FORCE ROW LEVEL SECURITY`.

Типичное применение — мультиарендные (multi-tenant) приложения. Альтернатива для ограничения столбцов — представление с нужными столбцами и права только на него.

## SQL-инъекции

Инъекция возникает, когда пользовательский ввод **склеивается** с текстом запроса:

```sql
-- код приложения: "SELECT * FROM users WHERE name = '" + input + "'"
-- input = ' OR '1'='1
SELECT * FROM users WHERE name = '' OR '1'='1';   -- вернёт всех

-- input = '; DROP TABLE users; --
SELECT * FROM users WHERE name = ''; DROP TABLE users; --';
```

Атакующий может обойти аутентификацию, прочитать чужие данные (`UNION SELECT password FROM ...`), изменить или удалить данные. «Слепые» инъекции извлекают данные по одному биту через разницу в ответе или задержки (`pg_sleep`).

## Защита от инъекций

1. **Параметризованные запросы** (prepared statements) — главный способ. Значения передаются отдельно от текста запроса и никогда не интерпретируются как SQL.
2. ORM и query builder — используют параметры, но «сырые» запросы с конкатенацией остаются уязвимыми.
3. Параметром нельзя передать **идентификатор** (имя таблицы, столбца, направление сортировки) — такие значения проверяют по белому списку.
4. Наименьшие привилегии: даже успешная инъекция под ролью без `DROP` и с доступом к нужным таблицам нанесёт меньше вреда.
5. Экранирование вручную — ненадёжная последняя мера.

```sql
-- на стороне сервера
PREPARE find_user(text) AS SELECT * FROM users WHERE name = $1;
EXECUTE find_user('O''Brien');
```

Динамический SQL внутри PL/pgSQL тоже уязвим. Безопасно — `EXECUTE ... USING` для значений и `format()` с `%I` для идентификаторов и `%L` для литералов:

```sql
EXECUTE format('SELECT count(*) FROM %I WHERE status = $1', tbl) USING st;
```

`quote_ident()` и `quote_literal()` — функции экранирования; `%s` в `format` подставляет текст без экранирования и опасен.

> Функции с `SECURITY DEFINER` выполняются с правами владельца. Для них обязательно задавать `SET search_path`, иначе атакующий может подменить объекты через свою схему.

## Прочие меры

- Шифрование соединения (SSL/TLS), настройка `pg_hba.conf` (кто, откуда и каким методом может подключаться), аутентификация `scram-sha-256` вместо `md5`.
- Пароли пользователей приложения хранят не в открытом виде, а в виде хеша с солью (bcrypt, argon2); `pgcrypto` даёт функцию `crypt()`.
- Аудит: `log_statement`, расширение `pgaudit`.
- Отдельные роли для миграций, приложения, аналитиков, бэкапов.

## Частые вопросы на собеседовании

- Чем роль отличается от пользователя в PostgreSQL? → Пользователь — роль с атрибутом LOGIN.
- Что нужно для SELECT из таблицы в схеме? → USAGE на схему и SELECT на таблицу.
- Почему GRANT ON ALL TABLES не сработал для новой таблицы? → Действует на существующие; нужно ALTER DEFAULT PRIVILEGES.
- Как защититься от SQL-инъекций? → Параметризованные запросы, белые списки для идентификаторов, минимальные права.
- Можно ли передать имя таблицы параметром? → Нет, только значения; идентификатор проверяют по списку или `format('%I')`.
- Что такое RLS? → Политики, ограничивающие видимые и изменяемые строки.

## Шпаргалка

| Тема | Правило |
|---|---|
| Пользователь | `CREATE ROLE ... LOGIN` |
| Группа | роль без LOGIN + `GRANT role TO user` |
| Доступ к таблице | USAGE на схему + SELECT на таблицу |
| Будущие таблицы | `ALTER DEFAULT PRIVILEGES` |
| Отзыв прав | `REVOKE ... FROM` |
| Строки | RLS: `CREATE POLICY ... USING` |
| Инъекции | параметры, не конкатенация |
| Динамический SQL | `format('%I')` + `EXECUTE ... USING` |
| Принцип | наименьшие привилегии |
