Знание языка — половина дела: в реальном проекте нужно уметь организовать модули и пакеты, изолировать зависимости, описать типы, написать тесты и настроить логирование. На собеседовании на middle-позицию эти вопросы показывают, работали ли вы с продакшн-кодом. Пройдёмся по ключевым инструментам экосистемы.

## Модули, пакеты и импорт

Модуль — файл `.py`, пакет — каталог с модулями (обычно с `__init__.py`). При первом `import` модуль выполняется целиком и кэшируется в `sys.modules`; повторный импорт берёт объект из кэша. Поиск идёт по `sys.path`: каталог скрипта, `PYTHONPATH`, стандартная библиотека, `site-packages`.

```python
import json                        # весь модуль
from pathlib import Path           # конкретное имя
from os import path as osp         # с псевдонимом
# from .utils import helper        # относительный импорт внутри пакета
# from module import *             # импортирует имена из __all__; избегайте
```

### __name__ == "__main__"

При запуске файла напрямую `__name__` равно `"__main__"`, при импорте — имени модуля. Это позволяет модулю быть и библиотекой, и скриптом.

```python
def main():
    print("running as script")

if __name__ == "__main__":
    main()                         # running as script
```

`python -m package.module` запускает модуль как скрипт с правильным `sys.path` — так работают `python -m venv`, `python -m pytest`.

### Циклические импорты

Если `a` импортирует `b`, а `b` импортирует `a`, один из модулей окажется частично инициализирован, и `from a import x` упадёт с `ImportError`. Решения: вынести общее в третий модуль, импортировать внутри функции, использовать `import a` вместо `from a import x`, а для аннотаций — `if TYPE_CHECKING:`.

## Виртуальные окружения и зависимости

Виртуальное окружение изолирует пакеты проекта от системного Python и других проектов.

```python
# python -m venv .venv
# .venv\Scripts\activate          (Windows)
# source .venv/bin/activate       (Linux/macOS)
# pip install requests
# pip freeze > requirements.txt
# pip install -r requirements.txt
```

Современный стандарт описания проекта — `pyproject.toml` (PEP 621): метаданные, зависимости, настройки инструментов в одном файле.

| Инструмент | Для чего |
|---|---|
| `pip` + `venv` | базовая установка, есть везде |
| `requirements.txt` | список зависимостей (часто с пинами версий) |
| `poetry` | зависимости, lock-файл, сборка и публикация |
| `uv` | очень быстрый менеджер на Rust: venv, lock, версии Python |
| `pipx` | установка CLI-утилит в изолированные окружения |

Lock-файл (`poetry.lock`, `uv.lock`) фиксирует точные версии всех транзитивных зависимостей — сборки воспроизводимы.

## Аннотации типов

Аннотации не проверяются при выполнении — их читают IDE и статические анализаторы (`mypy`, `pyright`). Они документируют код и ловят ошибки до запуска.

```python
from typing import TypedDict, Protocol, Callable

def greet(name: str, times: int = 1) -> list[str]:
    return [f"hi {name}"] * times

def first[T](items: list[T]) -> T | None:      # обобщения, синтаксис 3.12
    return items[0] if items else None

class User(TypedDict):
    id: int
    email: str | None

class Closable(Protocol):                       # структурная типизация
    def close(self) -> None: ...

Handler = Callable[[int], str]
print(greet("Ann", 2), first([3, 4]))           # ['hi Ann', 'hi Ann'] 3
print(greet.__annotations__["return"])          # list[str]
```

- `X | None` вместо `Optional[X]` (3.10+), встроенные `list[int]`, `dict[str, int]` вместо `typing.List` (3.9+).
- `Any` отключает проверку, `object` — «что угодно, но проверяй».
- `Protocol` — утиная типизация: класс подходит, если у него есть нужные методы, без наследования.
- `mypy --strict src/` — строгий режим; в CI запускается вместе с тестами.

## Тестирование с pytest

pytest находит файлы `test_*.py` и функции `test_*`, использует обычный `assert` с подробным выводом разницы.

```python
import pytest
from unittest.mock import patch

def divide(a, b):
    return a / b

@pytest.fixture
def numbers():
    data = [1, 2, 3]
    yield data                     # код после yield — teardown
    data.clear()

def test_sum(numbers):
    assert sum(numbers) == 6

@pytest.mark.parametrize("a, b, expected", [(6, 3, 2), (5, 2, 2.5)])
def test_divide(a, b, expected):
    assert divide(a, b) == expected

def test_zero():
    with pytest.raises(ZeroDivisionError):
        divide(1, 0)

def test_patch():
    with patch("time.time", return_value=0):
        import time
        assert time.time() == 0
```

- Фикстуры внедряются по имени параметра; `scope="session"` — одна на весь прогон; общие фикстуры живут в `conftest.py`.
- `parametrize` запускает тест на нескольких наборах данных.
- `mock.patch("where.used.name")` заменяет объект **там, где он используется**, а не где определён.
- `tmp_path`, `monkeypatch`, `capsys` — встроенные фикстуры.

> Типичная ошибка с `patch`: модуль `app.py` сделал `from requests import get`, а тест патчит `requests.get`. Патчить нужно `app.get`.

## Логирование

`print` не годится для продакшна. Модуль `logging` даёт уровни, форматирование и обработчики (консоль, файл, внешние системы).

```python
import logging, sys

logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                    format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)

log.debug("hidden")                    # ниже уровня INFO
log.info("user %s logged in", "ann")   # INFO __main__: user ann logged in
try:
    1 / 0
except ZeroDivisionError:
    log.exception("failed")            # ERROR + трейсбек
```

Уровни: `DEBUG < INFO < WARNING < ERROR < CRITICAL`. В библиотеках используют `getLogger(__name__)` и не вызывают `basicConfig`. Аргументы передают через `%s`, а не f-строкой: форматирование выполняется лениво, только если сообщение будет выведено.

## Линтеры и форматтеры

| Инструмент | Роль |
|---|---|
| `ruff` | линтер и форматтер на Rust, заменяет flake8, isort, pyupgrade и (через `ruff format`) black |
| `black` | бескомпромиссный форматтер кода |
| `mypy` / `pyright` | статическая проверка типов |
| `pre-commit` | запуск проверок перед каждым коммитом |

Все настройки хранятся в `pyproject.toml`, проверки запускаются в CI.

## Частые вопросы на собеседовании

- Зачем `if __name__ == "__main__":`? → чтобы код запускался только при прямом запуске файла, а не при импорте.
- Как решить циклический импорт? → вынести общее в отдельный модуль или импортировать внутри функции.
- Зачем виртуальное окружение? → изоляция версий зависимостей между проектами.
- Проверяются ли аннотации при выполнении? → нет, только статическими анализаторами.
- Что такое фикстура в pytest? → функция подготовки данных/ресурсов, внедряемая по имени параметра, с teardown после `yield`.
- Где патчить объект через `mock.patch`? → в пространстве имён, где он используется.

## Шпаргалка

- Модуль выполняется один раз и кэшируется в `sys.modules`.
- `python -m module` для запуска модулей и инструментов.
- Каждому проекту — свой `.venv`; зависимости и настройки — в `pyproject.toml`, версии — в lock-файле.
- Типы: `list[int]`, `X | None`, `Protocol`, проверка `mypy`.
- pytest: `assert`, фикстуры, `parametrize`, `pytest.raises`, `conftest.py`.
- `logging.getLogger(__name__)`, `log.exception` в `except`.
- `ruff` + `mypy` + `pre-commit` — стандартный набор качества.
