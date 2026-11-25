Соединения (JOIN) объединяют строки нескольких таблиц по условию. На собеседовании почти всегда дают две маленькие таблицы и спрашивают, сколько строк вернёт запрос. Чтобы отвечать уверенно, нужно понимать, как каждый тип соединения обращается с отсутствующими парами, дубликатами ключей и `NULL`.

## Типы соединений

Возьмём две таблицы:

| customers.id | name |
|---|---|
| 1 | Ann |
| 2 | Bob |
| 3 | Cid |

| orders.id | customer_id | amount |
|---|---|---|
| 10 | 1 | 100 |
| 11 | 1 | 50 |
| 12 | 2 | 70 |
| 13 | NULL | 30 |

- `INNER JOIN` (или просто `JOIN`) — только строки, у которых нашлась пара. Здесь 3 строки: Ann×2, Bob×1.
- `LEFT JOIN` — все строки левой таблицы; где пары нет, правые столбцы `NULL`. Здесь 4 строки: Ann×2, Bob, Cid с `NULL`.
- `RIGHT JOIN` — зеркально: все строки правой. Здесь 4 строки, заказ 13 с `NULL` в name.
- `FULL JOIN` — все строки обеих таблиц: 5 строк (3 пары + Cid + заказ 13).
- `CROSS JOIN` — декартово произведение: 3 × 4 = 12 строк.

```sql
SELECT c.name, o.amount
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id;
```

| name | amount |
|---|---|
| Ann | 100 |
| Ann | 50 |
| Bob | 70 |
| Cid | NULL |

> MySQL не поддерживает `FULL JOIN` — его эмулируют через `LEFT JOIN ... UNION ... RIGHT JOIN`.

## Дубликаты ключей размножают строки

Если в левой таблице ключ встречается 2 раза, а в правой 3 раза, `INNER JOIN` даст 2 × 3 = 6 строк по этому ключу. Это главный источник «раздутых» сумм:

```sql
-- ошибка: сумма заказов умножится на число платежей
SELECT c.name, SUM(o.amount)
FROM customers c
JOIN orders o   ON o.customer_id = c.id
JOIN payments p ON p.customer_id = c.id
GROUP BY c.name;
```

Решение — агрегировать каждую таблицу отдельно в подзапросе и соединять уже агрегаты.

## NULL в условии соединения

`NULL = NULL` — это не `true`, поэтому строки с `NULL` в ключе **никогда не находят пару** в `INNER JOIN`. Если нужно считать `NULL` равными, используйте `IS NOT DISTINCT FROM`.

## ON против WHERE во внешних соединениях

Для `INNER JOIN` разницы нет. Для `LEFT JOIN` — огромная:

```sql
-- фильтр в ON: все клиенты остаются, заказы только крупные
SELECT c.name, o.amount
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.amount > 60;

-- фильтр в WHERE: строки с NULL отсекаются, LEFT превращается в INNER
SELECT c.name, o.amount
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.amount > 60;
```

Первый запрос вернёт Ann 100, Bob 70, Cid NULL. Второй — только Ann 100 и Bob 70.

## Anti-join и semi-join

Найти клиентов **без заказов** (anti-join):

```sql
-- 1. LEFT JOIN + IS NULL
SELECT c.* FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL;

-- 2. NOT EXISTS — самый надёжный
SELECT c.* FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);

-- 3. NOT IN — ОПАСНО: вернёт 0 строк, если в orders.customer_id есть NULL
SELECT * FROM customers WHERE id NOT IN (SELECT customer_id FROM orders);
```

Клиенты **с хотя бы одним заказом**, каждый один раз (semi-join): `WHERE EXISTS (...)` или `WHERE id IN (SELECT customer_id ...)`. Простой `JOIN` вернёт Ann дважды — понадобится `DISTINCT`.

## Self join, USING, NATURAL

Self join — соединение таблицы с самой собой, например сотрудник и его менеджер:

```sql
SELECT e.name, m.name AS manager
FROM emp e
LEFT JOIN emp m ON m.id = e.manager_id;
```

`JOIN ... USING (id)` соединяет по одноимённым столбцам и выводит общий столбец **один раз** — поэтому `SELECT *` вернёт на один столбец меньше, чем при `ON`. `NATURAL JOIN` соединяет по **всем** одноимённым столбцам — хрупко, при добавлении столбца поведение тихо меняется. Если общих столбцов нет, `NATURAL JOIN` превращается в `CROSS JOIN`.

В PostgreSQL есть `LATERAL` — подзапрос справа видит столбцы левой таблицы (удобно для top-N на группу):

```sql
SELECT c.name, o.amount
FROM customers c
CROSS JOIN LATERAL (
  SELECT amount FROM orders WHERE customer_id = c.id
  ORDER BY amount DESC LIMIT 1
) o;
```

## Частые вопросы на собеседовании

- Что такое просто `JOIN` без уточнения? → `INNER JOIN`.
- Сколько строк даст `CROSS JOIN` таблиц на 3 и 4 строки? → 12.
- Почему `LEFT JOIN` «превратился» в `INNER`? → Условие на правую таблицу стоит в WHERE и отсекает NULL.
- Как найти записи без пары? → `NOT EXISTS` или `LEFT JOIN ... WHERE right.id IS NULL`; осторожно с `NOT IN` и NULL.
- Может ли `LEFT JOIN` вернуть больше строк, чем в левой таблице? → Да, если у ключа несколько пар справа.
- Соединяются ли NULL-ключи? → Нет, `NULL = NULL` не true.

## Шпаргалка

| Соединение | Результат |
|---|---|
| INNER | только пары |
| LEFT | все левые + пары или NULL |
| RIGHT | все правые + пары или NULL |
| FULL | все строки обеих таблиц |
| CROSS | N × M |
| USING | общий столбец один раз |
| Anti-join | NOT EXISTS / LEFT JOIN + IS NULL |
| Semi-join | EXISTS / IN |
