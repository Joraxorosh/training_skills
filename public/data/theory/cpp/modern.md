«Современный C++» — это стандарты начиная с C++11: вывод типов, лямбды, семантика перемещения, `constexpr`, а в C++17 и C++20 — structured bindings, `optional`, `variant` и концепты. Эти возможности делают код короче и быстрее, но добавляют новые ловушки, о которых и спрашивают на собеседовании.

## auto и decltype

`auto` выводит тип по правилам шаблонов: ссылки и верхнеуровневые `const` отбрасываются. `decltype(name)` возвращает объявленный тип имени, а `decltype((expr))` для lvalue-выражения — ссылку.

```cpp
const int x = 10;
auto a = x;            // int — const отброшен
const auto& b = x;     // const int&
auto&& c = x;          // const int& — forwarding-ссылка

int y = 0;
decltype(y)   d = y;   // int
decltype((y)) e = y;   // int& — изменение e меняет y
```

`nullptr` имеет тип `std::nullptr_t` и преобразуется только в указатели, а `NULL` — это `0`, который в перегрузке ведёт себя как целое число.

## Лямбды и захваты

Лямбда — объект анонимного класса с `operator()`. Захваченные переменные становятся полями этого объекта.

| Захват | Смысл |
|---|---|
| `[x]` | копия `x` в момент создания лямбды |
| `[&x]` | ссылка на `x` |
| `[=]` / `[&]` | всё используемое — по значению / по ссылке |
| `[p = std::move(ptr)]` | инициализирующий захват (C++14) |
| `[this]` / `[*this]` | указатель на объект / копия объекта (C++17) |

```cpp
int x = 0;
auto f = [x]() mutable { return ++x; };   // меняет свою копию
f(); f();                                 // 1, 2; внешний x == 0

std::function<int()> make() {
    int local = 42;
    return [&local] { return local; };    // висячая ссылка — UB при вызове
}
```

> Захват по ссылке и `[this]` опасны, когда лямбда переживает область видимости: при сохранении в `std::function`, передаче в другой поток или асинхронный callback.

## Семантика перемещения

Перемещение «забирает» ресурсы у объекта, который больше не нужен, вместо дорогого копирования. Перемещающий конструктор принимает `T&&`.

```cpp
std::string a = "hello";
std::string b = std::move(a);   // a — валидна, но состояние не указано

const std::string s = "data";
std::string t = std::move(s);   // копирование: из const не переместить
```

`std::move` сам ничего не перемещает — это `static_cast<T&&>`. Перемещает выбранный перегрузкой конструктор или оператор присваивания. Move-конструктор стоит помечать `noexcept`, иначе `vector` при росте будет копировать.

**Perfect forwarding.** В шаблоне `template <class T> void f(T&& x)` параметр — forwarding-ссылка: она связывается и с lvalue, и с rvalue. `std::forward<T>(x)` передаёт аргумент дальше с исходной категорией значения.

```cpp
template <class... Args>
auto make_widget(Args&&... args) {
    return std::make_unique<Widget>(std::forward<Args>(args)...);
}
```

## RVO и copy elision

С C++17 при возврате prvalue (`return T(...);`) и инициализации из него копирование и перемещение гарантированно опускаются: объект создаётся сразу на месте назначения. NRVO для именованного локального объекта — разрешённая, но не обязательная оптимизация. Писать `return std::move(local);` не нужно: это мешает NRVO.

## Шаблоны, constexpr и концепты

Шаблон — рецепт генерации кода для конкретных типов. Явная специализация задаёт отдельную реализацию для конкретного типа.

```cpp
template <typename T> void print(T)   { std::cout << "generic"; }
template <>           void print(int) { std::cout << "int"; }

constexpr int square(int n) { return n * n; }
static_assert(square(4) == 16);       // вычислено при компиляции

template <typename T>
concept Number = std::integral<T> || std::floating_point<T>;

template <Number T>
T twice(T x) { return x * 2; }        // twice("a") — понятная ошибка
```

`constexpr`-функция может выполняться и при компиляции, и во время работы программы. `consteval` (C++20) — только при компиляции. Концепты (C++20) задают требования к параметрам шаблона и дают читаемые ошибки вместо простыни из глубины инстанцирования.

## optional, variant и structured bindings

```cpp
std::optional<int> parse(std::string_view s);
if (auto v = parse("42")) std::cout << *v;
int n = parse("x").value_or(0);

std::variant<int, std::string> var = "text";
std::visit([](auto& val) { std::cout << val; }, var);
std::get<int>(var);                   // бросит std::bad_variant_access

std::map<std::string, int> m{{"a", 1}};
for (const auto& [key, value] : m)    // structured bindings, C++17
    std::cout << key << value;
```

`noexcept` — обещание не бросать исключений. Компилятор его не проверяет: если исключение всё же вылетит, вызывается `std::terminate`. Деструкторы неявно `noexcept`.

## Частые вопросы на собеседовании

- Что делает `std::move`? → Только приводит к rvalue-ссылке; перемещает конструктор или оператор перемещения.
- Чем `std::forward` отличается от `std::move`? → `forward` приводит к rvalue условно, сохраняя исходную категорию аргумента.
- Почему move-конструктор помечают `noexcept`? → Иначе `vector` при перевыделении будет копировать элементы.
- Что такое RVO? → Конструирование возвращаемого объекта сразу на месте вызывающего, без копирования; с C++17 гарантировано для prvalue.
- Чем опасен захват `[&]`? → Висячими ссылками, если лямбда живёт дольше захваченных переменных.
- `constexpr` или `consteval`? → `constexpr` можно вызывать и в runtime, `consteval` — только при компиляции.

## Шпаргалка

- `auto` отбрасывает ссылки и верхнеуровневый `const`.
- `decltype((x))` — это `T&`.
- Вместо `NULL` используйте `nullptr`.
- `std::move` из `const` — тихое копирование.
- Move-операции помечайте `noexcept`.
- Не пишите `return std::move(local);`.
- `T&&` в шаблоне — forwarding-ссылка, к ней применяют `std::forward`.
- `optional` — «может не быть», `variant` — «один из», концепты — ограничения шаблонов.
