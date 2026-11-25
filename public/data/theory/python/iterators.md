Цикл `for` в Python работает не с индексами, а с протоколом итерации. Понимание этого протокола объясняет, почему генератор нельзя пройти дважды, как `zip` работает с бесконечными последовательностями и почему генераторы экономят память. Генераторы и `itertools` — частая тема и на собеседовании, и в реальном коде обработки данных.

## Протокол итерации

**Итерируемый** объект (iterable) умеет выдавать итератор: у него есть `__iter__` (или `__getitem__`). **Итератор** — объект с `__next__`, который возвращает следующий элемент или бросает `StopIteration`, а его `__iter__` возвращает его самого.

```python
nums = [10, 20]
it = iter(nums)            # nums.__iter__()
print(next(it), next(it))  # 10 20
try:
    next(it)
except StopIteration:
    print("done")          # done
print(next(it, "default")) # default
```

Цикл `for x in obj` — это `it = iter(obj)` и вызовы `next(it)` до `StopIteration`, которое цикл перехватывает сам.

| | Iterable | Iterator |
|---|---|---|
| Методы | `__iter__` | `__iter__` + `__next__` |
| Примеры | `list`, `str`, `dict`, `range` | генератор, `iter(list)`, `map`, `zip`, файл |
| Можно пройти повторно | да | нет, исчерпывается |

## Собственный итератор

```python
class Countdown:
    def __init__(self, start):
        self.current = start
    def __iter__(self):
        return self
    def __next__(self):
        if self.current <= 0:
            raise StopIteration
        self.current -= 1
        return self.current + 1

print(list(Countdown(3)))  # [3, 2, 1]
```

Обычно проще написать генератор — он реализует протокол автоматически.

## Генераторы

Функция с `yield` при вызове не выполняется, а возвращает объект-генератор. Каждый `next` выполняет тело до следующего `yield` и «замораживает» состояние: локальные переменные и позицию. `return` внутри генератора завершает его (значение попадает в `StopIteration.value`).

```python
def countdown(n):
    print("start")
    while n > 0:
        yield n
        n -= 1

g = countdown(2)           # ничего не напечатано
print(next(g))             # start, затем 2
print(list(g))             # [1]
print(list(g))             # [] — генератор исчерпан
```

> Ловушка исчерпания: генераторы, `map`, `filter`, `zip` и файлы проходятся один раз. Если вызвать `sum(gen)` после `list(gen)`, получите `0`. Нужно несколько проходов — сохраните в список.

```python
squares = (x * x for x in range(4))
print(3 in squares)        # False — проверка «съела» элементы
print(list(squares))       # [] — после поиска до конца ничего не осталось
```

## Генераторные выражения и память

`(expr for x in it)` — ленивая версия list comprehension. Элементы вычисляются по одному, поэтому память O(1) вместо O(n). При передаче единственным аргументом скобки можно опустить: `sum(x * x for x in range(10))`.

```python
import sys
lst = [x for x in range(100_000)]
gen = (x for x in range(100_000))
print(sys.getsizeof(lst) > 800_000, sys.getsizeof(gen) < 300)   # True True
print(sum(x * x for x in range(10)))                             # 285
```

Генераторы удобно собирать в конвейеры: чтение строк → фильтрация → преобразование, и всё это без загрузки файла в память.

## yield from и send

`yield from it` делегирует итерацию вложенному итератору и возвращает значение его `return`. `send(value)` передаёт значение внутрь генератора — оно становится результатом выражения `yield`. Перед первым `send` генератор надо запустить через `next(g)` или `g.send(None)`.

```python
def flatten(items):
    for x in items:
        if isinstance(x, list):
            yield from flatten(x)
        else:
            yield x

print(list(flatten([1, [2, [3, 4]], 5])))   # [1, 2, 3, 4, 5]

def averager():
    total = count = 0
    avg = None
    while True:
        value = yield avg
        total += value
        count += 1
        avg = total / count

a = averager()
next(a)                    # запуск до первого yield
print(a.send(10), a.send(20))   # 10.0 15.0
```

Также есть `g.throw(exc)` (бросить исключение в точке `yield`) и `g.close()` (бросает `GeneratorExit`).

## itertools

| Функция | Что делает |
|---|---|
| `count`, `cycle`, `repeat` | бесконечные итераторы |
| `islice(it, start, stop)` | срез итератора |
| `chain(a, b)`, `chain.from_iterable` | склейка |
| `groupby(it, key)` | группы подряд идущих равных ключей |
| `accumulate` | накопительные суммы |
| `product`, `permutations`, `combinations` | комбинаторика |
| `zip_longest` | zip до самой длинной последовательности |
| `batched(it, n)` (3.12+) | разбиение на кортежи по n |
| `tee(it, n)` | несколько независимых копий итератора |

```python
from itertools import count, islice, groupby, accumulate, combinations, batched, chain

print(list(islice(count(10, 5), 3)))           # [10, 15, 20]
print([(k, len(list(g))) for k, g in groupby("aaabbc")])   # [('a', 3), ('b', 2), ('c', 1)]
print(list(accumulate([1, 2, 3, 4])))          # [1, 3, 6, 10]
print(list(combinations("abc", 2)))            # [('a', 'b'), ('a', 'c'), ('b', 'c')]
print(list(batched(range(7), 3)))              # [(0, 1, 2), (3, 4, 5), (6,)]
print(list(chain([1], (2, 3))))                # [1, 2, 3]
```

> `groupby` группирует только **соседние** элементы. Чтобы сгруппировать все одинаковые, сначала отсортируйте по тому же ключу.

## Частые вопросы на собеседовании

- Чем iterable отличается от iterator? → iterable выдаёт итератор через `__iter__`; итератор хранит позицию и имеет `__next__`.
- Как цикл `for` узнаёт о конце? → итератор бросает `StopIteration`, `for` его перехватывает.
- Почему генератор экономит память? → значения вычисляются лениво, по одному.
- Можно ли пройти генератор дважды? → нет, он исчерпывается; нужно создать заново.
- Что делает `yield from`? → делегирует подгенератору, пробрасывает `send`/`throw` и возвращает его `return`.
- Как взять первые 5 элементов бесконечного генератора? → `itertools.islice(gen, 5)`.

## Шпаргалка

- `iter(obj)` → итератор, `next(it, default)` → элемент или значение по умолчанию.
- Итераторы одноразовые; `list(...)`, если нужен повторный проход.
- `yield` превращает функцию в генератор; тело стартует при первом `next`.
- `(x for x in ...)` — ленивое выражение, память O(1).
- `yield from` для делегирования и рекурсивных генераторов.
- `send` требует предварительного `next`.
- `groupby` — только по соседним, `islice` — срез ленивого потока, `batched` — пачки.
