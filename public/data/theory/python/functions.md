Функции в Python — объекты первого класса: их можно присваивать переменным, передавать в другие функции, возвращать и хранить в коллекциях. На этом построены замыкания и декораторы — одна из самых популярных тем на собеседовании. Разберём виды аргументов, области видимости, ловушки с изменяемыми значениями по умолчанию и поздним связыванием, а также `functools`.

## Виды параметров

Полная сигнатура выглядит так: позиционные-только, обычные, `*args`, keyword-only, `**kwargs`.

```python
def f(a, b, /, c, d=4, *args, e, f=6, **kwargs):
    return a, b, c, d, args, e, f, kwargs

print(f(1, 2, 3, e=5))
# (1, 2, 3, 4, (), 5, 6, {})
print(f(1, 2, 3, 4, 7, 8, e=5, z=0))
# (1, 2, 3, 4, (7, 8), 5, 6, {'z': 0})
```

| Синтаксис | Значение |
|---|---|
| параметры до `/` | только позиционные (3.8+) |
| параметры после `*` или `*args` | только именованные |
| `*args` | лишние позиционные — кортеж |
| `**kwargs` | лишние именованные — словарь |

При вызове `*` и `**` наоборот распаковывают: `f(*lst, **dct)`.

## Изменяемое значение по умолчанию

Значения по умолчанию вычисляются **один раз** — при определении функции, а не при каждом вызове. Изменяемый объект разделяется между всеми вызовами.

```python
def add(item, bucket=[]):
    bucket.append(item)
    return bucket

print(add(1))              # [1]
print(add(2))              # [1, 2]  — тот же список!

def add_ok(item, bucket=None):
    if bucket is None:
        bucket = []
    bucket.append(item)
    return bucket

print(add_ok(1), add_ok(2))   # [1] [2]
```

> Самый частый вопрос по функциям. Правильный ответ: используйте `None` как маркер и создавайте объект внутри функции.

## Области видимости: LEGB

Имя ищется по порядку: **L**ocal → **E**nclosing (внешние функции) → **G**lobal (модуль) → **B**uilt-in. Если имя присваивается где-либо в функции, оно считается локальным во всей функции.

```python
x = 10
def broken():
    print(x)               # UnboundLocalError
    x = 20

counter = 0
def inc():
    global counter
    counter += 1

def outer():
    n = 0
    def inner():
        nonlocal n
        n += 1
        return n
    inner(); inner()
    return n

inc()
print(counter, outer())    # 1 2
```

`global` привязывает имя к уровню модуля, `nonlocal` — к ближайшей внешней функции. Без них присваивание создаёт локальную переменную, а чтение и мутация (`lst.append`) работают и так.

## Замыкания и позднее связывание

Замыкание — вложенная функция, которая запоминает переменные внешней области даже после её завершения. Но запоминается **переменная**, а не значение: оно читается в момент вызова.

```python
def make_multiplier(k):
    def mul(x):
        return x * k
    return mul

double = make_multiplier(2)
print(double(5))                          # 10
print(double.__closure__[0].cell_contents)  # 2

funcs = [lambda: i for i in range(3)]
print([f() for f in funcs])               # [2, 2, 2]

funcs = [lambda i=i: i for i in range(3)]
print([f() for f in funcs])               # [0, 1, 2]
```

> Late binding: все лямбды ссылаются на одну переменную `i`, которая к моменту вызова равна 2. Лечится аргументом по умолчанию `i=i` или `functools.partial`.

## Декораторы

Декоратор — функция, которая принимает функцию и возвращает новую. `@deco` над `def f` — это `f = deco(f)`. Всегда оборачивайте обёртку в `functools.wraps`, иначе потеряются `__name__`, `__doc__` и сигнатура.

```python
import functools, time

def timer(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        print(f"{func.__name__} took {time.perf_counter() - start:.0f}s")
        return result
    return wrapper

def repeat(times):                 # декоратор с аргументами — фабрика
    def deco(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            return [func(*args, **kwargs) for _ in range(times)]
        return wrapper
    return deco

@timer
@repeat(2)
def hello(name):
    return f"hi {name}"

print(hello("Ann"))
# hello took 0s
# ['hi Ann', 'hi Ann']
print(hello.__name__)              # hello
```

Порядок: декораторы применяются **снизу вверх** (`timer(repeat(2)(hello))`), а при вызове выполняются сверху вниз — внешняя обёртка первой.

## functools: lru_cache и partial

`lru_cache` мемоизирует результаты по аргументам (они должны быть хешируемыми). `cache` (3.9+) — то же без ограничения размера. `partial` фиксирует часть аргументов.

```python
from functools import lru_cache, partial

@lru_cache(maxsize=None)
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print(fib(80))                     # 23416728348467685
print(fib.cache_info().hits)       # 78

pow2 = partial(pow, exp=2)
print(pow2(7))                     # 49
print(int("ff", base=16), partial(int, base=2)("101"))   # 255 5
```

`lambda` — анонимная функция из одного выражения; без присваиваний и `return`. Если лямбду кладут в переменную, лучше написать `def`.

## Частые вопросы на собеседовании

- Почему нельзя писать `def f(x=[])`? → значение по умолчанию создаётся один раз и разделяется между вызовами.
- Что такое замыкание? → вложенная функция, которая хранит ссылки на переменные внешней функции в `__closure__`.
- Зачем `functools.wraps`? → копирует `__name__`, `__doc__`, `__wrapped__` оригинала в обёртку.
- Как написать декоратор с параметрами? → три уровня вложенности: фабрика → декоратор → обёртка.
- Разница `global` и `nonlocal`? → первое — уровень модуля, второе — ближайшая объемлющая функция.
- Что значит `/` в сигнатуре? → параметры слева можно передавать только позиционно.

## Шпаргалка

- Порядок параметров: `pos_only, /, normal, *args, kw_only, **kwargs`.
- Изменяемые значения по умолчанию — через `None`.
- LEGB; присваивание делает имя локальным во всей функции.
- Замыкание хранит переменную, а не значение — позднее связывание.
- Декоратор: `f = deco(f)`, всегда `@functools.wraps`.
- Стек декораторов применяется снизу вверх.
- `lru_cache` для мемоизации, `partial` для фиксации аргументов.
