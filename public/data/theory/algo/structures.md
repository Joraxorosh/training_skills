Стеки, очереди, связные списки и кучи — базовые структуры, на которых строятся более сложные алгоритмы: BFS использует очередь, DFS — стек, Дейкстра — кучу, LRU-кэш — хеш-таблицу со связным списком. На собеседовании нужно знать их операции и сложность, уметь реализовать их в Python и узнавать задачи, где они дают оптимальное решение.

## Стек, очередь, дек

| Структура | Принцип | В Python | push / pop |
|---|---|---|---|
| Стек | LIFO — последним пришёл, первым ушёл | `list`: `append`, `pop` | O(1) |
| Очередь | FIFO — первым пришёл, первым ушёл | `collections.deque`: `append`, `popleft` | O(1) |
| Дек | вставка/удаление с обоих концов | `deque`: `appendleft`, `pop` | O(1) |
| Очередь с приоритетом | извлекается минимум | `heapq` | O(log n) |

> Не используйте `list.pop(0)` для очереди: это O(n), все элементы сдвигаются. Берите `deque.popleft()`.

Стек — естественный выбор для вложенных структур: скобки, вычисление выражений, отмена действий, обход в глубину без рекурсии.

```python
def is_valid(s):
    pairs = {")": "(", "]": "[", "}": "{"}
    stack = []
    for ch in s:
        if ch in pairs:
            if not stack or stack.pop() != pairs[ch]:
                return False
        else:
            stack.append(ch)
    return not stack

print(is_valid("({[]})"), is_valid("(]"))   # True False
```

## Монотонный стек

Стек, в котором элементы поддерживаются в возрастающем или убывающем порядке. Решает за O(n) задачи «следующий больший/меньший элемент», «дни до потепления», «наибольший прямоугольник в гистограмме». Каждый элемент кладётся и снимается один раз.

```python
def next_greater(nums):
    res = [-1] * len(nums)
    stack = []                       # индексы, значения убывают
    for i, x in enumerate(nums):
        while stack and nums[stack[-1]] < x:
            res[stack.pop()] = x
        stack.append(i)
    return res

print(next_greater([2, 1, 2, 4, 3]))   # [4, 2, 4, -1, -1]
```

## Связные списки

Узел хранит значение и ссылку на следующий. Вставка и удаление при известном узле — O(1), но доступ по индексу — O(n). Приёмы:

- **Фиктивный узел** (dummy head) избавляет от особого случая головы.
- **Быстрый и медленный указатели**: середина списка, n-й с конца, поиск цикла.
- **Разворот на месте** тремя указателями `prev`, `cur`, `nxt`.

```python
class Node:
    def __init__(self, val, next=None):
        self.val, self.next = val, next

def reverse(head):
    prev = None
    while head:
        head.next, prev, head = prev, head, head.next
    return prev

def to_list(head):
    out = []
    while head:
        out.append(head.val); head = head.next
    return out

head = Node(1, Node(2, Node(3)))
print(to_list(reverse(head)))      # [3, 2, 1]
```

### Алгоритм Флойда (черепаха и заяц)

Медленный указатель идёт на 1 шаг, быстрый на 2. Если есть цикл — они встретятся; если быстрый дошёл до `None` — цикла нет. Чтобы найти начало цикла, после встречи ставим один указатель в голову и двигаем оба по 1 шагу — встретятся в начале цикла. Время O(n), память O(1).

```python
def cycle_start(head):
    slow = fast = head
    while fast and fast.next:
        slow, fast = slow.next, fast.next.next
        if slow is fast:
            slow = head
            while slow is not fast:
                slow, fast = slow.next, fast.next
            return slow.val
    return None

a, b, c, d = Node(1), Node(2), Node(3), Node(4)
a.next, b.next, c.next, d.next = b, c, d, b    # цикл начинается в b
print(cycle_start(a))              # 2
```

## Двоичная куча

Куча — полное двоичное дерево, где родитель не больше детей (min-heap). Хранится в массиве без указателей: для индекса `i` дети — `2i + 1` и `2i + 2`, родитель — `(i - 1) // 2`. Минимум всегда в `a[0]`.

| Операция | Сложность | Как работает |
|---|---|---|
| `peek` (минимум) | O(1) | `a[0]` |
| `push` | O(log n) | в конец, просеивание вверх |
| `pop` | O(log n) | последний в корень, просеивание вниз |
| `heapify` | O(n) | просеивание вниз от середины к началу |

**Почему heapify — O(n), а не O(n log n)?** Половина узлов — листья и не двигается, четверть опускается максимум на 1 уровень, восьмая — на 2 и так далее. Сумма `n/4 * 1 + n/8 * 2 + ...` сходится к O(n).

В Python `heapq` реализует только **min-heap**. Для max-heap кладите `-x` или кортежи `(-priority, item)`.

```python
import heapq
a = [5, 1, 8, 3, 2]
heapq.heapify(a)
print(a[0])                        # 1
heapq.heappush(a, 0)
print([heapq.heappop(a) for _ in range(3)])   # [0, 1, 2]

tasks = []
heapq.heappush(tasks, (2, "write"))
heapq.heappush(tasks, (1, "plan"))
print(heapq.heappop(tasks))        # (1, 'plan')
```

## Top-K и слияние

Чтобы найти k наибольших из n, держим **min-heap размера k**: если новый элемент больше вершины — заменяем. Время O(n log k), память O(k) — лучше, чем сортировка O(n log n), особенно для потока данных.

```python
def top_k(nums, k):
    heap = []
    for x in nums:
        if len(heap) < k:
            heapq.heappush(heap, x)
        elif x > heap[0]:
            heapq.heapreplace(heap, x)
    return sorted(heap, reverse=True)

print(top_k([3, 1, 5, 12, 2, 11], 3))           # [12, 11, 5]
print(heapq.nlargest(3, [3, 1, 5, 12, 2, 11]))  # [12, 11, 5]
print(list(heapq.merge([1, 4, 7], [2, 5], [3])))  # [1, 2, 3, 4, 5, 7]
```

Медиана потока — две кучи: max-heap для меньшей половины и min-heap для большей.

## LRU-кэш

LRU (Least Recently Used) вытесняет элемент, к которому дольше всего не обращались. Классическая реализация — хеш-таблица + двусвязный список: хеш даёт O(1) доступ к узлу, список хранит порядок использования и позволяет за O(1) переместить узел в начало и удалить хвост. В Python то же самое даёт `OrderedDict`.

```python
from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity):
        self.cap, self.data = capacity, OrderedDict()

    def get(self, key):
        if key not in self.data:
            return -1
        self.data.move_to_end(key)
        return self.data[key]

    def put(self, key, value):
        self.data[key] = value
        self.data.move_to_end(key)
        if len(self.data) > self.cap:
            self.data.popitem(last=False)

cache = LRUCache(2)
cache.put(1, "a"); cache.put(2, "b"); cache.get(1); cache.put(3, "c")
print(list(cache.data))            # [1, 3] — ключ 2 вытеснен
```

## Частые вопросы на собеседовании

- Как сделать очередь в Python? → `collections.deque` с `append`/`popleft`, не `list.pop(0)`.
- Как найти цикл в связном списке за O(1) памяти? → алгоритм Флойда, быстрый и медленный указатели.
- Почему построение кучи O(n)? → большинство узлов находятся внизу и просеиваются на малую глубину.
- Как найти k наибольших элементов? → min-heap размера k, O(n log k).
- Как реализовать LRU за O(1)? → хеш-таблица + двусвязный список или `OrderedDict`.
- Как сделать max-heap на `heapq`? → хранить отрицательные значения.

## Шпаргалка

- Стек — `list`, очередь — `deque`, приоритет — `heapq`.
- Монотонный стек → «следующий больший» за O(n).
- Связный список: dummy head, fast/slow, разворот тремя указателями.
- Флойд: встреча → один указатель в голову → встреча в начале цикла.
- Куча в массиве: дети `2i+1`, `2i+2`, родитель `(i-1)//2`.
- push/pop O(log n), heapify O(n), peek O(1).
- Top-k — min-heap размера k; LRU — хеш + двусвязный список.
