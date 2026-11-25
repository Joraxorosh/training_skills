Объекты в JavaScript — динамические наборы свойств, связанные цепочкой прототипов. Классы появились в ES2015, но под капотом остались теми же функциями-конструкторами и прототипами. На собеседовании проверяют, понимаете ли вы этот механизм, умеете ли копировать объекты без сюрпризов и знаете ли, когда нужен `Map` вместо обычного объекта.

## Цепочка прототипов

У каждого объекта есть скрытая ссылка `[[Prototype]]` на другой объект (или `null`). Если свойство не найдено в самом объекте, поиск продолжается по цепочке. Важно не путать два понятия:

- `obj.__proto__` (правильнее `Object.getPrototypeOf(obj)`) — прототип конкретного объекта;
- `F.prototype` — свойство функции: объект, который станет прототипом экземпляров, созданных через `new F()`.

```js
function Animal(name) { this.name = name; }
Animal.prototype.speak = function () { return this.name + ' speaks'; };

const rex = new Animal('Rex');
console.log(rex.speak());                                 // Rex speaks
console.log(rex.hasOwnProperty('speak'));                 // false
console.log(Object.getPrototypeOf(rex) === Animal.prototype); // true
console.log(Animal.prototype.__proto__ === Object.prototype); // true

const proto = { greet() { return 'hi ' + this.name; } };
const ann = Object.create(proto);
ann.name = 'Ann';
console.log(ann.greet(), Object.create(null).toString);   // hi Ann undefined
```

`new F()` делает четыре шага: создаёт пустой объект, ставит ему прототип `F.prototype`, вызывает `F` с этим `this` и возвращает объект (если конструктор не вернул другой объект).

## Классы

Класс — удобный синтаксис над тем же механизмом: `typeof` класса — `'function'`, методы лежат в `prototype`. Отличия от функции: вызов без `new` бросает `TypeError`, тело класса — строгий режим, объявление не поднимается (TDZ).

```js
class Shape {
  static count = 0;
  #id;                                  // настоящее приватное поле
  constructor(name) { this.name = name; this.#id = ++Shape.count; }
  get id() { return this.#id; }
  set label(v) { this.name = v.trim(); }
  describe() { return 'Shape ' + this.name; }
  static isShape(o) { return #id in o; }
}

class Circle extends Shape {
  constructor(r) {
    super('circle');                    // до super() обращаться к this нельзя
    this.r = r;
  }
  describe() { return super.describe() + ' r=' + this.r; }
}

const c = new Circle(2);
c.label = '  round ';
console.log(c.describe(), c.id, c.r);        // Shape round r=2 1 2
console.log(Shape.isShape(c), Shape.isShape({}), c['#id']); // true false undefined
console.log(typeof Shape, Shape.count);      // function 1
```

`#field` недоступен снаружи на уровне языка, в отличие от модификатора `private` в TypeScript, который исчезает после компиляции. `static` члены принадлежат классу, а не экземплярам.

## Копирование: поверхностное и глубокое

Присваивание копирует ссылку. Spread и `Object.assign` делают поверхностную копию: вложенные объекты остаются общими. Глубокую копию даёт `structuredClone`.

```js
const orig = { n: 1, inner: { v: 1 }, when: new Date(0), tags: new Set(['a']) };
const shallow = { ...orig };
shallow.inner.v = 2;
console.log(orig.inner.v);                   // 2 — общий вложенный объект

const deep = structuredClone(orig);
deep.inner.v = 3;
console.log(orig.inner.v, deep.when instanceof Date, deep.tags.has('a')); // 2 true true

const viaJson = JSON.parse(JSON.stringify(orig));
console.log(typeof viaJson.when, viaJson.tags); // string {}
```

| Способ | Глубина | Date, Map, Set | Циклы | Функции |
|---|---|---|---|---|
| `{ ...obj }`, `Object.assign` | поверхностная | по ссылке | да | по ссылке |
| `JSON.parse(JSON.stringify())` | глубокая | теряются | ошибка | выбрасываются |
| `structuredClone` | глубокая | сохраняются | да | `DataCloneError` |

> Подводные камни JSON: `undefined` и функции пропадают, `NaN` и `Infinity` становятся `null`, `Date` превращается в строку, `Map` и `Set` — в `{}`, `BigInt` бросает `TypeError`.

## Неизменяемость и сравнение

`Object.freeze` запрещает добавлять, удалять и менять собственные свойства, но только на первом уровне. `Object.seal` запрещает добавлять и удалять, но разрешает менять. Объекты сравниваются по ссылке.

```js
'use strict';
const cfg = Object.freeze({ level: 1, db: { host: 'a' } });
try { cfg.level = 2; } catch (e) { console.log(e.name); } // TypeError
cfg.db.host = 'b';                                        // вложенный не заморожен
console.log(cfg.db.host, Object.isFrozen(cfg.db));        // b false
console.log({ a: 1 } === { a: 1 });                       // false
```

## Map, Set, WeakMap

Ключи обычного объекта приводятся к строкам, поэтому два разных объекта-ключа превращаются в один `'[object Object]'`. `Map` хранит ключи любого типа, помнит порядок вставки и имеет `size`.

```js
const k1 = { id: 1 }, k2 = { id: 2 };
const plain = {};
plain[k1] = 'a'; plain[k2] = 'b';
console.log(Object.keys(plain));            // [ '[object Object]' ]

const map = new Map([[k1, 'a'], [k2, 'b']]);
console.log(map.get(k1), map.size);         // a 2
console.log([...new Set([1, 2, 2, 3])]);    // [ 1, 2, 3 ]

const meta = new WeakMap();
meta.set(k1, { visits: 1 });                // запись исчезнет вместе с k1
console.log(meta.has(k1));                  // true
```

`WeakMap` и `WeakSet` держат ключи слабо: когда на ключ не осталось других ссылок, сборщик мусора удаляет запись. Поэтому их нельзя перебрать и у них нет `size`. Применение — кэши и метаданные, привязанные к объектам, без утечек памяти.

## Деструктуризация

```js
const { a, b = 5, c: renamed, ...rest } = { a: 1, c: 3, d: 4, e: 5 };
console.log(a, b, renamed, rest);  // 1 5 3 { d: 4, e: 5 }

let x = 1, y = 2;
[x, y] = [y, x];
const [first, , third = 'def'] = ['f', 's'];
console.log(x, y, first, third);   // 2 1 f def
```

Значение по умолчанию подставляется только для `undefined`. Порядок ключей объекта определён: сначала целочисленные по возрастанию, затем строковые в порядке добавления, затем символы.

## Частые вопросы на собеседовании

- Чем `__proto__` отличается от `prototype`? → первое — прототип объекта, второе — свойство функции-конструктора, которое станет прототипом экземпляров.
- Класс в JS — это новая модель ООП? → нет, синтаксический сахар над прототипами с несколькими отличиями (строгий режим, обязателен `new`, TDZ).
- Как сделать глубокую копию? → `structuredClone`; JSON-способ теряет типы и падает на циклах.
- Делает ли `Object.freeze` объект полностью неизменяемым? → нет, только первый уровень; для глубокой заморозки нужна рекурсия.
- Когда брать `Map` вместо объекта? → ключи не строки, частые добавления и удаления, нужен порядок и `size`.
- Зачем `WeakMap`? → хранить данные об объектах, не мешая сборщику мусора.

## Шпаргалка

- Поиск свойства идёт по цепочке `[[Prototype]]` до `null`.
- `Object.create(proto)` — объект с заданным прототипом, `Object.create(null)` — без него.
- `class` = функция + `prototype`; `super()` до `this`.
- `#x` — настоящая приватность, `static` — поле класса.
- Spread — поверхностная копия, `structuredClone` — глубокая.
- `Object.freeze` поверхностный.
- Объекты равны только по ссылке.
- Ключи-объекты — `Map`, данные без утечек — `WeakMap`.
