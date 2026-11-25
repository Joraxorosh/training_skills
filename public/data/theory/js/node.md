Node.js — среда выполнения JavaScript на движке V8 с неблокирующим вводом-выводом на базе libuv. На собеседовании по Node проверяют модульные системы, работу с npm, фазы event loop, потоки и масштабирование, а у фулстек-кандидатов — ещё и браузерные основы: события DOM и хранилища.

## CommonJS и ES-модули

В Node.js две модульные системы. CommonJS (`require`, `module.exports`) — исторический формат: загрузка синхронная, модуль выполняется один раз и кэшируется. ES-модули (`import`, `export`) — стандарт языка: импорты статичны, связываются до выполнения кода и являются живыми привязками.

```js
// math.cjs — CommonJS
module.exports = { add: (a, b) => a + b };
// app.cjs
const { add } = require('./math.cjs');

// math.mjs — ESM
export const add = (a, b) => a + b;
export default function mul(a, b) { return a * b; }
// app.mjs
import mul, { add } from './math.mjs';
const data = await fetch('https://example.com'); // top-level await — только в ESM
```

| | CommonJS | ES-модули |
|---|---|---|
| Синтаксис | `require` / `module.exports` | `import` / `export` |
| Загрузка | синхронная, в рантайме | статический анализ, асинхронная |
| Top-level `await` | нет | да |
| `__dirname`, `require` | есть | нет, вместо них `import.meta.dirname` и `import.meta.url` |
| `this` на верхнем уровне | `module.exports` | `undefined` |
| Как включить | `.cjs` или по умолчанию | `.mjs` или `"type": "module"` в `package.json` |

Из ESM можно импортировать CommonJS: `module.exports` станет default-экспортом. В обратную сторону исторически работал только динамический `import()`; новые версии Node.js позволяют `require()` синхронного ESM-графа (без top-level await).

## npm и package.json

```json
{
  "name": "api",
  "type": "module",
  "scripts": { "start": "node src/index.js", "test": "node --test" },
  "dependencies": { "express": "^4.19.2" },
  "devDependencies": { "eslint": "~9.5.0" },
  "engines": { "node": ">=20" }
}
```

- `dependencies` — нужны коду в рантайме; `devDependencies` — тесты, линтеры, сборка (не ставятся с `--omit=dev`); `peerDependencies` — ожидаемые от хост-проекта (плагины).
- Semver `MAJOR.MINOR.PATCH`: `^4.19.2` — `>=4.19.2 <5.0.0`, `~9.5.0` — `>=9.5.0 <9.6.0`, точная версия — без префикса.
- `package-lock.json` фиксирует точное дерево зависимостей. Его коммитят, а в CI используют `npm ci` — установка строго по lock-файлу.
- `npx` запускает бинарник пакета без глобальной установки.

## Event loop в Node.js

Цикл libuv проходит фазы: **timers** (`setTimeout`, `setInterval`) → pending callbacks → **poll** (ожидание и колбэки I/O) → **check** (`setImmediate`) → close callbacks. Между любыми колбэками Node опустошает сначала очередь `process.nextTick`, затем микрозадачи промисов.

```js
const fs = require('fs');

setTimeout(() => console.log('timeout'));
setImmediate(() => console.log('immediate'));
process.nextTick(() => console.log('tick'));
Promise.resolve().then(() => console.log('micro'));
console.log('sync');
// sync, tick, micro, затем timeout/immediate — порядок между ними не гарантирован

fs.readFile(__filename, () => {
  setTimeout(() => console.log('io: timeout'));
  setImmediate(() => console.log('io: immediate'));
});
// внутри I/O всегда: io: immediate, io: timeout
```

> Рекурсивный `process.nextTick` или бесконечная цепочка промисов не дадут циклу перейти к I/O. Тяжёлые синхронные вычисления блокируют все запросы — выносите их в `worker_threads`.

## Потоки и backpressure

Потоки (`Readable`, `Writable`, `Duplex`, `Transform`) обрабатывают данные порциями, не загружая всё в память. Если источник быстрее приёмника, буфер растёт — это и есть проблема backpressure. `write()` возвращает `false`, когда буфер превысил `highWaterMark`; писать дальше нужно после события `'drain'`.

```js
const { pipeline } = require('stream/promises');
const { createReadStream, createWriteStream, writeFileSync } = require('fs');
const { createGzip } = require('zlib');

writeFileSync('in.txt', 'hello\n'.repeat(1000));
pipeline(createReadStream('in.txt'), createGzip(), createWriteStream('in.txt.gz'))
  .then(() => console.log('done'))      // done
  .catch((e) => console.error('failed', e));
```

`pipeline` сам учитывает backpressure, корректно закрывает все потоки и передаёт ошибку любого звена. Голый `.pipe()` ошибки не пробрасывает.

## Масштабирование и обработка ошибок

| | `worker_threads` | `cluster` / несколько процессов |
|---|---|---|
| Единица | поток в том же процессе | отдельный процесс |
| Память | своя куча V8, можно `SharedArrayBuffer` | полностью раздельная |
| Задача | CPU-тяжёлые вычисления | использовать все ядра для HTTP-сервера |

Для I/O-нагрузки воркеры не нужны — она и так неблокирующая. В продакшене вместо `cluster` часто запускают несколько реплик в Kubernetes или через PM2.

Ошибки в сервере: async-обработчики оборачивают в `try/catch` или middleware ошибок, все промисы должны иметь обработчик. На `uncaughtException` и `unhandledRejection` правильная реакция — залогировать, закрыть сервер (`server.close()`) и завершить процесс, чтобы его перезапустил супервизор: состояние после такой ошибки ненадёжно.

## Браузер: события и хранилища

Событие DOM проходит три фазы: перехват (capturing) от `window` вниз, цель, всплытие (bubbling) вверх. По умолчанию обработчики работают на всплытии; `addEventListener(type, fn, true)` — на перехвате.

```js
// <ul id="list"><li data-id="1"><b>Item</b></li> ...</ul>
list.addEventListener('click', (e) => {
  const li = e.target.closest('li');    // клик мог прийтись на <b>
  if (!li || !list.contains(li)) return;
  console.log('selected', li.dataset.id);
});
```

Делегирование — один обработчик на контейнере вместо сотни на элементах; работает и для добавленных позже элементов. `stopPropagation()` останавливает распространение, `preventDefault()` отменяет действие по умолчанию.

| | Cookie | `localStorage` | `sessionStorage` |
|---|---|---|---|
| Отправляется на сервер | да, с каждым запросом | нет | нет |
| Объём | около 4 КБ | около 5 МБ | около 5 МБ |
| Время жизни | `Expires` / `Max-Age` | бессрочно | до закрытия вкладки |
| Доступ из JS | нет при `HttpOnly` | да | да |

Токены сессии безопаснее хранить в cookie с `HttpOnly`, `Secure` и `SameSite`: `localStorage` читается любым скриптом при XSS.

Бандлеры (Vite, webpack, esbuild, Rollup) собирают модули в оптимизированные файлы: разрешают импорты, транспилируют TS и JSX, минифицируют, делят код на чанки и выбрасывают неиспользуемые экспорты (tree shaking), что возможно благодаря статичности ESM.

## Частые вопросы на собеседовании

- Чем `require` отличается от `import`? → синхронная загрузка в рантайме против статических живых привязок; top-level await — только в ESM.
- Что означает `^1.2.3`? → любая `1.x.x` не ниже `1.2.3`; `~1.2.3` — только patch-обновления.
- Что выполнится раньше: `nextTick` или `Promise.then`? → `nextTick`; обе очереди опустошаются до таймеров и I/O.
- Что такое backpressure? → приёмник медленнее источника; решается паузой до `'drain'` или `pipeline`.
- Когда нужны `worker_threads`? → для CPU-тяжёлых задач, блокирующих event loop.
- Что такое делегирование событий? → один обработчик на родителе, цель определяется через `event.target`.

## Шпаргалка

- `.mjs` / `"type": "module"` — ESM, `.cjs` — CommonJS.
- `devDependencies` — для разработки; lock-файл коммитить, в CI — `npm ci`.
- `^` — minor и patch, `~` — только patch.
- Фазы: timers → poll → check; `nextTick` → промисы между колбэками.
- Внутри I/O `setImmediate` раньше `setTimeout(0)`.
- Потоки соединять через `pipeline`.
- CPU — `worker_threads`, ядра для сервера — `cluster` или реплики.
- `uncaughtException` → лог, graceful shutdown, выход.
- События: capture → target → bubble; делегирование через `closest`.
- Токены — в `HttpOnly` cookie, не в `localStorage`.
