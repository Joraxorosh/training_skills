Чтобы уверенно отвечать про производительность и сбои Java-приложений, нужно понимать, что происходит под капотом: как код превращается в байткод и машинный код, где живут объекты, как работает сборщик мусора и почему возникают `OutOfMemoryError`. Вокруг JVM — экосистема: исключения, сборка через Maven/Gradle и Spring, который тоже регулярно всплывает на собеседованиях.

## JDK, JRE, JVM и путь кода

- **JVM** — виртуальная машина, исполняющая байткод.
- **JRE** — JVM плюс стандартная библиотека, всё, что нужно для запуска.
- **JDK** — JRE плюс инструменты разработчика: `javac`, `jar`, `jdb`, `jcmd`, `jlink`.

`javac` компилирует `.java` в платформенно-независимый байткод (`.class`). JVM сначала интерпретирует его и собирает профиль, затем **JIT**-компилятор (C1, затем C2) переводит «горячие» методы в машинный код с оптимизациями: инлайнинг, escape analysis, удаление лишних проверок. Отсюда эффект «прогрева» и необходимость JMH для бенчмарков.

## Загрузка классов

Классы загружаются лениво, при первом использовании. Загрузчики образуют иерархию: **Bootstrap** (ядро JDK) → **Platform** → **Application** (classpath). Работает parent-first делегирование: загрузчик сначала просит родителя и грузит сам, только если тот не нашёл. Так системный `java.lang.String` нельзя подменить. Класс идентифицируется парой «имя + загрузчик», поэтому один и тот же класс из двух загрузчиков — это два разных типа (источник `ClassCastException` в контейнерах приложений).

## Области памяти

| Область | Что хранит | Общая для потоков | Ошибка при исчерпании |
|---|---|---|---|
| Heap | объекты и массивы | да | `OutOfMemoryError: Java heap space` |
| Stack | фреймы методов: локальные примитивы и ссылки | нет, своя у потока | `StackOverflowError` |
| Metaspace | метаданные классов (нативная память, с Java 8 вместо PermGen) | да | `OutOfMemoryError: Metaspace` |

```java
static int depth(int n) { return depth(n + 1); }   // StackOverflowError

List<byte[]> leak = new ArrayList<>();
while (true) leak.add(new byte[1_000_000]);        // OutOfMemoryError: Java heap space
```

> `OutOfMemoryError` и `StackOverflowError` — наследники `Error`, а не `Exception`: `catch (Exception e)` их не ловит.

Основные флаги: `-Xms` и `-Xmx` задают размер кучи, `-Xss` — размер стека потока, `-XX:+HeapDumpOnOutOfMemoryError` сохраняет дамп для анализа.

## Сборка мусора

GC освобождает объекты, **недостижимые** от корней (стеки потоков, `static`-поля, JNI-ссылки), поэтому циклические ссылки ему не мешают. Большинство объектов умирает молодыми (слабая гипотеза о поколениях), и куча делится на **Young** (Eden + два Survivor) и **Old**. Minor GC часто и дёшево чистит молодое поколение, выжившие объекты стареют и переезжают в Old.

| Сборщик | Особенности |
|---|---|
| Serial | один поток, для маленьких куч и контейнеров с 1 CPU |
| Parallel | максимальная пропускная способность, паузы stop-the-world |
| G1 | по умолчанию с Java 9; куча из регионов, цель паузы `-XX:MaxGCPauseMillis` |
| ZGC | почти полностью конкурентный, паузы около миллисекунды и меньше, кучи до терабайтов; в Java 21 есть режим с поколениями |

**Утечка памяти** в Java — это объекты, которые всё ещё достижимы, но не нужны: растущие `static`-коллекции и кэши без вытеснения, незакрытые ресурсы, слушатели без отписки, `ThreadLocal` в потоках пула, изменяемые ключи `HashMap`. Ищут через heap dump (Eclipse MAT, VisualVM) и `jcmd GC.class_histogram`.

## Исключения и try-with-resources

`Throwable` делится на `Error` (сбои JVM, не ловим) и `Exception`. **Checked**-исключения (`IOException`, `SQLException`) компилятор заставляет обработать или объявить в `throws`. **Unchecked** — наследники `RuntimeException` (`NullPointerException`, `IllegalArgumentException`) — обычно означают ошибку программиста.

```java
record Res(String name) implements AutoCloseable {
    public void close() { System.out.println("close " + name); }
}

try (var a = new Res("A"); var b = new Res("B")) {
    throw new IllegalStateException("boom");
} catch (IllegalStateException e) {
    System.out.println(e.getSuppressed().length);   // исключения из close() добавляются сюда
}
// close B, close A — в обратном порядке, до catch
```

`finally` выполняется всегда. Значение для `return` фиксируется до `finally`, а `return` внутри `finally` заменяет результат и проглатывает исключения — это анти-паттерн.

## Maven и Gradle

Maven описывает проект декларативно в `pom.xml`: координаты `groupId:artifactId:version`, зависимости со scope (`compile`, `test`, `provided`, `runtime`) и жёсткий жизненный цикл: `validate` → `compile` → `test` → `package` → `verify` → `install` → `deploy`. Вызов фазы выполняет все предыдущие. Gradle использует скрипты на Kotlin или Groovy DSL (`build.gradle.kts`), инкрементальные сборки и кэш задач, поэтому обычно быстрее. Конфликты версий транзитивных зависимостей смотрят через `mvn dependency:tree` или `gradle dependencies`.

## Spring: IoC, бины и прокси

**IoC-контейнер** создаёт объекты (бины), связывает их зависимости (**DI**) и управляет жизненным циклом. Предпочтительно внедрение через конструктор: зависимости явные, поля `final`, класс легко тестировать.

- `singleton` — scope по умолчанию, один экземпляр на контейнер, общий для всех потоков (не храните в нём изменяемое состояние).
- `prototype` — новый экземпляр при каждом запросе у контейнера; внедрённый в singleton, создаётся один раз.
- `request` и `session` — в веб-приложениях.

`@Transactional`, `@Async` и `@Cacheable` работают через **прокси**. Прокси перехватывает только вызовы снаружи бина, поэтому вызов через `this` из того же класса транзакцию не откроет. Аннотация не работает и на `private`-методах. Также по умолчанию откат происходит только при unchecked-исключениях.

```java
@Service
class OrderService {
    private final PaymentService payments;            // внедрение через конструктор
    OrderService(PaymentService payments) { this.payments = payments; }

    public void placeOrder() { saveOrder(); }         // self-invocation: прокси обойдён

    @Transactional
    public void saveOrder() { /* ... */ }
}
```

## Частые вопросы на собеседовании

- Чем JDK отличается от JRE? → JDK содержит инструменты разработки, включая компилятор.
- Где хранятся объекты и локальные переменные? → объекты в куче, локальные переменные и ссылки — в стеке потока.
- Бывают ли утечки памяти при наличии GC? → да, если ненужные объекты остаются достижимыми.
- Checked или unchecked? → checked обязательны к обработке, unchecked — наследники `RuntimeException`.
- Почему не сработал `@Transactional`? → self-invocation, `private`-метод или checked-исключение без `rollbackFor`.
- Чем G1 отличается от ZGC? → G1 — сбалансированный сборщик по умолчанию, ZGC — минимальные паузы на больших кучах.

## Шпаргалка

- `javac` → байткод → интерпретатор + JIT.
- Загрузчики: parent-first, классы грузятся лениво.
- Heap — объекты, Stack — фреймы, Metaspace — классы.
- `StackOverflowError` — рекурсия, `OOM: Java heap space` — куча.
- `Error` не ловится `catch (Exception)`.
- Ресурсы закрываются в обратном порядке, исключения из `close()` становятся suppressed.
- `return` в `finally` — анти-паттерн.
- `mvn package` выполняет и тесты; `install` кладёт артефакт в `~/.m2`.
- Spring: singleton по умолчанию; `@Transactional` не работает при self-invocation.
