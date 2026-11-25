Функции в JavaScript — объекты первого класса: их передают как аргументы, возвращают из других функций и хранят в переменных. На этом построены замыкания, каррирование, debounce и почти весь асинхронный код. Вторая большая тема — `this`: его значение определяется не местом объявления функции, а способом вызова, и именно здесь кандидаты ошибаются чаще всего.

## Способы объявить функцию

```js
console.log(decl(2));          // 4 — declaration поднимается целиком

function decl(x) { return x * 2; }
const expr = function (x) { return x * 2; };
const arrow = (x) => x * 2;
const fact = function self(n) { return n <= 1 ? 1 : n * self(n - 1); };

console.log(fact(5), typeof self); // 120 undefined
```

| | Hoisting | Свой `this` | `arguments` | Можно `new` |
|---|---|---|---|---|
| Function declaration | целиком | да | да | да |
| Function expression | только переменная | да | да | да |
| Стрелочная функция | только переменная | нет, лексический | нет | нет |
| Метод `{ m() {} }` | — | да | да | нет |

Имя named function expression (`self`) видно только внутри самой функции — удобно для рекурсии.

## Замыкания

Замыкание — функция вместе с лексическим окружением, в котором она создана. Функция «помнит» внешние переменные, даже когда внешняя функция уже завершилась. Запоминается **переменная**, а не значение.

```js
function makeCounter() {
  let count = 0;
  return { inc: () => ++count, get: () => count };
}
const c1 = makeCounter();
const c2 = makeCounter();
c1.inc(); c1.inc();
console.log(c1.get(), c2.get()); // 2 0

for (var i = 0; i < 3; i++) setTimeout(() => console.log('var', i)); // var 3 ×3
for (let j = 0; j < 3; j++) setTimeout(() => console.log('let', j)); // let 0, 1, 2
```

С `var` все колбэки разделяют одну переменную, которая к моменту вызова равна 3. `let` создаёт новую привязку на каждой итерации. До ES6 это лечили IIFE: `(function (i) { ... })(i)`.

> IIFE — функция, вызванная сразу после создания: `(function () { ... })()`. Раньше это был главный способ изолировать переменные и сделать приватное состояние; сейчас эту роль играют модули и блочная область видимости.

## Правила this

Значение `this` определяется в момент вызова. Правила по убыванию приоритета:

1. `new F()` — `this` равен новому объекту.
2. Явная привязка: `f.call(obj, a, b)`, `f.apply(obj, [a, b])`, `f.bind(obj)`.
3. Неявная: `obj.method()` — `this` равен объекту слева от точки.
4. По умолчанию: `undefined` в строгом режиме, глобальный объект в нестрогом.

Стрелочные функции в этих правилах не участвуют: их `this` берётся из внешней области в момент создания и не меняется ни `call`, ни `bind`.

```js
'use strict';
const user = {
  name: 'Ann',
  hi() { return this?.name; },
  later() { return () => this.name; },
};
const hi = user.hi;
console.log(user.hi(), hi());          // Ann undefined
console.log(hi.call({ name: 'Bob' })); // Bob
const bound = hi.bind(user).bind({ name: 'X' });
console.log(bound());                  // Ann — повторный bind не работает
console.log(user.later().call({ name: 'Y' })); // Ann — call не перепривязывает стрелку
```

## Потеря this в колбэках

Когда метод передают как значение (`setTimeout(obj.m)`, `button.onclick = obj.m`, `arr.map(obj.m)`), он вызывается без объекта и теряет `this`. Решения: `bind`, обёртка-стрелка или поле класса со стрелкой.

```js
class Timer {
  seconds = 0;
  tick() { this.seconds++; }
  tickArrow = () => { this.seconds++; };
}
const t = new Timer();
const f = t.tick;
try { f(); } catch (e) { console.log(e.name); } // TypeError
t.tickArrow.call(null);
[1, 2].forEach(t.tick.bind(t));
console.log(t.seconds);                         // 3
```

Поле-стрелка создаётся для каждого экземпляра отдельно (это память), зато всегда привязана к нему — удобно для обработчиков событий в React-компонентах.

## Параметры, rest и spread

Значение по умолчанию вычисляется при каждом вызове и подставляется только для `undefined`. Rest-параметр собирает оставшиеся аргументы в настоящий массив, spread раскладывает итерируемое в аргументы.

```js
function f(a, b = a * 2, list = []) {
  list.push(a);
  return [a + b, list.length];
}
console.log(f(2), f(2, null), f(2)); // [ 6, 1 ] [ 2, 1 ] [ 6, 1 ]

const sum = (...nums) => nums.reduce((s, n) => s + n, 0);
console.log(sum(...[1, 2, 3], 4)); // 10
console.log(Math.max());           // -Infinity
```

В отличие от Python, `list = []` создаётся заново при каждом вызове.

## Каррирование, debounce и throttle

Каррирование превращает `f(a, b, c)` в `f(a)(b)(c)`; полезно для частичного применения. Debounce откладывает вызов до паузы в событиях, throttle ограничивает частоту.

```js
const curry = (fn) => function c(...a) {
  return a.length >= fn.length ? fn(...a) : (...b) => c(...a, ...b);
};
const add3 = curry((a, b, c) => a + b + c);
console.log(add3(1)(2)(3), add3(1, 2)(3)); // 6 6

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
function throttle(fn, ms) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn.apply(this, args); }
  };
}
const log = debounce((q) => console.log('search', q), 50);
log('j'); log('js'); log('jso'); // через 50 мс: search jso
```

| Техника | Когда срабатывает | Пример |
|---|---|---|
| debounce | один раз после паузы | поиск при вводе, сохранение черновика |
| throttle | не чаще раза в N мс | scroll, resize, mousemove |

## Частые вопросы на собеседовании

- Что такое замыкание? → функция плюс ссылка на лексическое окружение, где она создана; позволяет хранить приватное состояние.
- Почему цикл с `var` и `setTimeout` выводит одно число? → все колбэки замыкают одну переменную; `let` создаёт новую на каждой итерации.
- Как определяется `this`? → по способу вызова: `new` → `call/apply/bind` → `obj.m()` → по умолчанию; у стрелок — лексически.
- Чем `call` отличается от `apply` и `bind`? → `call` принимает аргументы списком, `apply` — массивом, `bind` возвращает новую функцию.
- Можно ли перепривязать bound-функцию? → нет, ни `bind`, ни `call` не меняют её `this` (только `new`).
- Debounce или throttle для поиска? → debounce: запрос уходит после паузы в наборе.

## Шпаргалка

- Declaration поднимается целиком, expression и стрелка — нет.
- Замыкание хранит переменную, а не значение.
- `this`: `new` > явная привязка > `obj.m()` > по умолчанию.
- Стрелка: нет своих `this`, `arguments`, `prototype`, нельзя `new`.
- Метод, переданный как колбэк, теряет `this` — `bind` или стрелка.
- Default-параметр — только для `undefined`, вычисляется при каждом вызове.
- Debounce — после паузы, throttle — не чаще N мс.
