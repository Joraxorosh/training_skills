На живом собеседовании почти всегда дают несколько классических задач: вторая по величине зарплата, дубликаты, top-N в группе, нарастающий итог, серии подряд идущих дней. У каждой есть «эталонное» решение и типичная ошибка. Ниже — шаблоны, которые стоит знать наизусть, и ловушки, на которых проверяют внимательность.

## N-я по величине зарплата

Ловушка: «вторая по величине» означает второе **различное** значение. При зарплатах 300, 300, 200 ответ — 200.

```sql
-- через DENSE_RANK: работает для любого N и учитывает дубли
SELECT DISTINCT salary FROM (
  SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS r FROM emp
) t WHERE r = 2;

-- через подзапрос: возвращает NULL, если второй зарплаты нет
SELECT MAX(salary) FROM emp WHERE salary < (SELECT MAX(salary) FROM emp);

-- через OFFSET: без DISTINCT вернёт 300 вместо 200
SELECT DISTINCT salary FROM emp ORDER BY salary DESC LIMIT 1 OFFSET 1;
```

Если второй зарплаты нет, вариант с `MAX` вернёт **одну строку с NULL**, а варианты с `LIMIT/OFFSET` и `DENSE_RANK` — **ноль строк**. Чтобы всегда получать строку, оборачивают в скалярный подзапрос: `SELECT (SELECT ... LIMIT 1 OFFSET 1) AS second`.

## Дубликаты

```sql
-- найти повторяющиеся email
SELECT email, COUNT(*) FROM users
GROUP BY email HAVING COUNT(*) > 1;

-- удалить дубли, оставив строку с минимальным id
DELETE FROM users u
USING users d
WHERE u.email = d.email AND u.id > d.id;

-- то же через ROW_NUMBER
DELETE FROM users WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY email ORDER BY id) AS rn
    FROM users
  ) t WHERE rn > 1
);
```

Ошибка: `WHERE COUNT(*) > 1` — агрегат в `WHERE` запрещён, нужен `HAVING`.

«Сколько клиентов сделали 2+ заказа» — это **одно число**, поэтому нужен внешний `COUNT` поверх группировки:

```sql
SELECT COUNT(*) FROM (
  SELECT customer_id FROM orders GROUP BY customer_id HAVING COUNT(*) >= 2
) t;
```

## Top-N в каждой группе

```sql
SELECT * FROM (
  SELECT e.*, DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS r
  FROM emp e
) t
WHERE r <= 3;
```

Выбор функции зависит от требований к равенству:

- `ROW_NUMBER` — ровно N строк на группу, при равенстве выбор произволен.
- `RANK` — все «делящие место», но с пропусками.
- `DENSE_RANK` — все строки с N лучшими **значениями**.

Последняя строка на пользователя: `DISTINCT ON (user_id) ... ORDER BY user_id, created_at DESC` в PostgreSQL, либо `ROW_NUMBER() ... = 1`. Решение через `WHERE created_at = (SELECT MAX(...))` вернёт несколько строк при совпадении времени.

## Нарастающий итог и доли

```sql
SELECT user_id, paid_at, amount,
  SUM(amount) OVER (PARTITION BY user_id ORDER BY paid_at
                    ROWS UNBOUNDED PRECEDING) AS running
FROM payments;

-- доля региона в процентах с двумя знаками
SELECT region,
  ROUND(100.0 * SUM(amount) / SUM(SUM(amount)) OVER (), 2) AS pct
FROM sales GROUP BY region;
```

Ловушка долей: `100 * SUM(int) / SUM(...)` в целых числах даст 0 или округление вниз. Умножайте на `100.0` или приводите к `numeric`. `ROUND(x, 2)` в PostgreSQL работает только для `numeric`, не для `double precision`.

## Отсутствие, пересечение, «и то и другое»

```sql
-- товары, которые ни разу не продавались
SELECT p.* FROM products p
WHERE NOT EXISTS (SELECT 1 FROM sales s WHERE s.product_id = p.id);

-- пользователи, купившие и A, и B
SELECT user_id FROM purchases
WHERE product IN ('A', 'B')
GROUP BY user_id
HAVING COUNT(DISTINCT product) = 2;
-- или INTERSECT
SELECT user_id FROM purchases WHERE product = 'A'
INTERSECT
SELECT user_id FROM purchases WHERE product = 'B';
```

`WHERE product = 'A' AND product = 'B'` всегда пусто — одна строка не может иметь два значения.

Пересечение интервалов: два полуоткрытых интервала `[s1, e1)` и `[s2, e2)` пересекаются, если `s1 < e2 AND s2 < e1`. Для пар без повторов добавляют `a.id < b.id`:

```sql
SELECT a.id, b.id FROM bookings a
JOIN bookings b ON a.room = b.room AND a.id < b.id
 AND a.start_h < b.end_h AND b.start_h < a.end_h;
```

## Пропуски и серии (gaps and islands)

Идея: у подряд идущих значений разность «значение минус номер строки» постоянна.

```sql
-- самая длинная серия посещений подряд по дням
WITH d AS (
  SELECT DISTINCT user_id, visit_date FROM visits
), g AS (
  SELECT user_id, visit_date,
    visit_date - ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY visit_date)::int AS grp
  FROM d
)
SELECT user_id, COUNT(*) AS streak
FROM g GROUP BY user_id, grp
ORDER BY streak DESC LIMIT 1;
```

| visit_date | rn | grp |
|---|---|---|
| 01-01 | 1 | 12-31 |
| 01-02 | 2 | 12-31 |
| 01-03 | 3 | 12-31 |
| 01-05 | 4 | 01-01 |

Без `DISTINCT` повторные визиты в один день разорвут серию. Пропуски в последовательности id ищут через `LEAD(id) OVER (ORDER BY id) - id > 1` или `generate_series` + anti-join.

Объединение пересекающихся интервалов — тот же приём: помечаем начало новой группы, когда `s > MAX(e) OVER (ORDER BY s ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)`, затем нарастающей суммой флагов получаем номер группы и берём `MIN(s), MAX(e)`.

## Частые вопросы на собеседовании

- Как найти вторую зарплату с учётом дублей? → `DENSE_RANK` или `MAX(...) WHERE salary < MAX`.
- Что вернут решения, если второй зарплаты нет? → MAX — строку с NULL, OFFSET/оконное — 0 строк.
- Как оставить одну строку из дублей? → `DELETE ... USING` по `id >` или `ROW_NUMBER() > 1`.
- Как взять top-3 в каждом отделе с учётом равенства? → `DENSE_RANK() OVER (PARTITION BY dept ...) <= 3`.
- Как найти подряд идущие дни? → Дата минус ROW_NUMBER даёт константу группы.
- Условие пересечения интервалов? → `s1 < e2 AND s2 < e1`.

## Шпаргалка

| Задача | Шаблон |
|---|---|
| N-я зарплата | `DENSE_RANK() = N` |
| Дубликаты | `GROUP BY ... HAVING COUNT(*) > 1` |
| Удаление дублей | `ROW_NUMBER() > 1` |
| Top-N в группе | окно в подзапросе + `WHERE r <= N` |
| Последняя запись | `DISTINCT ON` / `ROW_NUMBER() = 1` |
| Нарастающий итог | `SUM() OVER (PARTITION BY ... ORDER BY ...)` |
| Доля | `x / SUM(x) OVER ()`, умножать на 100.0 |
| Оба товара | `HAVING COUNT(DISTINCT p) = 2` |
| Серии | дата минус ROW_NUMBER |
| Пересечение | `s1 < e2 AND s2 < e1` |
