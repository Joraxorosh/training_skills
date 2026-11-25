ООП в Python устроено проще, чем в Java: нет модификаторов доступа, всё публично по соглашению, а поведение объектов настраивается через специальные (dunder) методы вроде `__init__` и `__eq__`. На собеседовании проверяют понимание атрибутов класса и экземпляра, наследования и MRO, свойств, а также `dataclasses` как современного способа писать классы данных.

## Атрибуты класса и экземпляра

Атрибут класса общий для всех экземпляров, атрибут экземпляра хранится в `obj.__dict__`. Поиск при чтении идёт: экземпляр → класс → базовые классы. Присваивание через экземпляр создаёт атрибут экземпляра и «затеняет» атрибут класса.

```python
class Dog:
    species = "canis"          # атрибут класса
    tricks = []                # ловушка: общий изменяемый список

    def __init__(self, name):
        self.name = name       # атрибут экземпляра

a, b = Dog("Rex"), Dog("Max")
a.tricks.append("sit")
print(b.tricks)                # ['sit'] — список общий!
a.species = "wolf"
print(a.species, b.species)    # wolf canis
```

> Изменяемые атрибуты класса — та же ловушка, что и изменяемые аргументы по умолчанию. Создавайте списки в `__init__`.

## Создание объекта: __new__ и __init__

`__new__(cls)` создаёт и возвращает экземпляр (статический метод по сути), `__init__(self)` его инициализирует и возвращает `None`. Переопределять `__new__` нужно редко: для наследования от неизменяемых типов (`int`, `str`, `tuple`) или для синглтонов.

```python
class Upper(str):
    def __new__(cls, value):
        return super().__new__(cls, value.upper())

print(Upper("hi"))             # HI
```

## Наследование, super и MRO

Python поддерживает множественное наследование. Порядок поиска методов (**MRO**) вычисляется алгоритмом C3-линеаризации: потомок раньше предков, порядок базовых классов сохраняется. `super()` вызывает следующий класс **по MRO**, а не обязательно прямого родителя.

```python
class A:
    def hello(self): return "A"
class B(A):
    def hello(self): return "B" + super().hello()
class C(A):
    def hello(self): return "C" + super().hello()
class D(B, C):
    def hello(self): return "D" + super().hello()

print(D().hello())                          # DBCA
print([k.__name__ for k in D.__mro__])      # ['D', 'B', 'C', 'A', 'object']
```

Это и есть ромбовидное наследование: `A` вызывается ровно один раз.

## property, classmethod, staticmethod

| Декоратор | Первый аргумент | Когда использовать |
|---|---|---|
| обычный метод | `self` | работа с экземпляром |
| `@classmethod` | `cls` | альтернативные конструкторы, учёт наследования |
| `@staticmethod` | нет | утилита, логически связанная с классом |
| `@property` | `self` | вычисляемый атрибут, валидация при записи |

```python
class Temp:
    def __init__(self, c):
        self.celsius = c

    @property
    def celsius(self):
        return self._c

    @celsius.setter
    def celsius(self, value):
        if value < -273.15:
            raise ValueError("below absolute zero")
        self._c = value

    @classmethod
    def from_f(cls, f):
        return cls((f - 32) * 5 / 9)

    @staticmethod
    def is_freezing(c):
        return c <= 0

t = Temp.from_f(212)
print(t.celsius, Temp.is_freezing(-1))   # 100.0 True
```

## Dunder-методы и __eq__/__hash__

| Метод | Для чего |
|---|---|
| `__repr__` / `__str__` | отладочное / пользовательское представление |
| `__eq__`, `__lt__` | сравнение (`functools.total_ordering` достроит остальные) |
| `__hash__` | использование в `set` и как ключ `dict` |
| `__len__`, `__getitem__`, `__contains__`, `__iter__` | протокол контейнера |
| `__call__` | вызов объекта как функции |
| `__enter__` / `__exit__` | контекстный менеджер |
| `__add__`, `__radd__` | арифметика |

Важное правило: если вы определили `__eq__`, но не `__hash__`, Python установит `__hash__ = None` — объект станет нехешируемым. Равные объекты обязаны иметь равные хеши.

```python
class P:
    def __init__(self, x): self.x = x
    def __eq__(self, other): return isinstance(other, P) and self.x == other.x

try:
    {P(1)}
except TypeError as e:
    print(e)                   # unhashable type: 'P'
```

## __slots__, name mangling и abc

`__slots__ = ("x", "y")` убирает `__dict__` у экземпляров: меньше памяти, быстрее доступ, но нельзя добавлять новые атрибуты. Имя вида `__secret` внутри класса переименовывается в `_ClassName__secret` (name mangling) — это защита от конфликтов имён в наследниках, а не настоящая приватность. Одно подчёркивание `_x` — просто соглашение «внутреннее».

```python
from abc import ABC, abstractmethod

class Shape(ABC):
    @abstractmethod
    def area(self): ...

class Sq(Shape):
    __slots__ = ("side", "__id")
    def __init__(self, s):
        self.side = s
        self.__id = 42
    def area(self): return self.side ** 2

try:
    Shape()
except TypeError as e:
    print(type(e).__name__)    # TypeError
s = Sq(3)
print(s.area(), s._Sq__id)     # 9 42
```

## dataclasses

`@dataclass` генерирует `__init__`, `__repr__`, `__eq__` по аннотированным полям. `frozen=True` делает экземпляры неизменяемыми и хешируемыми, `order=True` добавляет сравнения, `slots=True` (3.10+) — слоты. Изменяемые значения по умолчанию задаются через `field(default_factory=list)`.

```python
from dataclasses import dataclass, field

@dataclass(frozen=True, order=True)
class Point:
    x: int
    y: int = 0
    tags: tuple = field(default=(), compare=False)

p = Point(1, 2)
print(p)                       # Point(x=1, y=2, tags=())
print(p == Point(1, 2), Point(1) < p)   # True True
print(len({p, Point(1, 2)}))   # 1
```

## Частые вопросы на собеседовании

- Чем `__new__` отличается от `__init__`? → `__new__` создаёт объект, `__init__` настраивает уже созданный.
- Что такое MRO? → порядок поиска атрибутов по иерархии, C3-линеаризация; смотреть в `Cls.__mro__`.
- Что будет, если определить только `__eq__`? → `__hash__` станет `None`, объект нехешируемый.
- Есть ли в Python приватные атрибуты? → нет; `_x` — соглашение, `__x` — name mangling.
- Зачем `__slots__`? → экономия памяти и запрет произвольных атрибутов.
- classmethod или staticmethod? → classmethod получает класс и подходит для фабрик, staticmethod — просто функция в пространстве имён класса.

## Шпаргалка

- Изменяемые данные — в `__init__`, не в теле класса.
- `super()` идёт по MRO, а не к прямому родителю.
- `@property` вместо геттеров и сеттеров.
- `__eq__` без `__hash__` → нехешируемый объект.
- `__repr__` для разработчика, `__str__` для пользователя.
- `ABC` + `@abstractmethod` запрещают создание неполного класса.
- `@dataclass(frozen=True)` — неизменяемый хешируемый класс данных; списки — через `default_factory`.
