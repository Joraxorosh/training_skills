Аналитические запросы — это SQL для продуктовых и бизнес-метрик: DAU и MAU, выручка по периодам, retention по когортам, конверсия воронки. Здесь важны аккуратная работа с датами и часовыми поясами, правильные знаменатели и понимание, что считается «пользователем» и «событием». Такие задачи часто дают аналитикам данных и продуктовым аналитикам.

## Работа с датами

```sql
SELECT date_trunc('month', created_at) AS month, SUM(amount)
FROM orders
GROUP BY 1 ORDER BY 1;
```

- `date_trunc('day' | 'week' | 'month' | 'year', ts)` — обрезает до начала периода; неделя начинается с понедельника.
- `extract(dow FROM ts)` — день недели (0 = воскресенье), `extract(isodow ...)` — 1 = понедельник.
- `ts::date` — дата без времени; `to_char(ts, 'YYYY-MM')` — форматирование.
- `age(a, b)`, вычитание дат: `date - date` даёт число дней, `timestamp - timestamp` — `interval`.
- `now()` и `current_date` фиксированы на начало транзакции.

Фильтр по периоду пишите полуоткрытым диапазоном — он корректно работает с `timestamp` и использует индекс:

```sql
WHERE created_at >= '2024-03-01' AND created_at < '2024-04-01'
```

`BETWEEN '2024-03-01' AND '2024-03-31'` потеряет все события 31 марта после полуночи.

Часовые пояса: `timestamptz` хранит момент в UTC. Чтобы сгруппировать по локальным суткам, переводите явно: `date_trunc('day', created_at AT TIME ZONE 'Europe/Moscow')`.

## Заполнение пропусков в рядах

Если в какой-то день не было заказов, `GROUP BY` просто не вернёт этот день. Для графиков нужен полный календарь:

```sql
SELECT d::date AS day, COALESCE(SUM(o.amount), 0) AS revenue
FROM generate_series(date '2024-03-01', date '2024-03-31', interval '1 day') d
LEFT JOIN orders o
  ON o.created_at >= d AND o.created_at < d + interval '1 day'
GROUP BY d ORDER BY d;
```

## Активность: DAU, MAU, скользящие метрики

```sql
-- DAU
SELECT created_at::date AS day, COUNT(DISTINCT user_id) AS dau
FROM events GROUP BY 1;

-- MAU
SELECT date_trunc('month', created_at) AS m, COUNT(DISTINCT user_id)
FROM events GROUP BY 1;

-- выручка и прирост к прошлому месяцу
WITH m AS (
  SELECT date_trunc('month', created_at) AS month, SUM(amount) AS rev
  FROM orders GROUP BY 1
)
SELECT month, rev,
  ROUND(100.0 * (rev - LAG(rev) OVER (ORDER BY month))
        / LAG(rev) OVER (ORDER BY month), 1) AS mom_pct
FROM m;
```

Ключевое — `COUNT(DISTINCT user_id)`, а не `COUNT(*)`: иначе считаются события, а не пользователи. Учтите, что MAU нельзя получить суммой DAU. Скользящее среднее за 7 дней — `AVG(dau) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)` поверх дневного ряда без пропусков.

## Когортный анализ и retention

Когорта — пользователи, объединённые датой первого действия (регистрации или первой покупки). Retention месяца N — доля когорты, активная через N месяцев.

```sql
WITH first AS (
  SELECT user_id, date_trunc('month', MIN(created_at)) AS cohort
  FROM events GROUP BY user_id
), act AS (
  SELECT DISTINCT e.user_id, f.cohort,
    (extract(year FROM age(date_trunc('month', e.created_at), f.cohort)) * 12
     + extract(month FROM age(date_trunc('month', e.created_at), f.cohort)))::int AS month_n
  FROM events e JOIN first f USING (user_id)
)
SELECT cohort, month_n,
  COUNT(*) AS users,
  ROUND(100.0 * COUNT(*) / FIRST_VALUE(COUNT(*)) OVER (
    PARTITION BY cohort ORDER BY month_n), 1) AS retention_pct
FROM act
GROUP BY cohort, month_n
ORDER BY cohort, month_n;
```

| cohort | month_n | users | retention_pct |
|---|---|---|---|
| 2024-01 | 0 | 200 | 100.0 |
| 2024-01 | 1 | 84 | 42.0 |
| 2024-01 | 2 | 61 | 30.5 |

Типичные ошибки: делить на всех пользователей, а не на размер когорты; забыть `DISTINCT` (пользователь с 10 событиями учтётся 10 раз); использовать `MIN` по событиям вместо даты регистрации, когда в задаче явно сказано про регистрацию.

## Воронки

Воронка — последовательность шагов (просмотр → корзина → оплата) и конверсия между ними.

```sql
SELECT
  COUNT(DISTINCT user_id) FILTER (WHERE event = 'view')     AS views,
  COUNT(DISTINCT user_id) FILTER (WHERE event = 'cart')     AS carts,
  COUNT(DISTINCT user_id) FILTER (WHERE event = 'purchase') AS buyers,
  ROUND(100.0 * COUNT(DISTINCT user_id) FILTER (WHERE event = 'purchase')
        / NULLIF(COUNT(DISTINCT user_id) FILTER (WHERE event = 'view'), 0), 1) AS cr
FROM events
WHERE created_at >= '2024-03-01' AND created_at < '2024-04-01';
```

Это «открытая» воронка — шаги считаются независимо. Строгая воронка требует порядка шагов по времени:

```sql
WITH s AS (
  SELECT user_id,
    MIN(created_at) FILTER (WHERE event = 'view')     AS t_view,
    MIN(created_at) FILTER (WHERE event = 'cart')     AS t_cart,
    MIN(created_at) FILTER (WHERE event = 'purchase') AS t_buy
  FROM events GROUP BY user_id
)
SELECT
  COUNT(t_view) AS step1,
  COUNT(*) FILTER (WHERE t_cart > t_view) AS step2,
  COUNT(*) FILTER (WHERE t_buy > t_cart AND t_cart > t_view) AS step3
FROM s;
```

`NULLIF(..., 0)` защищает от деления на ноль, `100.0` — от целочисленного деления.

## Прочие метрики

- **ARPU** = выручка / число активных пользователей; **ARPPU** — делим только на платящих.
- **Средний чек** = `SUM(amount) / COUNT(DISTINCT order_id)`.
- **Медиана**: `percentile_cont(0.5) WITHIN GROUP (ORDER BY amount)`; `percentile_disc` возвращает реальное значение из набора.
- **Время между событиями**: `created_at - LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at)`.
- **Сессии**: новая сессия, если пауза больше 30 минут — флаг через `LAG` и нарастающая сумма флагов.
- **Отток (churn)**: пользователи, активные в прошлом периоде и неактивные в текущем — anti-join между периодами.

## Частые вопросы на собеседовании

- Как посчитать DAU? → `COUNT(DISTINCT user_id)` с группировкой по дате.
- Почему BETWEEN по timestamp опасен? → Теряет события последнего дня после полуночи; используйте `>= AND <`.
- Как показать дни без продаж? → `generate_series` + LEFT JOIN + COALESCE.
- Что такое когорта и retention? → Группа по дате первого действия; доля когорты, активной через N периодов.
- Чем открытая воронка отличается от строгой? → Строгая учитывает порядок шагов во времени.
- Как посчитать медиану? → `percentile_cont(0.5) WITHIN GROUP (ORDER BY x)`.

## Шпаргалка

| Задача | Инструмент |
|---|---|
| Группировка по периоду | `date_trunc` |
| Фильтр периода | `>= начало AND < следующее начало` |
| Пропущенные дни | `generate_series` + LEFT JOIN |
| Уникальные пользователи | `COUNT(DISTINCT user_id)` |
| Прирост к прошлому периоду | `LAG() OVER (ORDER BY period)` |
| Когорта | `MIN(дата)` по пользователю |
| Шаги воронки | `COUNT(DISTINCT ...) FILTER (WHERE ...)` |
| Деление | `100.0 *`, `NULLIF(x, 0)` |
| Медиана | `percentile_cont(0.5)` |
| Локальные сутки | `AT TIME ZONE` |
