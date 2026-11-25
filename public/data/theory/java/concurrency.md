Многопоточность в Java — одна из самых «глубоких» тем на собеседовании. Нужно понимать не только API (`Thread`, `ExecutorService`, `CompletableFuture`), но и модель памяти: почему без синхронизации поток может не увидеть чужую запись и чем видимость отличается от атомарности. В Java 21 к этому добавились виртуальные потоки.

## Потоки, задачи и пулы

`Runnable` — задача без результата, `Callable<V>` возвращает значение и может бросать checked-исключения. Поток запускает `start()`: он создаёт поток ОС и вызывает `run()` уже в нём. Прямой вызов `run()` — обычный вызов метода в текущем потоке.

Создавать потоки вручную на каждую задачу дорого, поэтому используют пулы через `ExecutorService`:

```java
try (ExecutorService pool = Executors.newFixedThreadPool(4)) {   // Java 19+: AutoCloseable
    Future<Integer> f = pool.submit(() -> 6 * 7);                // Callable
    System.out.println(f.get());                                 // 42, блокирует
}   // close() вызывает shutdown() и ждёт завершения задач
```

Без `shutdown()` рабочие потоки пула (не daemon) не дадут JVM завершиться. Исключение из задачи не теряется: оно придёт обёрнутым в `ExecutionException` при `get()`.

## Гонки, synchronized и мониторы

`count++` — это три шага (чтение, сложение, запись), и параллельные потоки теряют инкременты. `synchronized` захватывает **монитор** объекта: нестатический метод — монитор `this`, статический — объект `Class`, блок — указанный объект. Монитор реентерабелен и даёт и взаимное исключение, и видимость.

```java
class Counter {
    private int value;
    private final Object lock = new Object();

    void inc() {
        synchronized (lock) { value++; }
    }
    int get() {
        synchronized (lock) { return value; }
    }
}
```

`wait()` и `notify()` вызываются только внутри `synchronized` на том же объекте (иначе `IllegalMonitorStateException`). `wait()` освобождает монитор и всегда стоит в цикле `while (!condition)` из-за ложных пробуждений.

## Модель памяти: volatile и happens-before

Без синхронизации JIT и процессор могут переупорядочивать операции и кэшировать значения, поэтому поток может **никогда** не увидеть запись другого потока. Java Memory Model гарантирует видимость только через отношение **happens-before**:

- освобождение монитора → последующий захват того же монитора;
- запись `volatile`-поля → последующее чтение этого поля;
- `thread.start()` → действия запущенного потока;
- действия потока → успешный `join()` на нём;
- запись `final`-полей в конструкторе → чтение через корректно опубликованную ссылку.

```java
private volatile boolean running = true;   // без volatile цикл может не остановиться

void worker() { while (running) { /* работа */ } }
void stop()   { running = false; }
```

> `volatile` даёт **видимость и порядок**, но не атомарность: `volatile int count; count++` по-прежнему теряет обновления.

## Атомики и CAS

`AtomicInteger`, `AtomicLong` и `AtomicReference` используют аппаратную инструкцию **CAS** (compare-and-swap): значение меняется, только если оно равно ожидаемому, иначе попытка повторяется. Блокировок нет, потоки не засыпают. При сильной конкуренции за счётчик лучше `LongAdder`.

```java
AtomicInteger hits = new AtomicInteger();
hits.incrementAndGet();
hits.updateAndGet(x -> Math.max(x, 100));

ConcurrentHashMap<String, Integer> freq = new ConcurrentHashMap<>();
freq.merge("java", 1, Integer::sum);   // атомарно, в отличие от put(get() + 1)
```

## Блокировки и синхронизаторы

| Инструмент | Назначение |
|---|---|
| `ReentrantLock` | как `synchronized`, плюс `tryLock` с таймаутом, прерываемое ожидание, fairness, несколько `Condition` |
| `ReadWriteLock` | много читателей или один писатель |
| `CountDownLatch` | ждать, пока N событий не произойдут; одноразовый |
| `CyclicBarrier` | N потоков ждут друг друга; переиспользуемый |
| `Semaphore` | ограничить число одновременных владельцев ресурса |

```java
Lock lock = new ReentrantLock();
lock.lock();
try {
    // критическая секция
} finally {
    lock.unlock();   // обязательно в finally
}
```

**Deadlock** возникает, когда потоки захватывают блокировки в разном порядке и ждут друг друга. Профилактика: глобальный порядок захвата, `tryLock` с таймаутом, минимум кода под блокировкой. Диагностика — thread dump (`jstack`).

## CompletableFuture

Асинхронные конвейеры без ручных блокировок: `supplyAsync` запускает задачу (по умолчанию в `ForkJoinPool.commonPool()`), `thenApply` преобразует результат, `thenCompose` связывает зависимые future, `thenCombine` объединяет независимые, `exceptionally` и `handle` обрабатывают ошибки.

```java
CompletableFuture<Integer> price = CompletableFuture.supplyAsync(() -> loadPrice());
CompletableFuture<Integer> tax   = CompletableFuture.supplyAsync(() -> loadTax());

int total = price.thenCombine(tax, Integer::sum)
    .exceptionally(ex -> -1)
    .join();   // unchecked CompletionException вместо checked у get()
```

Для блокирующего I/O передавайте свой `Executor` вторым аргументом, чтобы не занимать общий пул.

## Виртуальные потоки (Java 21)

Виртуальный поток — лёгкий поток JVM, который монтируется на небольшой пул **carrier**-потоков ОС. При блокирующем I/O он снимается с carrier, и тот берёт другую задачу. Это позволяет держать миллионы одновременных блокирующих задач в простом синхронном стиле.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 10_000; i++) {
        executor.submit(() -> httpCall());   // поток на задачу, пул не нужен
    }
}
Thread.ofVirtual().start(() -> System.out.println("hi"));
```

Ограничения: CPU-bound задачи они не ускоряют. В Java 21 блокировка внутри `synchronized` **пиннит** виртуальный поток к carrier (исправлено в Java 24), поэтому для долгих блокирующих секций рекомендуют `ReentrantLock`. Объединять их в пул не нужно, а `ThreadLocal` с тяжёлыми объектами в них расточителен.

## Частые вопросы на собеседовании

- Чем `start()` отличается от `run()`? → `start()` создаёт новый поток, `run()` выполняется в текущем.
- Достаточно ли `volatile` для счётчика? → нет, нужна атомарность: `AtomicInteger` или блокировка.
- Что такое happens-before? → гарантия JMM, что результаты одного действия видны другому.
- Как избежать deadlock? → единый порядок захвата блокировок, `tryLock` с таймаутом.
- Зачем `volatile` в double-checked locking? → иначе можно увидеть ссылку на не до конца сконструированный объект.
- Когда виртуальные потоки не помогут? → CPU-bound нагрузка и пиннинг в `synchronized` в Java 21.

## Шпаргалка

- `Callable` — результат и checked-исключения, `Runnable` — нет.
- Пулы через `ExecutorService`; закрывать `shutdown()` или try-with-resources.
- `synchronized` = взаимное исключение + видимость; `volatile` = только видимость и порядок.
- Атомарный счётчик — `AtomicInteger`/`LongAdder`, в карте — `merge`/`compute`.
- `wait()` — в `while` и под монитором.
- `unlock()` — всегда в `finally`.
- `CountDownLatch` одноразовый, `CyclicBarrier` переиспользуемый.
- Виртуальные потоки — для I/O-bound задач, поток на задачу, без пула.
