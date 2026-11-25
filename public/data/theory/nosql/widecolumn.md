Wide-column хранилища (Apache Cassandra, ScyllaDB, HBase) рассчитаны на огромные объёмы записи и линейное масштабирование добавлением узлов. Цена — жёсткая привязка модели к запросам. Рядом часто обсуждают колоночные OLAP-СУБД вроде ClickHouse: название похожее, но задача другая — аналитика. На собеседовании проверяют понимание ключей, tunable consistency и устройства LSM-хранилища.

## Архитектура Cassandra

- **Masterless**: все узлы равноправны. Любой узел может быть координатором запроса.
- **Кольцо токенов**: партиционер (Murmur3) хеширует partition key в токен, токен определяет узлы-реплики. Виртуальные узлы (vnodes) выравнивают распределение.
- **Gossip**: узлы раз в секунду обмениваются состоянием, а отказы определяет phi accrual failure detector.
- **Replication factor** задаётся на keyspace, обычно через `NetworkTopologyStrategy` отдельно для каждого ДЦ.

```sql
CREATE KEYSPACE chat WITH replication =
  {'class': 'NetworkTopologyStrategy', 'dc1': 3, 'dc2': 3};
```

## Partition key и clustering key

```sql
CREATE TABLE messages_by_chat (
  chat_id  uuid,
  sent_at  timeuuid,
  author   text,
  body     text,
  PRIMARY KEY ((chat_id), sent_at)
) WITH CLUSTERING ORDER BY (sent_at DESC);
```

- **Partition key** (`chat_id`) определяет, где лежат данные. Все строки партиции хранятся вместе на одних и тех же репликах.
- **Clustering columns** (`sent_at`) задают порядок строк внутри партиции. Диапазоны и `ORDER BY` возможны только по ним и только внутри партиции.

Правила запросов: нужен **полный partition key**, а clustering columns ограничиваются **по порядку без пропусков**. Фильтр по обычной колонке требует `ALLOW FILTERING`, то есть скана, — в продакшене это красный флаг.

## Query-first моделирование

JOIN нет, эффективен только доступ по партиции. Поэтому таблицы проектируют от запросов: `messages_by_chat`, `messages_by_user`, `users_by_email`, — а данные дублируются при записи (через batch-запись в несколько таблиц).

Главные ошибки моделирования:

- **Неограниченная партиция**: `PRIMARY KEY ((sensor_id), ts)` растёт годами. Решение — бакет в partition key: `PRIMARY KEY ((sensor_id, day), ts)`. Ориентир — партиция до примерно 100 МБ.
- **Горячая партиция**: один ключ получает непропорционально много трафика.
- **Очередь на Cassandra**: постоянные удаления копят tombstones, и чтение «головы» деградирует.

### Batch, вторичные индексы и materialized views

**Batch** в Cassandra — не инструмент ускорения. Logged batch гарантирует, что все записи в несколько таблиц со временем применятся (через batchlog), но это не изоляция и не транзакция. Batch по многим разным партициям нагружает координатор, поэтому массовую загрузку делают отдельными асинхронными запросами.

**Вторичные индексы** (2i) локальны для узла: запрос без partition key опрашивает все узлы, поэтому они годятся только для колонок с низкой селективностью внутри уже выбранной партиции. В Cassandra 5 появились **SAI** (Storage-Attached Indexes) — заметно эффективнее, но и они не заменяют правильно спроектированную таблицу.

**Materialized views** автоматически поддерживают денормализованную копию, однако помечены как экспериментальные из-за проблем с консистентностью. На практике дублирование делают сами в коде приложения.

```sql
-- одна логическая запись — две таблицы под два запроса
BEGIN BATCH
  INSERT INTO messages_by_chat (chat_id, sent_at, author, body) VALUES (?, ?, ?, ?);
  INSERT INTO messages_by_user (author, sent_at, chat_id, body) VALUES (?, ?, ?, ?);
APPLY BATCH;
```

## Tunable consistency

Уровень консистентности задаётся на каждый запрос: `ONE`, `TWO`, `QUORUM`, `LOCAL_QUORUM`, `EACH_QUORUM`, `ALL`. QUORUM = floor(RF / 2) + 1.

| RF = 3 | Запись W | Чтение R | R + W > RF | Отказ одной реплики |
|---|---|---|---|---|
| Быстро, eventual | ONE | ONE | Нет | Переживает |
| Сбалансировано | QUORUM | QUORUM | Да | Переживает |
| Быстрое чтение | ALL | ONE | Да | Запись недоступна |
| Быстрая запись | ONE | ALL | Да | Чтение недоступно |

В мульти-ДЦ используют `LOCAL_QUORUM`, чтобы не ждать межрегиональной задержки.

**Lightweight transactions** (`INSERT ... IF NOT EXISTS`, `UPDATE ... IF col = ?`) дают compare-and-set в пределах партиции через Paxos (уровень `SERIAL`). Это несколько сетевых раундов, поэтому LWT применяют точечно, например для уникальности email.

## Путь записи и чтения: LSM-дерево

1. Запись попадает в **commit log** (для durability) и в **memtable** в памяти. Чтения перед записью нет, поэтому запись дешёвая.
2. Заполненная memtable сбрасывается в неизменяемую **SSTable** на диске.
3. **Compaction** сливает SSTable, оставляя последние версии по timestamp и вычищая удалённые данные.

`INSERT` и `UPDATE` — одинаковый **upsert**. Чтение может затронуть несколько SSTable; лишние отсекают Bloom-фильтры, а версии сливаются по timestamp (last-write-wins).

| Стратегия compaction | Когда |
|---|---|
| SizeTiered (STCS) | Write-heavy общего вида, по умолчанию |
| Leveled (LCS) | Read-heavy, меньше SSTable на чтение, больше I/O на запись |
| TimeWindow (TWCS) | Time-series с TTL: окна удаляются целиком |
| Unified (UCS, Cassandra 5) | Настраиваемая замена STCS/LCS |

**Tombstones**: `DELETE` и истечение TTL пишут маркер удаления. Он удаляется при compaction не раньше `gc_grace_seconds` (по умолчанию 10 дней). Множество tombstones замедляет чтение, а при `tombstone_failure_threshold` (100 000) запрос падает.

## Восстановление расхождений

- **Hinted handoff** — координатор хранит «подсказки» для лежащей реплики и досылает их в пределах `max_hint_window` (3 часа).
- **Read repair** — при чтении с расхождением реплик устаревшие исправляются.
- **Anti-entropy repair** (`nodetool repair`) — сравнение деревьев Меркла. Его обязательно запускают чаще, чем `gc_grace_seconds`, иначе удалённые данные «воскреснут» с реплики, пропустившей tombstone.

## ClickHouse и колоночный OLAP

Колоночные СУБД хранят каждую колонку отдельно. Аналитический запрос читает только нужные колонки, однотипные значения отлично сжимаются, а обработка идёт векторно пачками.

```sql
CREATE TABLE events (
  user_id UInt64,
  ts      DateTime,
  event   LowCardinality(String)
) ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (user_id, ts);
```

В **MergeTree** данные пишутся кусками (parts), отсортированными по `ORDER BY`, и фоново сливаются. Первичный ключ — **разреженный индекс** по гранулам (обычно 8192 строки), он не уникален. ClickHouse любит большие пакетные вставки и плохо переносит точечные UPDATE и DELETE.

## Частые вопросы на собеседовании

- Partition key и clustering key — в чём разница? → Первый определяет узлы, второй — порядок внутри партиции.
- Почему Cassandra быстро пишет? → LSM: commit log и memtable, append-only, без чтения перед записью и без master.
- Как получить сильную консистентность? → `R + W > RF`, например QUORUM/QUORUM.
- Что такое tombstone и чем он опасен? → Маркер удаления. Медленные чтения и риск воскрешения данных без repair.
- Как моделировать time-series? → Бакет по времени в partition key, TWCS, TTL.
- Почему ClickHouse быстр для аналитики? → Колоночное хранение, сжатие, векторное выполнение, разреженный индекс.

## Шпаргалка

- `PRIMARY KEY ((pk), ck1, ck2)`: pk — размещение, ck — сортировка.
- Нужен полный pk; ck — по порядку; иначе `ALLOW FILTERING`.
- Одна таблица на запрос; дублирование — норма.
- QUORUM = RF/2 + 1; `R + W > RF`; `LOCAL_QUORUM` для мульти-ДЦ.
- Commit log → memtable → SSTable → compaction.
- STCS — запись, LCS — чтение, TWCS — time-series.
- `gc_grace_seconds` 10 дней; repair чаще этого срока.
- ClickHouse: MergeTree, `ORDER BY` — разреженный индекс, батчевые вставки.
