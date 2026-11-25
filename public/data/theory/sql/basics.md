Запрос `SELECT` — основа SQL. На собеседовании редко спрашивают синтаксис как таковой; гораздо чаще проверяют, понимаете ли вы **логический порядок выполнения**, как работают фильтры с `NULL`, `DISTINCT`, `LIMIT` и сортировка. Почти все «ловушки» в задачах вида «сколько строк вернёт запрос» сводятся к этим нескольким правилам.

## Логический порядок выполнения

Запрос пишется в одном порядке, а логически вычисляется в другом:

1. `FROM` и `JOIN` — собираем исходные строки
2. `WHERE` — фильтруем строки
3. `GROUP BY` — группируем
4. `HAVING` — фильтруем группы
5. `SELECT` — вычисляем выражения и псевдонимы, затем оконные функции
6. `DISTINCT` — убираем дубликаты
7. `ORDER BY` — сортируем
8. `LIMIT` / `OFFSET` — отрезаем строки

Отсюда главное следствие: **псевдоним из SELECT нельзя использовать в WHERE**, потому что на этапе `WHERE` его ещё не существует. А в `ORDER BY` — можно.

```sql
-- ошибка: column "annual" does not exist
SELECT salary * 12 AS annual FROM emp WHERE annual > 100000;

-- работает
SELECT salary * 12 AS annual FROM emp WHERE salary * 12 > 100000 ORDER BY annual;
```

> В PostgreSQL псевдоним нельзя использовать и в `HAVING`. MySQL здесь мягче: разрешает псевдонимы в `HAVING` и в `GROUP BY`.

## WHERE: операторы и логика

Основные операторы: `=`, `<>` (или `!=`), `<`, `>`, `BETWEEN a AND b` (включительно с обеих сторон), `IN (...)`, `LIKE`, `IS NULL`.

```sql
SELECT name FROM emp
WHERE dept IN ('IT', 'HR')          -- то же, что dept = 'IT' OR dept = 'HR'
  AND salary BETWEEN 1000 AND 2000  -- 1000 и 2000 включены
  AND name LIKE 'A%';               -- % любое число символов, _ ровно один
```

Приоритет: `NOT` выше `AND`, `AND` выше `OR`. Классическая ошибка:

```sql
-- означает: dept = 'IT' OR (dept = 'HR' AND salary > 1000)
WHERE dept = 'IT' OR dept = 'HR' AND salary > 1000
-- правильно со скобками
WHERE (dept = 'IT' OR dept = 'HR') AND salary > 1000
```

`LIKE` в PostgreSQL чувствителен к регистру, для нечувствительного поиска есть `ILIKE`. В MySQL регистр зависит от collation (по умолчанию обычно нечувствителен).

Строки пишутся в **одинарных** кавычках. Двойные кавычки в PostgreSQL — это идентификатор: `WHERE name = "Bob"` упадёт с ошибкой «column "Bob" does not exist».

## NULL в фильтрах

Любое сравнение с `NULL` даёт `NULL` (unknown), а `WHERE` пропускает только `true`. Поэтому:

```sql
SELECT * FROM emp WHERE manager_id = NULL;   -- 0 строк всегда
SELECT * FROM emp WHERE manager_id IS NULL;  -- правильно
SELECT * FROM emp WHERE dept <> 'IT';        -- строки с dept IS NULL НЕ попадут
```

Особенно опасен `NOT IN` со списком, где есть `NULL`: `x NOT IN (1, NULL)` никогда не будет `true`, и запрос вернёт 0 строк.

## DISTINCT, ORDER BY, LIMIT

`DISTINCT` применяется ко **всей строке** выборки, а не к первому столбцу. `NULL` при этом считаются равными друг другу — несколько `NULL` схлопнутся в один.

```sql
SELECT DISTINCT dept, city FROM emp;  -- уникальные пары
SELECT DISTINCT ON (dept) dept, name, salary
FROM emp ORDER BY dept, salary DESC;   -- PostgreSQL: самый богатый в каждом отделе
```

Сортировка: по умолчанию `ASC`. В PostgreSQL `NULL` считается **больше любого значения**: при `ASC` они в конце, при `DESC` — в начале. Это меняется через `NULLS FIRST` / `NULLS LAST`. В MySQL наоборот: `NULL` идут первыми при `ASC`.

```sql
SELECT name FROM emp ORDER BY bonus DESC NULLS LAST, name;
SELECT name FROM emp ORDER BY 2;  -- по номеру столбца выборки
```

**Без ORDER BY порядок строк не гарантирован**, даже если «всегда так выводилось».

Пагинация: `LIMIT 10 OFFSET 20` (стандарт: `OFFSET 20 ROWS FETCH FIRST 10 ROWS ONLY`). `FETCH FIRST ... WITH TIES` добавит строки с тем же значением ключа сортировки, что у последней. Большой `OFFSET` медленный — строки всё равно читаются и отбрасываются.

## UNION, INTERSECT, EXCEPT

| Оператор | Что делает | Дубликаты |
|---|---|---|
| `UNION` | объединение | удаляет |
| `UNION ALL` | объединение | сохраняет, быстрее |
| `INTERSECT` | пересечение | удаляет |
| `EXCEPT` | разность (в MySQL до 8.0.31 нет) | удаляет |

Число и типы столбцов должны совпадать; имена берутся из первого запроса. `ORDER BY` пишется один раз в конце.

## Частые вопросы на собеседовании

- Почему псевдоним из SELECT не виден в WHERE? → WHERE логически выполняется раньше SELECT.
- Сколько строк вернёт `WHERE col <> 'x'`, если в col есть NULL? → Строки с NULL не попадут: сравнение даёт unknown.
- Чем `UNION` отличается от `UNION ALL`? → UNION убирает дубликаты (сортировка/хеширование), UNION ALL — нет.
- Где окажутся NULL при `ORDER BY col DESC` в PostgreSQL? → В начале; исправляется `NULLS LAST`.
- Включает ли `BETWEEN` границы? → Да, обе.
- Гарантирован ли порядок без ORDER BY? → Нет.

## Шпаргалка

| Тема | Правило |
|---|---|
| Порядок | FROM → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT |
| Псевдоним | виден в ORDER BY, не виден в WHERE/HAVING (PG) |
| NULL | только `IS NULL` / `IS NOT NULL` |
| Приоритет | NOT > AND > OR, ставьте скобки |
| Строки | `'одинарные'`; `"двойные"` — идентификаторы |
| NULL в сортировке PG | ASC — в конце, DESC — в начале |
| DISTINCT | по всей строке; `DISTINCT ON` — только PG |
