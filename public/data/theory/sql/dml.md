DML (Data Manipulation Language) — команды изменения данных: `INSERT`, `UPDATE`, `DELETE`, а также `MERGE` и «upsert» через `ON CONFLICT`. На собеседовании проверяют синтаксис многострочной вставки, обновление с соединением, разницу `DELETE` и `TRUNCATE`, работу `RETURNING` и тонкости `ON CONFLICT`.

## INSERT

```sql
-- несколько строк одной командой
INSERT INTO users (name, email) VALUES
  ('Ann', 'ann@x.io'),
  ('Bob', 'bob@x.io');

-- из запроса
INSERT INTO orders_archive (id, total)
SELECT id, total FROM orders WHERE created_at < '2024-01-01';

-- значения по умолчанию
INSERT INTO logs DEFAULT VALUES;
```

Список столбцов лучше указывать всегда: без него значения сопоставляются по порядку столбцов таблицы, и добавление столбца сломает код. Пропущенные столбцы получают `DEFAULT` (или `NULL`).

## RETURNING

PostgreSQL умеет возвращать строки из `INSERT`, `UPDATE`, `DELETE` и (с 17-й версии) `MERGE`:

```sql
INSERT INTO users (name) VALUES ('Cid') RETURNING id, created_at;
UPDATE products SET price = price * 1.1 WHERE category = 'A' RETURNING id, price;
DELETE FROM sessions WHERE expires_at < now() RETURNING user_id;
```

`RETURNING` в `UPDATE` возвращает **новые** значения строки. В PostgreSQL 18 появились `OLD` и `NEW` для доступа к обоим. В MySQL `RETURNING` нет (есть в MariaDB).

Вместе с CTE это позволяет перемещать строки одной командой:

```sql
WITH moved AS (
  DELETE FROM orders WHERE status = 'closed' RETURNING *
)
INSERT INTO orders_archive SELECT * FROM moved;
```

## UPDATE

```sql
UPDATE emp SET salary = salary * 1.1, updated_at = now()
WHERE dept = 'IT';
```

Все выражения в `SET` вычисляются по **старым** значениям строки: `UPDATE t SET a = b, b = a` меняет значения местами (в MySQL — нет, там присваивания последовательны).

Обновление на основе другой таблицы в PostgreSQL — через `FROM`:

```sql
UPDATE orders o
SET discount = c.discount
FROM customers c
WHERE c.id = o.customer_id AND c.vip;
```

Если одной строке `orders` соответствует несколько строк в `FROM`, будет использована **одна произвольная** — результат недетерминирован. В MySQL синтаксис другой: `UPDATE orders o JOIN customers c ON ... SET ...`.

> `UPDATE` или `DELETE` без `WHERE` затрагивает всю таблицу. Перед опасной командой запустите тот же `WHERE` в `SELECT` или работайте внутри `BEGIN`.

## DELETE и TRUNCATE

```sql
DELETE FROM orders WHERE created_at < now() - interval '1 year';

DELETE FROM a USING b WHERE a.id = b.a_id;  -- удаление с соединением (PG)

TRUNCATE orders RESTART IDENTITY CASCADE;
```

| | DELETE | TRUNCATE |
|---|---|---|
| Условие WHERE | да | нет, удаляет всё |
| Скорость на больших таблицах | медленно, построчно | мгновенно |
| Триггеры ON DELETE | срабатывают | нет |
| RETURNING | да | нет |
| Блокировка | строк | ACCESS EXCLUSIVE на таблицу |
| Откат в транзакции PG | да | да |
| Сброс последовательностей | нет | с RESTART IDENTITY |

`TRUNCATE` таблицы, на которую ссылаются внешние ключи, требует `CASCADE`. После `DELETE` место освобождается не сразу — мёртвые версии строк убирает `VACUUM`.

## UPSERT: ON CONFLICT

```sql
INSERT INTO stock (sku, qty) VALUES ('A', 5)
ON CONFLICT (sku) DO UPDATE
SET qty = stock.qty + EXCLUDED.qty;

INSERT INTO users (email) VALUES ('a@x.io')
ON CONFLICT (email) DO NOTHING;
```

- `EXCLUDED` — строка, которую пытались вставить; `stock.qty` — текущее значение в таблице.
- Для `ON CONFLICT (col)` на столбце обязательно должно быть **UNIQUE-ограничение или уникальный индекс**, иначе ошибка «there is no unique or exclusion constraint matching the ON CONFLICT specification».
- `DO UPDATE ... WHERE` позволяет обновлять только при условии.
- Одна команда не может затронуть одну и ту же строку дважды: две строки с одинаковым ключом в одном `VALUES` при `DO UPDATE` дадут ошибку «command cannot affect row a second time».
- Операция атомарна и безопасна при конкурентной вставке. Последовательность при этом всё равно расходует значение — в id появятся дыры.

В MySQL аналог — `INSERT ... ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`.

## MERGE

Стандартная команда (PostgreSQL 15+) для синхронизации таблицы с источником:

```sql
MERGE INTO stock s
USING incoming i ON s.sku = i.sku
WHEN MATCHED AND i.qty = 0 THEN DELETE
WHEN MATCHED THEN UPDATE SET qty = s.qty + i.qty
WHEN NOT MATCHED THEN INSERT (sku, qty) VALUES (i.sku, i.qty);
```

Ветки `WHEN` проверяются по порядку, срабатывает первая подходящая. В отличие от `ON CONFLICT`, `MERGE` не требует уникального индекса, но при конкурентных вставках может завершиться ошибкой уникальности. PostgreSQL 17 добавил `WHEN NOT MATCHED BY SOURCE` и `RETURNING`.

## Массовая загрузка

- `COPY t FROM '/path/file.csv' WITH (FORMAT csv, HEADER)` — читает файл **на сервере** базы; `\copy` в psql читает файл **на клиенте** и передаёт его.
- Многострочные `INSERT` и одна транзакция вместо тысяч автокоммитов.
- Временно удалить индексы и внешние ключи, загрузить, создать заново; после загрузки — `ANALYZE`.

## Частые вопросы на собеседовании

- Как вставить несколько строк одним INSERT? → `VALUES (...), (...)`.
- Что такое EXCLUDED? → Строка, которая конфликтовала при вставке.
- Что нужно для ON CONFLICT (col)? → Уникальное ограничение или индекс на col.
- Чем TRUNCATE отличается от DELETE? → Нет WHERE и триггеров, мгновенно, блокирует таблицу; в PG откатывается.
- Какие команды поддерживают RETURNING? → INSERT, UPDATE, DELETE, MERGE (PG 17+).
- Чем COPY отличается от \copy? → Файл на сервере против файла на клиенте.

## Шпаргалка

| Задача | PostgreSQL |
|---|---|
| Вставка нескольких строк | `INSERT ... VALUES (...), (...)` |
| Получить id | `RETURNING id` |
| Обновление с join | `UPDATE ... FROM ... WHERE` |
| Удаление с join | `DELETE ... USING ... WHERE` |
| Upsert | `ON CONFLICT (key) DO UPDATE SET ... EXCLUDED.x` |
| Игнорировать дубли | `ON CONFLICT DO NOTHING` |
| Синхронизация | `MERGE` (15+) |
| Быстрая загрузка | `COPY` / `\copy` |
