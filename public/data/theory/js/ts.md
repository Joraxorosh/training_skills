TypeScript — надстройка над JavaScript, которая добавляет статическую проверку типов. Важно помнить главное: типы существуют только на этапе компиляции и полностью стираются, в рантайме работает обычный JS. На собеседовании спрашивают про структурную типизацию, разницу `any`, `unknown` и `never`, сужение типов, дженерики и утилитные типы.

## Структурная типизация

Совместимость типов определяется формой (набором свойств), а не именем. Если у объекта есть все нужные поля нужных типов, он подходит — даже если интерфейс нигде не упомянут.

```ts
interface Point { x: number; y: number }
function len(p: Point) { return Math.hypot(p.x, p.y); }

const p3 = { x: 3, y: 4, z: 5 };
console.log(len(p3));              // 5 — лишнее поле z допустимо
// len({ x: 3, y: 4, z: 5 });      // ошибка: excess property check для литерала

class Cat { name = 'Tom'; }
const notCat: Cat = { name: 'Jerry' }; // ок: форма совпадает
console.log(notCat instanceof Cat);    // false
```

Исключение — «свежий» объектный литерал: для него TypeScript проверяет лишние свойства, чтобы ловить опечатки.

## any, unknown, never

| Тип | Что можно присвоить | Что можно делать со значением |
|---|---|---|
| `any` | что угодно | что угодно — проверки выключены |
| `unknown` | что угодно | ничего, пока не сузишь тип |
| `never` | ничего | — (функция не возвращает, ветка недостижима) |

```ts
function parse(json: string): unknown { return JSON.parse(json); }
const data = parse('{"name": "Ann"}');
// data.name;                       // ошибка: 'data' is of type 'unknown'
if (typeof data === 'object' && data !== null && 'name' in data) {
  console.log(data.name);           // Ann
}

function fail(msg: string): never { throw new Error(msg); }
```

Предпочитайте `unknown` вместо `any` для внешних данных: компилятор заставит проверить значение перед использованием.

## Union, intersection и сужение

Union `A | B` — значение одного из типов; intersection `A & B` — значение, обладающее свойствами обоих. Работать с union можно только через сужение: `typeof`, `instanceof`, `in`, сравнение с литералом, пользовательский type guard.

```ts
type Shape =
  | { kind: 'circle'; r: number }
  | { kind: 'square'; a: number };

function area(s: Shape): number {
  switch (s.kind) {                 // дискриминант сужает тип
    case 'circle': return Math.PI * s.r ** 2;
    case 'square': return s.a ** 2;
    default: {
      const unreachable: never = s; // ошибка компиляции, если вариант забыт
      return unreachable;
    }
  }
}

function isCircle(s: Shape): s is { kind: 'circle'; r: number } {
  return s.kind === 'circle';
}

const shapes: Shape[] = [{ kind: 'square', a: 2 }, { kind: 'circle', r: 1 }];
console.log(area(shapes[0]), shapes.filter(isCircle).length); // 4 1
```

> Пересечение несовместимых типов, например `{ x: string } & { x: number }`, даёт свойство типа `never` — такой объект создать невозможно.

## type и interface

Оба описывают форму объекта, и для объектов почти взаимозаменяемы. `interface` поддерживает слияние объявлений и `extends`, хорошо читается в сообщениях об ошибках. `type` умеет всё остальное: union, кортежи, mapped и conditional types.

```ts
interface User { id: number }
interface User { name: string }   // declaration merging
const u: User = { id: 1, name: 'Ann' };

type Id = string | number;          // через interface так нельзя
type Admin = User & { role: 'admin' };
const a: Admin = { ...u, role: 'admin' };
console.log(a.role);                // admin
```

## Дженерики, keyof и утилитные типы

Дженерик — параметр типа. Ограничение `extends` сужает допустимые типы, `keyof T` даёт union ключей, `T[K]` — тип значения по ключу.

```ts
function getProp<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
const user = { id: 1, name: 'Ann', tags: ['a'] };
const n = getProp(user, 'name');    // string
// getProp(user, 'age');            // ошибка: 'age' не ключ user

type U = typeof user;               // typeof в позиции типа
type Preview = Pick<U, 'id' | 'name'>;
type Draft = Partial<Omit<U, 'id'>>;
type ById = Record<number, Preview>;
const cache: ById = { 1: { id: 1, name: n } };
console.log(cache[1].name);         // Ann

function make() { return { ok: true, count: 1 }; }
type R = ReturnType<typeof make>;   // { ok: boolean; count: number }
```

| Утилита | Результат |
|---|---|
| `Partial<T>` / `Required<T>` | все поля необязательные / обязательные |
| `Readonly<T>` | все поля `readonly` |
| `Pick<T, K>` / `Omit<T, K>` | оставить / убрать ключи |
| `Record<K, V>` | объект с ключами `K` и значениями `V` |
| `ReturnType<F>` / `Parameters<F>` | тип результата / кортеж аргументов функции |
| `Awaited<T>` | тип значения промиса |

Условные типы над параметром дистрибутивны: `T extends any ? T[] : never` для `string | number` даст `string[] | number[]`.

## Литералы, as const и enum

`as const` делает значение глубоко `readonly` и сохраняет литеральные типы. Из массива констант удобно получать union без дублирования.

```ts
const ROLES = ['admin', 'user', 'guest'] as const;
type Role = typeof ROLES[number];   // 'admin' | 'user' | 'guest'

function can(role: Role) { return role !== 'guest'; }
console.log(can('admin'), ROLES.includes('guest')); // true true
```

`enum` — одна из немногих конструкций TS, которая генерирует JS-объект в рантайме. Поэтому многие команды предпочитают union литералов с `as const`: они полностью стираются, и такой код запускается даже через встроенное в Node.js удаление типов (оно не поддерживает `enum` без флагов).

## Типы стираются

`as` — не приведение, а обещание компилятору. `private` — проверка только при компиляции. Данные из сети, `JSON.parse` и `localStorage` нужно проверять вручную или схемой (zod, valibot).

```ts
interface ApiUser { name: string }
const fromApi = JSON.parse('{"name": 42}') as ApiUser;
console.log(typeof fromApi.name);  // number — компилятор не помешал

class Box { private secret = 1; #real = 2; }
const box = new Box() as any;
console.log(box.secret, box.real); // 1 undefined
```

Ключевые флаги `tsconfig`: `strict: true` включает `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes` и другие проверки. Полезные дополнения: `noUncheckedIndexedAccess` (доступ по индексу даёт `T | undefined`) и `exactOptionalPropertyTypes`.

## Частые вопросы на собеседовании

- Чем `unknown` лучше `any`? → принимает любое значение, но требует сужения перед использованием.
- Когда появляется `never`? → у функций, которые не возвращают управление, в недостижимых ветках и при несовместимых пересечениях.
- `type` или `interface`? → для объектов — по стилю команды; union, кортежи и вычисляемые типы — только `type`; слияние — только `interface`.
- Что такое discriminated union? → union объектов с общим литеральным полем (`kind`), по которому компилятор сужает тип.
- Проверяет ли TypeScript типы в рантайме? → нет, типы стираются; внешние данные валидируют отдельно.
- Чем `private` отличается от `#field`? → `private` — только для компилятора, `#field` — приватность на уровне JS.

## Шпаргалка

- Совместимость по форме; лишние поля ловятся только у свежих литералов.
- `any` — выключить проверки, `unknown` — проверить потом, `never` — значения нет.
- Сужение: `typeof`, `instanceof`, `in`, дискриминант, `x is T`.
- `keyof T` — ключи, `T[K]` — тип значения, `typeof v` — тип из значения.
- `Partial`, `Pick`, `Omit`, `Record`, `ReturnType` — базовый набор утилит.
- `as const` + `typeof arr[number]` вместо `enum`.
- Типы, `as` и `private` исчезают при компиляции.
- Включайте `strict: true`.
