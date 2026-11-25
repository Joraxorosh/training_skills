`NULL` в SQL означает «значение неизвестно» — это не ноль и не пустая строка. Из-за него SQL использует **трёхзначную логику**, и именно здесь кроется большинство неожиданных результатов. В этой же теме — типы данных, приведение типов и полезные функции PostgreSQL для строк, чисел и дат.

## Трёхзначная логика

Любая арифметика и сравнение с `NULL` дают `NULL`:

```sql
SELECT NULL = NULL;    -- NULL
SELECT NULL <> 1;      -- NULL
SELECT 1 + NULL;       -- NULL
SELECT 'a' || NULL;    -- NULL (конкатенация оператором)
```

Логические операторы учитывают, что результат может быть известен и без неизвестного операнда:

| Выражение | Результат |
|---|---|
| `TRUE AND NULL` | NULL |
| `FALSE AND NULL` | FALSE |
| `TRUE OR NULL` | TRUE |
| `FALSE OR NULL` | NULL |
| `NOT NULL` | NULL |

`WHERE` и `HAVING` пропускают только `TRUE`, поэтому `NULL` ведёт себя как «ложь» при фильтрации. А вот `CHECK`-ограничение, наоборот, пропускает `NULL`: нарушением считается только `FALSE`.

## Как правильно сравнивать с NULL

```sql
WHERE col IS NULL
WHERE col IS NOT NULL
WHERE a IS DISTINCT FROM b      -- NULL-безопасное «не равно»
WHERE a IS NOT DISTINCT FROM b  -- NULL-безопасное «равно»
```

`NULL IS NOT DISTINCT FROM NULL` — `true`. В MySQL аналог — оператор `<=>`.

## Функции для работы с NULL

- `COALESCE(a, b, c)` — первое не-NULL значение: `COALESCE(NULL, NULL, 3)` = 3.
- `NULLIF(a, b)` — `NULL`, если `a = b`, иначе `a`. Классика — защита от деления на ноль: `x / NULLIF(y, 0)`.
- `GREATEST` / `LEAST` в PostgreSQL **игнорируют NULL** (`GREATEST(1, NULL, 3)` = 3), а в MySQL вернут NULL.
- `concat('a', NULL, 'b')` = `'ab'` — функция `concat` игнорирует NULL, в отличие от `||`.

```sql
SELECT COALESCE(phone, email, 'нет контакта') FROM users;
SELECT revenue / NULLIF(visits, 0) AS rpv FROM stats;
```

Типы аргументов `COALESCE` должны быть совместимы: `COALESCE(int_col, 'нет')` в PostgreSQL упадёт с ошибкой приведения.

## CASE

```sql
SELECT name,
  CASE
    WHEN salary >= 5000 THEN 'high'
    WHEN salary >= 2000 THEN 'mid'
    ELSE 'low'
  END AS grade
FROM emp;
```

Ветки проверяются по порядку, срабатывает первая истинная. Без `ELSE` результат — `NULL`. Простой `CASE x WHEN NULL THEN ...` **никогда не сработает**, потому что сравнивает через `=`; пишите `CASE WHEN x IS NULL THEN ...`.

## Типы данных и приведение

| Категория | Типы PostgreSQL |
|---|---|
| Целые | `smallint`, `integer`, `bigint` |
| Точные дробные | `numeric(p, s)` — для денег |
| Приближённые | `real`, `double precision` |
| Строки | `text`, `varchar(n)`, `char(n)` |
| Дата и время | `date`, `timestamp`, `timestamptz`, `interval` |
| Прочее | `boolean`, `uuid`, `jsonb`, массивы |

Приведение: `CAST(x AS int)` или короткая форма PostgreSQL `x::int`.

```sql
SELECT 7 / 2;           -- 3 (целочисленное деление!)
SELECT 7 / 2.0;         -- 3.5000000000000000
SELECT 7::numeric / 2;  -- 3.5000000000000000
SELECT '42'::int + 1;   -- 43
SELECT 'abc'::int;      -- ошибка: invalid input syntax
SELECT 0.1 + 0.2 = 0.3; -- true (литералы numeric)
SELECT 0.1::float8 + 0.2::float8 = 0.3; -- false
SELECT round(2.5), round(-2.5); -- 3, -3 для numeric
```

PostgreSQL строго типизирован: `WHERE int_col = 'abc'` — ошибка, а `'1' + 1` работает только потому, что литерал без типа приводится. MySQL, напротив, молча приводит строки к числам (`'abc' = 0` даёт true).

`char(n)` дополняет пробелами, `varchar(n)` ограничивает длину, `text` без ограничения — в PostgreSQL производительность у них одинаковая.

## Строки и даты

```sql
SELECT length('Привет');           -- 6 символов
SELECT upper('abc'), lower('ABC'), trim('  x  ');
SELECT substring('PostgreSQL' FROM 1 FOR 4);  -- 'Post'
SELECT replace('a-b-c', '-', '');  -- 'abc'
SELECT split_part('a,b,c', ',', 2); -- 'b'

SELECT now();                       -- timestamptz начала транзакции
SELECT current_date + 1;            -- завтра (date + int)
SELECT date_trunc('month', now());  -- начало месяца
SELECT extract(year FROM date '2024-03-15');  -- 2024
SELECT date '2024-03-01' - date '2024-02-01'; -- 29 (int, дни)
SELECT age(date '2024-03-01', date '2000-01-15');
```

`timestamptz` хранит момент времени в UTC и выводит его в часовом поясе сессии; `timestamp` — «настенное» время без пояса.

## Частые вопросы на собеседовании

- Чему равно `NULL = NULL`? → NULL, не true.
- Как отобрать строки, где столбец не заполнен? → `IS NULL`.
- Чем `COALESCE` отличается от `NULLIF`? → COALESCE заменяет NULL значением, NULLIF превращает значение в NULL.
- Что вернёт `5 / 2` в PostgreSQL? → 2: деление целых целочисленное.
- `TRUE OR NULL`? → TRUE. `FALSE AND NULL`? → FALSE.
- Какой тип выбрать для денег? → `numeric`, не `float`.

## Шпаргалка

| Выражение | Результат |
|---|---|
| `NULL = NULL` | NULL |
| `NULL IS NULL` | TRUE |
| `NULL IS NOT DISTINCT FROM NULL` | TRUE |
| конкатенация оператором с NULL | NULL |
| `concat('a', NULL)` | 'a' |
| `COALESCE(NULL, 2)` | 2 |
| `NULLIF(5, 5)` | NULL |
| `GREATEST(1, NULL)` в PG | 1 |
| `7 / 2` | 3 |
| CHECK с NULL | проходит |
