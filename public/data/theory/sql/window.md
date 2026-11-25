Оконные функции вычисляют значение для каждой строки на основе набора связанных строк — «окна» — и при этом **не сворачивают строки**, в отличие от `GROUP BY`. Это главный инструмент для рейтингов, нарастающих итогов, сравнения с предыдущим периодом и top-N в группе. Почти каждое собеседование по SQL содержит хотя бы одну задачу на окна.

## Синтаксис OVER

```sql
функция(...) OVER (
  PARTITION BY ...   -- на какие группы делить
  ORDER BY ...       -- порядок внутри группы
  ROWS/RANGE ...     -- рамка (frame)
)
```

```sql
SELECT name, dept, salary,
  SUM(salary) OVER (PARTITION BY dept) AS dept_total,
  salary - AVG(salary) OVER (PARTITION BY dept) AS diff
FROM emp;
```

| name | dept | salary | dept_total |
|---|---|---|---|
| Ann | IT | 300 | 500 |
| Bob | IT | 200 | 500 |
| Cid | HR | 100 | 100 |

Строк столько же, сколько в таблице, — в этом отличие от `SUM ... GROUP BY dept`, который вернул бы по строке на отдел. `OVER ()` без параметров — окно из всей выборки: `SUM(amount) OVER ()` даёт общую сумму в каждой строке.

## Где можно использовать

Оконные функции вычисляются после `WHERE`, `GROUP BY` и `HAVING`, поэтому разрешены **только в SELECT и ORDER BY**. В `WHERE` — ошибка «window functions are not allowed in WHERE». Чтобы отфильтровать по результату окна, оборачивают запрос:

```sql
SELECT * FROM (
  SELECT name, dept, salary,
         ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn
  FROM emp
) t
WHERE rn <= 3;
```

Окно можно применять поверх агрегатов: `SUM(SUM(amount)) OVER ()` — доля группы в общем итоге. Повторяющееся окно выносят в `WINDOW w AS (...)`.

## Ранжирующие функции

| salary | ROW_NUMBER | RANK | DENSE_RANK |
|---|---|---|---|
| 500 | 1 | 1 | 1 |
| 400 | 2 | 2 | 2 |
| 400 | 3 | 2 | 2 |
| 300 | 4 | 4 | 3 |

- `ROW_NUMBER()` — уникальный номер; при равенстве порядок произвольный.
- `RANK()` — равным одинаковый ранг, после них пропуск.
- `DENSE_RANK()` — без пропусков. Для «второй по величине зарплаты» нужен именно он.
- `NTILE(n)` — делит строки на n групп как можно ровнее; лишние строки идут в первые группы (10 строк на 3 группы → 4, 3, 3).
- `PERCENT_RANK()`, `CUME_DIST()` — относительное положение.

## LAG, LEAD, FIRST_VALUE

```sql
SELECT day, revenue,
  revenue - LAG(revenue) OVER (ORDER BY day)     AS diff,
  LEAD(revenue, 1, 0) OVER (ORDER BY day)        AS nxt
FROM daily;
```

| day | revenue | diff | nxt |
|---|---|---|---|
| 1 | 100 | NULL | 120 |
| 2 | 120 | 20 | 90 |
| 3 | 90 | -30 | 0 |

`LAG(x, n, default)` — значение n строк назад; без default за границей получится `NULL`. `FIRST_VALUE(x)` — первое значение окна.

> Ловушка: `LAST_VALUE(x) OVER (ORDER BY ...)` возвращает **текущую строку**, а не последнюю в разделе — из-за рамки по умолчанию. Нужно явно указать `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.

## Рамка окна: ROWS и RANGE

Если в `OVER` есть `ORDER BY`, рамка по умолчанию — `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. Без `ORDER BY` — весь раздел. Поэтому `SUM(x) OVER (ORDER BY d)` — нарастающий итог.

Разница `ROWS` и `RANGE` видна на дубликатах ключа сортировки:

| x | ROWS: SUM | RANGE: SUM |
|---|---|---|
| 1 | 1 | 1 |
| 2 | 3 | 5 |
| 2 | 5 | 5 |
| 3 | 8 | 8 |

`RANGE` включает в рамку всех «соседей» с тем же значением (peers), `ROWS` считает физические строки. Для детерминированного нарастающего итога используйте `ROWS` или уникальный ключ сортировки.

```sql
-- скользящее среднее за 3 строки
AVG(v) OVER (ORDER BY d ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)
-- RANGE со смещением по значению (PG 11+)
SUM(v) OVER (ORDER BY d RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW)
-- нарастающий итог по каждому счёту
SUM(amount) OVER (PARTITION BY acc ORDER BY d ROWS UNBOUNDED PRECEDING)
```

В PostgreSQL есть ещё режим `GROUPS` и `EXCLUDE CURRENT ROW`. В MySQL оконные функции появились только в 8.0.

## Частые вопросы на собеседовании

- Чем `SUM() OVER (PARTITION BY)` отличается от `GROUP BY`? → Окно не сворачивает строки.
- Разница RANK и DENSE_RANK? → RANK оставляет пропуски после равных, DENSE_RANK — нет.
- Можно ли использовать оконную функцию в WHERE? → Нет, только SELECT и ORDER BY; фильтруют во внешнем запросе.
- Почему LAST_VALUE возвращает текущее значение? → Рамка по умолчанию заканчивается на CURRENT ROW.
- Какая рамка по умолчанию при ORDER BY? → RANGE от UNBOUNDED PRECEDING до CURRENT ROW.
- Что вернёт LAG в первой строке? → NULL или указанный default.

## Шпаргалка

| Задача | Функция |
|---|---|
| Номер строки | `ROW_NUMBER()` |
| Рейтинг с пропусками / без | `RANK()` / `DENSE_RANK()` |
| Предыдущее / следующее | `LAG()` / `LEAD()` |
| Нарастающий итог | `SUM() OVER (ORDER BY ... ROWS UNBOUNDED PRECEDING)` |
| Итог группы в строке | `SUM() OVER (PARTITION BY g)` |
| Общий итог | `SUM() OVER ()` |
| Корзины | `NTILE(n)` |
| Рамка по умолчанию | RANGE UNBOUNDED PRECEDING .. CURRENT ROW |
| Где разрешены | SELECT, ORDER BY |
