В Python есть три способа делать несколько дел одновременно: потоки, процессы и asyncio. Выбор между ними определяется GIL и характером нагрузки. На собеседовании почти всегда спрашивают, что такое GIL, почему потоки не ускоряют вычисления и когда брать asyncio. Разберём модель и практические инструменты.

## GIL

**GIL** (Global Interpreter Lock) — мьютекс в CPython, который позволяет только одному потоку выполнять байткод Python в каждый момент. Он упрощает управление памятью (подсчёт ссылок) и работу C-расширений. Следствия:

- CPU-bound код в потоках не ускоряется — потоки по очереди держат GIL.
- I/O-bound код в потоках ускоряется: при ожидании сети, диска или `time.sleep` GIL отпускается.
- Многие C-библиотеки (NumPy, hashlib, zlib) отпускают GIL во время тяжёлых вычислений.

GIL не делает ваш код потокобезопасным: операция `x += 1` состоит из нескольких байткодов, и поток может быть прерван между ними.

## CPU-bound против I/O-bound

| Задача | Пример | Инструмент |
|---|---|---|
| I/O-bound, десятки соединений | HTTP-запросы, БД | `threading` / `ThreadPoolExecutor` |
| I/O-bound, тысячи соединений | веб-сервер, краулер, websockets | `asyncio` |
| CPU-bound | парсинг, математика, сжатие | `multiprocessing` / `ProcessPoolExecutor` |
| CPU-bound на массивах | матрицы, векторы | NumPy (отпускает GIL) |

Процессы обходят GIL, потому что у каждого свой интерпретатор, но они тяжелее: отдельная память, данные передаются через pickle, запуск дороже.

## Потоки и синхронизация

Общие данные между потоками защищают `Lock`. Также есть `RLock` (повторный захват тем же потоком), `Semaphore`, `Event`, `Condition` и потокобезопасная `queue.Queue`.

```python
import threading

counter = 0
lock = threading.Lock()

def work():
    global counter
    for _ in range(100_000):
        with lock:             # без lock результат может быть меньше
            counter += 1

threads = [threading.Thread(target=work) for _ in range(4)]
for t in threads: t.start()
for t in threads: t.join()
print(counter)                 # 400000
```

> Deadlock возникает, когда два потока захватывают два замка в разном порядке. Правило: всегда захватывайте замки в одном и том же порядке и используйте `with`, чтобы замок освобождался при исключении.

## concurrent.futures

Высокоуровневый API с единым интерфейсом для потоков и процессов. `map` возвращает результаты в порядке аргументов, `submit` + `as_completed` — в порядке готовности.

```python
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
import time

def io_task(n):
    time.sleep(0.2)
    return n * 2

def cpu_task(n):
    return sum(i * i for i in range(n))

if __name__ == "__main__":
    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=5) as pool:
        print(list(pool.map(io_task, range(5))))   # [0, 2, 4, 6, 8]
    print(f"{time.perf_counter() - start:.1f}s")   # 0.2s, а не 1.0s

    with ProcessPoolExecutor() as pool:
        futures = [pool.submit(cpu_task, n) for n in (10, 100)]
        print(sorted(f.result() for f in as_completed(futures)))   # [285, 328350]
```

Для процессов обязательна защита `if __name__ == "__main__":` — на Windows и macOS дочерний процесс заново импортирует модуль.

## asyncio: async/await

asyncio — кооперативная многозадачность в **одном потоке**. Корутина (`async def`) отдаёт управление циклу событий в точках `await`, пока ждёт I/O. Переключение происходит только в `await`, поэтому гонок меньше, чем с потоками.

```python
import asyncio, time

async def fetch(name, delay):
    await asyncio.sleep(delay)         # не блокирует цикл
    return f"{name} done"

async def main():
    start = time.perf_counter()
    results = await asyncio.gather(fetch("a", 0.2), fetch("b", 0.1))
    print(results)                     # ['a done', 'b done']

    async with asyncio.TaskGroup() as tg:   # 3.11+
        t1 = tg.create_task(fetch("c", 0.1))
        t2 = tg.create_task(fetch("d", 0.1))
    print(t1.result(), t2.result())    # c done d done
    print(f"{time.perf_counter() - start:.1f}s")   # 0.3s

asyncio.run(main())
```

- Вызов корутины без `await` ничего не выполняет — создаётся объект корутины и предупреждение «never awaited».
- `gather` сохраняет порядок результатов; `return_exceptions=True` возвращает ошибки как значения.
- `TaskGroup` — структурированная конкурентность: при ошибке одной задачи остальные отменяются, ошибки собираются в `ExceptionGroup`.
- `asyncio.wait_for(coro, timeout)` или `async with asyncio.timeout(1):` — таймауты.

## Блокирующие вызовы в async-коде

Синхронный вызов внутри корутины (`time.sleep`, `requests.get`, тяжёлый цикл) блокирует **весь** цикл событий — все остальные задачи стоят. Решения: асинхронные библиотеки (`aiohttp`, `httpx`, `asyncpg`) или вынос в поток через `asyncio.to_thread` (3.9+), а для CPU — `loop.run_in_executor` с пулом процессов.

```python
import asyncio, time

def blocking_io():
    time.sleep(0.1)
    return "file read"

async def main():
    result = await asyncio.to_thread(blocking_io)
    print(result)                      # file read

asyncio.run(main())
```

## Free-threaded Python 3.13+

С Python 3.13 есть экспериментальная сборка **без GIL** (PEP 703, исполняемый файл `python3.13t`), в 3.14 она получила официальный статус поддерживаемой, но по-прежнему не по умолчанию. В ней потоки по-настоящему выполняются параллельно на нескольких ядрах. Цена — небольшое замедление однопоточного кода и необходимость, чтобы C-расширения были совместимы. Проверить можно через `sys._is_gil_enabled()`.

## Частые вопросы на собеседовании

- Что такое GIL и зачем он? → замок, позволяющий одному потоку исполнять байткод; упрощает подсчёт ссылок и C-API.
- Ускорят ли потоки вычисление чисел? → нет, для CPU-bound нужны процессы или NumPy.
- Когда asyncio лучше потоков? → тысячи одновременных I/O-операций: корутины дешевле потоков.
- Что будет, если вызвать `time.sleep` в корутине? → заблокируется весь event loop; нужен `await asyncio.sleep`.
- Нужен ли Lock, если есть GIL? → да, `x += 1` не атомарна.
- Разница `gather` и `TaskGroup`? → `TaskGroup` отменяет остальные задачи при ошибке и даёт `ExceptionGroup`.

## Шпаргалка

- I/O → потоки или asyncio; CPU → процессы.
- GIL отпускается на I/O и в многих C-расширениях.
- Общие изменяемые данные в потоках — под `Lock`, через `with`.
- `ThreadPoolExecutor`/`ProcessPoolExecutor` — простой единый API.
- Процессы — только внутри `if __name__ == "__main__":`.
- В async-коде никаких блокирующих вызовов; `asyncio.to_thread` для старого синхронного кода.
- `asyncio.run(main())` — точка входа, `TaskGroup` — современный способ запускать задачи.
