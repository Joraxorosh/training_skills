Исключения в Python — основной механизм сообщения об ошибках, и в отличие от многих языков их принято использовать активно. На собеседовании проверяют порядок выполнения блоков `try`, иерархию исключений, цепочки `raise from`, стиль EAFP и контекстные менеджеры — конструкцию `with`, которая гарантирует освобождение ресурсов.

## try / except / else / finally

- `try` — код, который может упасть.
- `except` — обработка; проверяются сверху вниз, срабатывает первый подходящий.
- `else` — выполняется, только если в `try` **не было** исключения.
- `finally` — выполняется **всегда**: при успехе, ошибке, `return`, `break`.

```python
def run(x):
    try:
        print("try")
        r = 10 / x
    except ZeroDivisionError as e:
        print("except:", e)
        return "error"
    else:
        print("else")
        return r
    finally:
        print("finally")

print(run(2))
# try / else / finally / 5.0
print(run(0))
# try / except: division by zero / finally / error
```

Порядок `except` важен: сначала конкретные классы, потом общие. Если первым поставить `except Exception`, следующие блоки не сработают никогда. Переменная `e` удаляется после выхода из блока `except`.

## return в finally

`finally` выполняется даже после `return` в `try`. Если в `finally` тоже есть `return`, он **перезаписывает** результат и подавляет исключение. С Python 3.14 это даёт `SyntaxWarning`.

```python
def f():
    try:
        return "try"
    finally:
        return "finally"

def g():
    try:
        1 / 0
    finally:
        return "swallowed"

print(f(), g())            # finally swallowed
```

> Вопрос-ловушка «что вернёт функция» почти всегда про `finally`. Не пишите `return`, `break`, `continue` в `finally` в реальном коде.

## Иерархия исключений

```python
# BaseException
#  ├── SystemExit, KeyboardInterrupt, GeneratorExit
#  └── Exception
#       ├── ArithmeticError → ZeroDivisionError, OverflowError
#       ├── LookupError → IndexError, KeyError
#       ├── ValueError → UnicodeError
#       ├── TypeError, AttributeError, NameError
#       ├── OSError → FileNotFoundError, PermissionError, TimeoutError
#       └── RuntimeError → RecursionError, NotImplementedError
```

Ловите `Exception`, а не `BaseException` и не голый `except:` — иначе перехватите `KeyboardInterrupt` и `SystemExit`, и программу нельзя будет остановить. Несколько типов ловятся кортежем: `except (KeyError, IndexError):`.

## raise, raise from и свои исключения

`raise` без аргументов внутри `except` перебрасывает текущее исключение с исходным трейсбеком. `raise New() from err` явно связывает исключения (`__cause__`), `from None` скрывает исходное. Собственные исключения наследуют от `Exception`, обычно с общим базовым классом для библиотеки.

```python
class AppError(Exception):
    """Базовое исключение приложения."""

class ConfigError(AppError):
    def __init__(self, key):
        super().__init__(f"missing key: {key}")
        self.key = key

def load(cfg):
    try:
        return cfg["port"]
    except KeyError as e:
        raise ConfigError("port") from e

try:
    load({})
except AppError as e:
    print(e, "| cause:", repr(e.__cause__))
# missing key: port | cause: KeyError('port')
```

## EAFP против LBYL и ExceptionGroup

**EAFP** (Easier to Ask Forgiveness than Permission) — попробовать и обработать исключение. **LBYL** (Look Before You Leap) — проверить заранее. В Python идиоматичен EAFP: он избегает гонок (файл могут удалить между проверкой и открытием) и двойного поиска.

```python
d = {"a": 1}
# LBYL
value = d["a"] if "a" in d else 0
# EAFP
try:
    value = d["b"]
except KeyError:
    value = 0
print(value)               # 0
```

`ExceptionGroup` (3.11+) объединяет несколько независимых ошибок, например из параллельных задач. Обрабатывается через `except*`, который может сработать для нескольких типов сразу.

```python
try:
    raise ExceptionGroup("batch", [ValueError("a"), TypeError("b"), ValueError("c")])
except* ValueError as eg:
    print("values:", len(eg.exceptions))    # values: 2
except* TypeError as eg:
    print("types:", len(eg.exceptions))     # types: 1
```

## Контекстные менеджеры

`with expr as x:` вызывает `__enter__` (его результат попадает в `x`), а при выходе — `__exit__(exc_type, exc, tb)` даже при исключении. Если `__exit__` вернёт истину, исключение подавляется.

```python
class Timer:
    def __enter__(self):
        print("enter")
        return self
    def __exit__(self, exc_type, exc, tb):
        print("exit, error:", exc_type.__name__ if exc_type else None)
        return exc_type is ValueError      # подавляем только ValueError

with Timer():
    raise ValueError("boom")
print("continued")
# enter / exit, error: ValueError / continued
```

Модуль `contextlib` упрощает жизнь:

| Инструмент | Назначение |
|---|---|
| `@contextmanager` | менеджер из генератора: код до `yield` — вход, после — выход |
| `suppress(*exc)` | игнорировать указанные исключения |
| `closing(obj)` | вызвать `obj.close()` на выходе |
| `ExitStack` | динамическое число менеджеров |
| `redirect_stdout` | временно перенаправить вывод |

```python
from contextlib import contextmanager, suppress

@contextmanager
def tag(name):
    print(f"<{name}>")
    try:
        yield
    finally:
        print(f"</{name}>")

with tag("b"):
    print("text")
# <b> / text / </b>

with suppress(FileNotFoundError):
    open("no_such_file.txt")
print("ok")                # ok
```

> В `@contextmanager` оборачивайте `yield` в `try/finally`, иначе при исключении внутри `with` код очистки не выполнится.

## Частые вопросы на собеседовании

- Когда выполняется `else` в `try`? → только если в `try` не было исключения.
- Что вернёт функция с `return` и в `try`, и в `finally`? → значение из `finally`.
- Почему не стоит писать голый `except:`? → он ловит `KeyboardInterrupt` и `SystemExit`, скрывает баги.
- Зачем `raise ... from e`? → сохранить причину в `__cause__` и понятный трейсбек.
- Что такое EAFP? → сначала действовать, потом ловить исключение; идиоматично для Python.
- Как написать контекстный менеджер? → класс с `__enter__`/`__exit__` или генератор с `@contextmanager`.

## Шпаргалка

- Порядок: `try` → `except` или `else` → `finally` всегда.
- `return` в `finally` перебивает результат и глушит исключение.
- Ловите конкретные исключения, сначала узкие, потом широкие; максимум — `Exception`.
- `raise` — переброс, `raise X from e` — цепочка, `from None` — скрыть причину.
- Свои исключения — от общего базового `AppError(Exception)`.
- `except*` для `ExceptionGroup`.
- `with` гарантирует очистку; `__exit__` → `True` подавляет ошибку.
