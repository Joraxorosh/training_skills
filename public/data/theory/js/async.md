JavaScript выполняет код в одном потоке, но умеет ждать сеть, таймеры и диск, не блокируясь. За это отвечает event loop: движок выполняет синхронный код, а колбэки асинхронных операций ставит в очереди. Задачи «в каком порядке выведутся числа» — обязательная часть собеседования на фронтенд и Node.js, и решаются они знанием двух очередей.

## Стек вызовов и очереди

Цикл событий работает так:

1. Выполнить синхронный код до опустошения стека вызовов.
2. Выполнить **все** микрозадачи, включая добавленные по ходу.
3. Взять **одну** макрозадачу (таймер, событие, I/O), выполнить её и вернуться к шагу 2.
4. В браузере между макрозадачами может произойти отрисовка.

| Микрозадачи | Макрозадачи |
|---|---|
| `.then` / `.catch` / `.finally` | `setTimeout`, `setInterval` |
| продолжение после `await` | события DOM, сетевые колбэки |
| `queueMicrotask` | `setImmediate`, I/O в Node.js |
| `MutationObserver` | `MessageChannel` |

```js
console.log(1);
setTimeout(() => console.log(2));
Promise.resolve()
  .then(() => { console.log(3); setTimeout(() => console.log(4)); })
  .then(() => console.log(5));
queueMicrotask(() => console.log(6));
console.log(7);
// 1 7 3 6 5 2 4
```

Второй `then` попадает в очередь только после выполнения первого, поэтому 6 выводится раньше 5. `setTimeout(fn, 0)` не означает «сразу»: колбэк ждёт, пока опустеет стек и все микрозадачи.

> Бесконечная цепочка микрозадач блокирует отрисовку и таймеры так же, как бесконечный цикл.

## Промисы

Промис — объект-обещание результата. Состояния: `pending`, затем ровно один раз `fulfilled` или `rejected`. Executor выполняется синхронно; повторные `resolve`/`reject` игнорируются; обработчики всегда вызываются асинхронно.

```js
const p = new Promise((resolve, reject) => {
  console.log('executor');
  resolve('a');
  resolve('b');                       // игнорируется
  reject(new Error('c'));             // игнорируется
});
p.then((v) => console.log('then', v));
console.log('sync');
// executor
// sync
// then a
```

`then` возвращает новый промис. Возврат значения передаёт его дальше, возврат промиса — ждёт его, исключение отклоняет цепочку до ближайшего `catch`. После `catch`, вернувшего значение, цепочка снова успешна.

```js
Promise.resolve(1)
  .then((v) => { throw new Error('boom ' + v); })
  .then(() => console.log('пропущено'))
  .catch((e) => { console.log(e.message); return 5; })
  .finally(() => console.log('finally'))
  .then((v) => console.log(v));
// boom 1
// finally
// 5
```

## Комбинаторы

```js
const ok = (v, ms) => new Promise((r) => setTimeout(() => r(v), ms));
const fail = (m, ms) => new Promise((_, j) => setTimeout(() => j(new Error(m)), ms));

Promise.all([ok(1, 10), ok(2, 5)]).then((v) => console.log('all', v));
Promise.allSettled([ok(1, 10), fail('x', 5)])
  .then((r) => console.log('allSettled', r.map((x) => x.status)));
Promise.race([ok('slow', 20), fail('fast', 5)]).catch((e) => console.log('race', e.message));
Promise.any([ok('slow', 20), fail('fast', 5)]).then((v) => console.log('any', v));
// race fast
// all [ 1, 2 ]
// allSettled [ 'fulfilled', 'rejected' ]
// any slow
```

| Метод | Успех | Ошибка |
|---|---|---|
| `Promise.all` | все выполнены — массив значений | первая ошибка |
| `Promise.allSettled` | всегда — массив `{ status, value/reason }` | никогда |
| `Promise.race` | первый завершившийся | первый завершившийся с ошибкой |
| `Promise.any` | первый успешный | все упали — `AggregateError` |

## async/await

`async`-функция всегда возвращает промис. Код до первого `await` выполняется синхронно, остаток — в микрозадаче. `await` на отклонённом промисе бросает исключение, поэтому работает обычный `try/catch`.

```js
async function load(id) {
  try {
    if (id < 0) throw new Error('bad id');
    return await Promise.resolve({ id });
  } catch (e) {
    return { error: e.message };
  }
}
load(-1).then(console.log);  // { error: 'bad id' }
load(1).then(console.log);   // { id: 1 }
```

> `return promise` без `await` внутри `try` не перехватит отклонение: функция уже вышла из блока. Пишите `return await`, если ошибку нужно поймать здесь.

## Последовательно или параллельно

Промис начинает работу в момент создания. Последовательные `await` складывают время, `Promise.all` — берёт максимум.

```js
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let t = Date.now();
  await wait(100); await wait(100);
  console.log('seq', Math.round((Date.now() - t) / 100) * 100);  // seq 200

  t = Date.now();
  await Promise.all([wait(100), wait(100)]);
  console.log('par', Math.round((Date.now() - t) / 100) * 100);  // par 100

  const out = [];
  [1, 2, 3].forEach(async (x) => { await wait(1); out.push(x); });
  console.log('forEach', out.length);                            // forEach 0

  const res = [];
  for (const x of [1, 2, 3]) { await wait(1); res.push(x); }
  console.log('for...of', res.length);                           // for...of 3
}
main();
```

`forEach`, `map` и `filter` не ждут async-колбэков. Для последовательной обработки — `for...of` с `await`, для параллельной — `await Promise.all(items.map(fn))`.

## Асинхронная итерация, отмена и необработанные ошибки

`for await...of` перебирает асинхронные итераторы: генераторы `async function*`, потоки Node.js, страницы API.

```js
async function* pages() {
  for (let i = 1; i <= 3; i++) yield new Promise((r) => setTimeout(() => r(i), 5));
}
(async () => {
  let sum = 0;
  for await (const p of pages()) sum += p;
  console.log(sum);                       // 6

  const controller = new AbortController();
  controller.abort();
  try {
    await fetch('https://example.com', { signal: controller.signal });
  } catch (e) {
    console.log(e.name);                  // AbortError
  }
})();
```

`AbortController` — стандартный способ отмены: сигнал передают в `fetch`, `addEventListener`, потоки и свои функции, а `controller.abort()` отклоняет операцию с `AbortError`. `AbortSignal.timeout(ms)` создаёт сигнал с таймаутом.

Отклонённый промис без обработчика — unhandled rejection. В браузере это событие `unhandledrejection` на `window`, в Node.js 15+ — по умолчанию падение процесса; перехват — `process.on('unhandledRejection')`.

## Частые вопросы на собеседовании

- Чем микрозадачи отличаются от макрозадач? → после каждой макрозадачи выполняются все микрозадачи; промисы — микро, таймеры и события — макро.
- Почему `setTimeout(fn, 0)` срабатывает позже `Promise.then`? → таймер — макрозадача и ждёт опустошения очереди микрозадач.
- Синхронен ли executor промиса? → да, асинхронны только обработчики `then/catch/finally`.
- Чем `Promise.all` отличается от `allSettled`? → `all` падает на первой ошибке, `allSettled` ждёт все и возвращает статусы.
- Почему `await` внутри `forEach` не работает? → `forEach` игнорирует возвращаемые промисы.
- Как отменить `fetch`? → передать `signal` от `AbortController` и вызвать `abort()`.

## Шпаргалка

- Порядок: синхронный код → все микрозадачи → одна макрозадача → снова микрозадачи.
- Executor синхронный, обработчики — всегда асинхронные.
- Промис меняет состояние один раз.
- Ошибка летит по цепочке до ближайшего `catch`.
- `all` — fail fast, `allSettled` — все статусы, `race` — первый любой, `any` — первый успешный.
- `async` всегда возвращает промис; `try/catch` ловит ошибки `await`.
- Параллельно — `Promise.all`, последовательно — `for...of` + `await`.
- Отмена — `AbortController`.
