Java Collections Framework — набор интерфейсов (`List`, `Set`, `Queue`, `Map`) и их реализаций. На собеседовании почти всегда спрашивают устройство `HashMap`, разницу между `ArrayList` и `LinkedList`, `ConcurrentModificationException` и выбор структуры под задачу.

## Иерархия

`Collection` — корень для `List` (упорядоченный список с индексами), `Set` (без дубликатов) и `Queue`/`Deque` (очереди). `Map` **не наследует** `Collection`: это отдельная иерархия пар «ключ → значение», из которой можно получить представления `keySet()`, `values()` и `entrySet()`.

| Интерфейс | Основные реализации | Особенность |
|---|---|---|
| `List` | `ArrayList`, `LinkedList` | порядок, индексы, дубликаты |
| `Set` | `HashSet`, `LinkedHashSet`, `TreeSet` | уникальность |
| `Deque` | `ArrayDeque`, `LinkedList` | стек и очередь |
| `Map` | `HashMap`, `LinkedHashMap`, `TreeMap` | ключ → значение |

## ArrayList и LinkedList

`ArrayList` хранит элементы в массиве. Доступ по индексу O(1), добавление в конец — амортизированное O(1): при заполнении массив растёт примерно в 1.5 раза. Вставка и удаление в середине — O(n) из-за сдвига. `LinkedList` — двусвязный список: `get(i)` за O(n), зато вставка у известного узла O(1). На практике `ArrayList` почти всегда быстрее из-за локальности данных в кэше процессора, а для очереди и стека лучше подходит `ArrayDeque`.

```java
List<Integer> list = new ArrayList<>(List.of(10, 20, 30));
list.remove(1);                    // remove(int index) → [10, 30]
list.remove(Integer.valueOf(10));  // remove(Object)    → [30]
```

## Как устроен HashMap

Внутри — массив бакетов (по умолчанию 16). Для ключа берётся `hashCode()`, старшие биты подмешиваются к младшим (`h ^ (h >>> 16)`), а индекс бакета вычисляется как `hash & (capacity - 1)`. В бакете лежит связный список узлов. При поиске сначала сравниваются хеши, затем ссылки или `equals`.

- **Load factor 0.75**: при `size > capacity × 0.75` (для 16 — после 12 элементов) таблица удваивается, элементы перераспределяются.
- **Treeify**: если в бакете набралось 8 элементов, а ёмкость не меньше 64, список превращается в красно-чёрное дерево (поиск O(log n) вместо O(n)). При ёмкости меньше 64 таблица просто расширяется.
- Допускается один `null`-ключ, он всегда попадает в бакет 0.

`HashSet` — это обёртка над `HashMap`: элементы хранятся как ключи с общим фиктивным значением.

## Изменяемые ключи и контракт hashCode

Хеш ключа запоминается при вставке. Если после этого изменить ключ, запись окажется «потерянной»: она лежит в карте, но найти её нельзя.

```java
List<Integer> key = new ArrayList<>(List.of(1));
Map<List<Integer>, String> map = new HashMap<>();
map.put(key, "v");
key.add(2);
System.out.println(map.get(key));  // null
System.out.println(map.size());    // 1
```

> Ключи `HashMap` и элементы `HashSet` должны быть неизменяемыми и корректно переопределять `equals` и `hashCode`. Хорошие ключи — `String`, `Integer`, `record`.

## Упорядоченные коллекции: TreeMap, LinkedHashMap

`TreeMap` и `TreeSet` основаны на красно-чёрном дереве: ключи отсортированы, операции за O(log n), есть `firstKey()`, `headMap()`, `ceilingKey()`. Порядок задаёт `Comparable.compareTo` (естественный) или `Comparator`. Важно: равенство определяется компаратором, а не `equals`.

```java
Set<String> set = new TreeSet<>(Comparator.comparing(String::length));
set.add("cat");
set.add("dog");      // compare == 0 → считается дубликатом
System.out.println(set);   // [cat]

Comparator<User> byAgeThenName =
    Comparator.comparing(User::age).thenComparing(User::name);
```

`LinkedHashMap` хранит порядок вставки, а с `accessOrder = true` — порядок доступа. Это готовая основа LRU-кэша:

```java
class Lru<K, V> extends LinkedHashMap<K, V> {
    private final int capacity;
    Lru(int capacity) { super(16, 0.75f, true); this.capacity = capacity; }
    @Override protected boolean removeEldestEntry(Map.Entry<K, V> e) {
        return size() > capacity;
    }
}
```

## Итераторы, CME и неизменяемые коллекции

Итераторы обычных коллекций **fail-fast**: если коллекцию изменили в обход итератора, следующий `next()` бросает `ConcurrentModificationException`. Это происходит и в одном потоке.

```java
for (Integer x : list) if (x == 2) list.remove(x);   // CME
list.removeIf(x -> x == 2);                           // правильно
Iterator<Integer> it = list.iterator();
while (it.hasNext()) if (it.next() == 2) it.remove(); // тоже правильно
```

`List.of()`, `Set.of()` и `Map.of()` возвращают неизменяемые коллекции: любое изменение бросает `UnsupportedOperationException`, `null` запрещён. `Arrays.asList()` — список фиксированного размера поверх массива: `set` работает и меняет массив, `add` бросает исключение.

## Конкурентные коллекции

`ConcurrentHashMap` позволяет читать без блокировок, а запись делает через CAS или `synchronized` на первом узле бакета. Итераторы weakly consistent, CME не бросают. `null` запрещён в ключах и значениях. Составные операции делают атомарными через `merge`, `compute` и `putIfAbsent`. `CopyOnWriteArrayList` копирует массив при каждой записи и подходит для редко меняющихся списков слушателей.

| Операция | ArrayList | LinkedList | HashMap | TreeMap |
|---|---|---|---|---|
| get / поиск | O(1) | O(n) | O(1) в среднем | O(log n) |
| вставка в конец | O(1) аморт. | O(1) | O(1) в среднем | O(log n) |
| вставка в начало | O(n) | O(1) | — | — |
| удаление по значению | O(n) | O(n) | O(1) в среднем | O(log n) |

## Частые вопросы на собеседовании

- Как работает `HashMap.put`? → хеш → бакет → поиск ключа по хешу и `equals` → замена значения или новый узел; при превышении порога — resize.
- Что такое treeify? → бакет из 8+ узлов при ёмкости от 64 становится красно-чёрным деревом.
- Почему изменяемый ключ опасен? → после изменения хеш не совпадает, запись не находится.
- Когда возникает CME? → коллекцию меняют в обход итератора; решение — `iterator.remove()` или `removeIf`.
- Чем `HashMap` отличается от `ConcurrentHashMap`? → потокобезопасность, отсутствие `null`, weakly consistent итераторы.
- Как сделать LRU? → `LinkedHashMap` с `accessOrder = true` и `removeEldestEntry`.

## Шпаргалка

- По умолчанию в `ArrayList` и `ArrayDeque`, `LinkedList` почти не нужен.
- `HashMap`: 16 бакетов, load factor 0.75, treeify при 8 (и ёмкости от 64).
- `HashSet` = `HashMap` с ключами.
- `TreeMap`/`TreeSet`: равенство по компаратору, `null`-ключ → NPE.
- `List.of` неизменяем, `Arrays.asList` фиксированного размера.
- Удаление при обходе — `removeIf` или `iterator.remove()`.
- `remove(int)` и `remove(Object)` у `List<Integer>` — разные методы.
