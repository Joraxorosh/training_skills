Подзапрос — это `SELECT` внутри другого запроса. Он может возвращать одно значение, список или целую таблицу. CTE (`WITH`) — именованный подзапрос, который делает сложные запросы читаемыми и позволяет писать рекурсию. На собеседовании проверяют виды подзапросов, ловушки `NOT IN` с `NULL`, поведение `ANY`/`ALL` на пустом наборе и особенности CTE в PostgreSQL.

## Виды подзапросов

| Вид | Где используется | Пример |
|---|---|---|
| Скалярный | SELECT, WHERE, везде где значение | `(SELECT MAX(price) FROM p)` |
| Списочный | `IN`, `ANY`, `ALL` | `id IN (SELECT ...)` |
| Табличный | FROM (производная таблица) | `FROM (SELECT ...) t` |
| Коррелированный | ссылается на внешний запрос | `WHERE x > (SELECT AVG(x) FROM t2 WHERE t2.g = t1.g)` |

Скалярный подзапрос должен вернуть **не более одной строки**. Если строк больше — ошибка «more than one row returned by a subquery used as an expression». Если строк ноль — результат `NULL`, а не ошибка.

```sql
SELECT name, (SELECT price FROM products WHERE id = 99) AS p
FROM shops;  -- товара 99 нет: p = NULL в каждой строке
```

Исправить ошибку «more than one row» можно агрегатом (`MAX`), `LIMIT 1` или заменой `=` на `IN`.

## Коррелированные подзапросы

Подзапрос ссылается на столбцы внешнего запроса и логически выполняется для каждой его строки:

```sql
-- сотрудники с зарплатой выше средней по своему отделу
SELECT name, dept, salary
FROM emp e
WHERE salary > (SELECT AVG(salary) FROM emp WHERE dept = e.dept);
```

PostgreSQL часто разворачивает такие подзапросы в соединения, но не всегда — на больших данных проверяйте план. Альтернатива — оконная функция `AVG(salary) OVER (PARTITION BY dept)`.

В PostgreSQL производная таблица в `FROM` раньше обязательно требовала псевдоним; начиная с версии 16 псевдоним можно не писать. В MySQL он обязателен.

## IN, EXISTS, ANY, ALL

```sql
SELECT * FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);
```

`EXISTS` возвращает `true`, если подзапрос вернул хотя бы одну строку; что именно в `SELECT` — неважно, даже `SELECT NULL`.

`ANY` и `ALL` сравнивают значение со списком:

- `x > ANY (подзапрос)` — больше хотя бы одного (эквивалент `x > MIN`).
- `x > ALL (подзапрос)` — больше каждого (эквивалент `x > MAX`, но с оговорками ниже).
- `x = ANY (...)` то же самое, что `IN`; `x <> ALL (...)` — то же, что `NOT IN`.

Пустой подзапрос: `ANY` даёт `false`, `ALL` даёт **`true`**. Поэтому `price > ALL (SELECT price FROM products WHERE price > 1000)` при отсутствии таких товаров вернёт все строки, а `price > (SELECT MAX(...))` — ни одной (сравнение с NULL).

## Ловушка NOT IN и NULL

```sql
SELECT * FROM customers
WHERE id NOT IN (SELECT customer_id FROM orders);
```

Если среди `customer_id` есть хоть один `NULL`, условие `id NOT IN (1, 2, NULL)` превращается в `id <> 1 AND id <> 2 AND id <> NULL`, последнее даёт unknown — и запрос вернёт **0 строк**. `NOT EXISTS` такой проблемы не имеет, поэтому для anti-join используйте его.

## CTE: WITH

Запрос с CTE начинается с ключевого слова `WITH`:

```sql
WITH dept_avg AS (
  SELECT dept, AVG(salary) AS avg_sal
  FROM emp GROUP BY dept
)
SELECT e.name, e.salary, d.avg_sal
FROM emp e JOIN dept_avg d USING (dept)
WHERE e.salary > d.avg_sal;
```

Особенности в PostgreSQL 12 и новее:

- Нерекурсивный CTE без побочных эффектов, на который ссылаются **один раз**, встраивается в основной запрос (inline) — оптимизатор может протолкнуть в него фильтры.
- Если на CTE ссылаются несколько раз, он по умолчанию материализуется (вычисляется один раз).
- Поведение можно задать явно: `WITH x AS MATERIALIZED (...)` или `AS NOT MATERIALIZED`.
- До версии 12 CTE всегда материализовался и был «барьером оптимизации».
- CTE видны только внутри своего запроса; можно перечислить несколько через запятую, следующий может ссылаться на предыдущий.

CTE может содержать `INSERT`/`UPDATE`/`DELETE ... RETURNING` (data-modifying CTE) — они выполняются ровно один раз, даже если результат не используется.

## Рекурсивные CTE

```sql
WITH RECURSIVE nums(n) AS (
  SELECT 1                 -- якорная часть
  UNION ALL
  SELECT n + 1 FROM nums   -- рекурсивная часть
  WHERE n < 5
)
SELECT n FROM nums;  -- 1, 2, 3, 4, 5
```

Типичное применение — обход дерева (сотрудник → руководитель, категории):

```sql
WITH RECURSIVE sub AS (
  SELECT id, name, 1 AS lvl FROM emp WHERE id = 1
  UNION ALL
  SELECT e.id, e.name, s.lvl + 1
  FROM emp e JOIN sub s ON e.manager_id = s.id
)
SELECT * FROM sub;
```

Без условия остановки рекурсия бесконечна. `UNION` (без ALL) отбрасывает повторы и защищает от циклов в графе; в PostgreSQL 14+ есть также `CYCLE`.

## Частые вопросы на собеседовании

- Что вернёт скалярный подзапрос без строк? → NULL.
- Чем опасен `NOT IN`? → NULL в подзапросе делает результат пустым; используйте `NOT EXISTS`.
- Что вернёт `x > ALL (пустой набор)`? → true.
- Материализуется ли CTE в PostgreSQL? → С 12-й версии — только если на него ссылаются несколько раз или указано MATERIALIZED.
- Чем коррелированный подзапрос отличается от обычного? → Ссылается на внешний запрос и логически вычисляется для каждой строки.
- Из каких частей состоит рекурсивный CTE? → Якорь, UNION ALL, рекурсивная часть с условием остановки.

## Шпаргалка

| Конструкция | Запомнить |
|---|---|
| Скалярный подзапрос | 0 строк → NULL, больше 1 → ошибка |
| EXISTS | true при хотя бы одной строке |
| NOT IN | ломается на NULL |
| ANY / ALL на пустом | false / true |
| CTE | `WITH name AS (...)` |
| PG 12+ | inline при одной ссылке, MATERIALIZED вручную |
| Рекурсия | `WITH RECURSIVE`, якорь UNION ALL шаг |
