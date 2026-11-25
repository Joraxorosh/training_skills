PostgreSQL выходит далеко за пределы стандартного SQL: массивы, `jsonb`, диапазоны, богатая работа с текстом и датами, расширения, удобный клиент `psql`. На собеседовании по «постгресу» проверяют знание этих возможностей, типичных операторов и инструментов диагностики.

## Приведение типов и литералы

```sql
SELECT '42'::int, '2024-01-15'::date, 'true'::boolean;
SELECT pg_typeof(1), pg_typeof(1.5), pg_typeof('a'::text);
-- integer | numeric | text
```

Целые литералы — `integer`, дробные — `numeric`. `pg_typeof` помогает ответить на вопрос «какой тип вернёт выражение»: например, `pg_typeof(1 / 2)` — `integer`, а сумма `SUM(int_col)` — `bigint`, `AVG(int_col)` — `numeric`.

Строковые типы: `text` и `varchar` без длины эквивалентны по производительности; `varchar(n)` только проверяет длину; `char(n)` дополняет пробелами, и при сравнении хвостовые пробелы игнорируются. Строки в PostgreSQL — в одинарных кавычках; «долларовые» кавычки `$$...$$` удобны для текста с апострофами.

## Массивы

```sql
SELECT ARRAY[1, 2, 3];
SELECT (ARRAY[10, 20, 30])[1];          -- 10: индексация с 1
SELECT 5 = ANY (arr) FROM t;            -- элемент в массиве
SELECT arr @> ARRAY[1, 2] FROM t;       -- содержит все элементы
SELECT ARRAY[1, 2] && ARRAY[2, 3];      -- true: есть пересечение
SELECT array_length(ARRAY[1, 2, 3], 1); -- 3
SELECT unnest(ARRAY['a', 'b']);         -- разворачивает в строки
SELECT array_agg(name ORDER BY name) FROM emp;
```

Обращение к индексу за пределами массива даёт `NULL`, а не ошибку. `unnest(...) WITH ORDINALITY` добавляет номер элемента.

## JSON и jsonb

`jsonb` хранится в бинарном разобранном виде: ключи дедуплицированы, порядок ключей не сохраняется, поддерживаются индексы. `json` хранит исходный текст как есть. На практике почти всегда выбирают `jsonb`.

```sql
SELECT data -> 'user'          FROM docs;  -- jsonb
SELECT data ->> 'name'         FROM docs;  -- text
SELECT data #>> '{user,city}'  FROM docs;  -- text по пути
SELECT * FROM docs WHERE data @> '{"status": "paid"}';  -- содержит
SELECT * FROM docs WHERE data ? 'email';                 -- есть ключ
SELECT jsonb_set(data, '{status}', '"done"') FROM docs;
SELECT data || '{"x": 1}'::jsonb FROM docs;              -- слияние
SELECT * FROM jsonb_array_elements('[1,2,3]');
```

`->` возвращает `jsonb`, `->>` — `text`. Сравнивать `data -> 'age' > 18` нельзя напрямую; нужно `(data ->> 'age')::int > 18`.

Индексы: `CREATE INDEX ON docs USING gin (data)` ускоряет `@>`, `?`, `?|`, `?&`; класс `jsonb_path_ops` меньше и быстрее, но поддерживает только `@>`. Для поиска по конкретному полю `data ->> 'email' = ...` нужен B-tree индекс по выражению `((data ->> 'email'))`.

## Даты, диапазоны, generate_series

```sql
SELECT generate_series(1, 5);   -- 1..5 строками
SELECT generate_series(date '2024-01-01', date '2024-01-07', interval '1 day')::date;
SELECT date_trunc('week', now());
SELECT now() - interval '3 days';
SELECT int4range(1, 5) @> 3;               -- true, [1,5)
SELECT tstzrange(a_start, a_end) && tstzrange(b_start, b_end);  -- пересечение
```

Диапазонные типы по умолчанию полуоткрытые `[a, b)`. С ограничением `EXCLUDE USING gist (room WITH =, during WITH &&)` можно запретить пересекающиеся бронирования (для `=` по скалярному столбцу нужен `btree_gist`).

## Полезные конструкции

- `DISTINCT ON (col)` — первая строка в каждой группе по `ORDER BY`.
- `FILTER (WHERE ...)` у агрегатов.
- `LATERAL` — подзапрос, видящий левые таблицы.
- `RETURNING`, `ON CONFLICT`, `generate_series`, `string_agg`.
- Регулярные выражения: `~` (с учётом регистра), `~*` (без), `regexp_replace`, `regexp_matches`.
- `ILIKE` — регистронезависимый `LIKE`.
- `gen_random_uuid()` — встроенная функция в PostgreSQL 13+, расширение не нужно.
- Последовательности: `nextval('seq')`, `currval`, `setval`.

```sql
SELECT 'abc' ~ '^a', 'ABC' ~* 'b', 'Hello' ILIKE 'h%';  -- true, true, true
SELECT regexp_replace('a1b2', '\d', '', 'g');           -- 'ab'
```

## Расширения и статистика

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

- `pg_stat_statements` — накапливает статистику по нормализованным запросам: число вызовов, суммарное и среднее время. Главный инструмент поиска медленных запросов. Требует `shared_preload_libraries`.
- `pg_trgm` — триграммы, нечёткий поиск и индексы под `LIKE '%x%'`.
- `postgis` — геоданные, `pgcrypto` — криптография, `uuid-ossp` — старый способ генерации UUID, `btree_gist` — B-tree операторы в GiST.
- Системные представления: `pg_stat_activity` (активные сессии), `pg_locks` (блокировки), `pg_stat_user_tables` (seq/idx scan, мёртвые строки).

## psql

| Команда | Что делает |
|---|---|
| `\l` | список баз |
| `\c db` | подключиться к базе |
| `\dt` | таблицы текущего search_path |
| `\d t` | структура таблицы, индексы, ограничения |
| `\dn` | схемы |
| `\du` | роли |
| `\x` | переключить расширенный (вертикальный) вывод |
| `\timing` | показывать время выполнения |
| `\e` | открыть запрос в редакторе |
| `\copy` | COPY с файлом на клиенте |

Права на схему: для доступа к таблице нужен `USAGE` на схему и привилегия на саму таблицу; `GRANT SELECT ON ALL TABLES IN SCHEMA` действует только на **существующие** таблицы, для будущих — `ALTER DEFAULT PRIVILEGES`.

## Частые вопросы на собеседовании

- Чем jsonb отличается от json? → Бинарный формат, без дублей ключей и порядка, поддержка индексов.
- Как проверить, что 5 есть в массиве? → `5 = ANY(arr)` или `arr @> ARRAY[5]`.
- С какого индекса нумеруются массивы? → С 1.
- Как найти самые медленные запросы? → `pg_stat_statements`.
- Что делает `\x`? → Включает вертикальный вывод строк.
- Как сгенерировать UUID без расширений? → `gen_random_uuid()` (PG 13+).

## Шпаргалка

| Задача | Синтаксис |
|---|---|
| Приведение | `x::type` |
| Тип выражения | `pg_typeof(x)` |
| Элемент массива | `= ANY(arr)`, `@>` |
| JSON поле как текст | `->>` |
| JSON содержит | `@>` + GIN |
| Ряд чисел или дат | `generate_series` |
| Первая строка группы | `DISTINCT ON` |
| Регулярка | `~`, `~*` |
| UUID | `gen_random_uuid()` |
| Медленные запросы | `pg_stat_statements` |
