Generics делают коллекции типобезопасными, лямбды позволяют передавать поведение как значение, а Stream API строит на этом декларативную обработку данных. На собеседовании проверяют стирание типов и PECS, правила захвата переменных в лямбдах, ленивость стримов и правильное использование `Optional`.

## Generics и стирание типов

Параметры типов проверяются только при компиляции. В байткоде они **стираются** до границы (обычно `Object`), поэтому в рантайме `List<String>` и `List<Integer>` — один класс.

```java
System.out.println(new ArrayList<String>().getClass()
        == new ArrayList<Integer>().getClass());   // true

// Из-за стирания нельзя:
// new T();  T[] arr = new T[10];  obj instanceof List<String>
static <T extends Comparable<T>> T max(List<T> list) { /* ... */ return list.get(0); }
```

Сырые типы (`List` без параметра) отключают проверки и оставлены только для совместимости.

## Wildcards и PECS

`List<Integer>` **не является** подтипом `List<Number>` (generics инвариантны). Гибкость дают wildcards. Правило **PECS**: Producer Extends, Consumer Super.

| Объявление | Читать как | Добавлять |
|---|---|---|
| `List<? extends Number>` | `Number` | ничего, кроме `null` |
| `List<? super Integer>` | только `Object` | `Integer` |
| `List<?>` | `Object` | ничего, кроме `null` |

```java
static double sum(List<? extends Number> src) {      // producer
    double s = 0;
    for (Number n : src) s += n.doubleValue();
    return s;
}
static void fill(List<? super Integer> dst) {        // consumer
    dst.add(1);
    dst.add(2);
}
// Пример из JDK: Collections.copy(List<? super T> dest, List<? extends T> src)
```

## Функциональные интерфейсы, лямбды и ссылки на методы

Функциональный интерфейс имеет ровно один абстрактный метод, и лямбда его реализует. Основные интерфейсы из `java.util.function`:

| Интерфейс | Метод | Сигнатура |
|---|---|---|
| `Function<T, R>` | `apply` | T → R |
| `Predicate<T>` | `test` | T → boolean |
| `Consumer<T>` | `accept` | T → void |
| `Supplier<T>` | `get` | () → T |
| `BiFunction<T, U, R>` | `apply` | (T, U) → R |
| `UnaryOperator<T>` | `apply` | T → T |

Лямбда может захватывать только **effectively final** локальные переменные: значения, которые не меняются после инициализации. Поля объекта менять можно, но это путь к гонкам.

```java
int base = 10;
Function<Integer, Integer> add = x -> x + base;   // ок
// base++;   // после этого лямбда перестанет компилироваться

Function<String, String> up = String::toUpperCase;      // s -> s.toUpperCase()
Function<String, Integer> parse = Integer::parseInt;    // s -> Integer.parseInt(s)
Supplier<List<String>> make = ArrayList::new;           // () -> new ArrayList<>()
Consumer<String> print = System.out::println;           // x -> System.out.println(x)
```

## Stream API: конвейер и ленивость

Стрим состоит из источника, цепочки **промежуточных** операций (`filter`, `map`, `flatMap`, `sorted`, `distinct`, `peek`, `limit`) и одной **терминальной** (`collect`, `toList`, `forEach`, `reduce`, `count`, `findFirst`, `anyMatch`). Промежуточные операции ленивы: без терминальной ничего не выполняется. Элементы проходят конвейер **по одному**, а короткозамыкающие операции (`findFirst`, `limit`, `anyMatch`) останавливают обработку раньше.

```java
Stream.of(1, 2, 3)
    .filter(x -> { System.out.print("f" + x + " "); return x > 1; })
    .map(x -> { System.out.print("m" + x + " "); return x; })
    .findFirst();
// f1 f2 m2 — до 3 дело не дошло
```

Стрим одноразовый: повторная терминальная операция бросает `IllegalStateException`.

## map, flatMap, reduce, collect

```java
List<Integer> squares = Stream.of(1, 2, 3, 4, 5)
    .filter(x -> x % 2 == 1).map(x -> x * x).toList();      // [1, 9, 25]

List<Integer> flat = List.of(List.of(1, 2), List.of(3)).stream()
    .flatMap(List::stream).toList();                         // [1, 2, 3]

int sum = Stream.of(1, 2, 3, 4).reduce(0, Integer::sum);     // 10

Map<Integer, List<String>> byLen = Stream.of("a", "bb", "cc")
    .collect(Collectors.groupingBy(String::length));         // {1=[a], 2=[bb, cc]}

Map<Integer, Long> counts = Stream.of("a", "bb", "cc")
    .collect(Collectors.groupingBy(String::length, Collectors.counting()));

Map<Integer, String> m = Stream.of("aa", "bb")
    .collect(Collectors.toMap(String::length, s -> s, (a, b) -> a)); // без merge — IllegalStateException

String joined = Stream.of("a", "b").collect(Collectors.joining(", ", "[", "]"));
```

> `Stream.toList()` (Java 16) возвращает неизменяемый список, а `Collectors.toList()` формально ничего не гарантирует (на практике это `ArrayList`).

## Параллельные стримы

`parallelStream()` делит работу через общий `ForkJoinPool.commonPool()`. Ловушки: изменение общего состояния (`list.add` в `forEach`) — гонка; блокирующий I/O занимает общий пул всего приложения; для маленьких данных и плохо делимых источников (`LinkedList`, `Stream.iterate`) параллельность только замедляет работу; `forEach` не сохраняет порядок, для этого есть `forEachOrdered`. Ускорение дают большие объёмы CPU-bound работы над массивами и `ArrayList`.

## Optional

`Optional` — возвращаемый тип для «значения может не быть». Хорошо: `map`, `filter`, `orElse`, `orElseGet`, `orElseThrow`, `ifPresentOrElse`. Плохо: `Optional` в полях и параметрах, `get()` без проверки, `Optional.of(null)` (NPE), а также возврат `null` из метода, объявленного как `Optional`.

```java
String name = findUser(id)
    .map(User::name)
    .filter(n -> !n.isBlank())
    .orElseGet(() -> loadDefault());   // orElse(loadDefault()) вычислил бы всегда
```

## Частые вопросы на собеседовании

- Что такое type erasure? → параметры типов стираются после компиляции, в рантайме их нет.
- Что значит PECS? → из `? extends` читаем, в `? super` пишем.
- Почему переменная в лямбде должна быть effectively final? → лямбда захватывает значение; так исключаются гонки и неочевидная семантика.
- Почему стрим без терминальной операции ничего не делает? → промежуточные операции ленивые и только строят конвейер.
- Чем `map` отличается от `flatMap`? → `flatMap` разворачивает стрим стримов в один.
- `orElse` или `orElseGet`? → `orElseGet` вычисляет значение лениво, только если Optional пуст.

## Шпаргалка

- `List<Integer>` не подтип `List<Number>`; используйте `? extends` и `? super`.
- Нет `new T()` и `instanceof List<String>` — из-за стирания.
- Захват в лямбде — только effectively final.
- Без терминальной операции стрим не выполняется; стрим одноразовый.
- `toMap` на дубликатах падает без merge-функции.
- `groupingBy` + downstream-коллектор для подсчётов и агрегатов.
- Parallel — только для больших CPU-bound задач без общего состояния.
- `Optional` — только как возвращаемый тип; `get()` без проверки запрещён.
