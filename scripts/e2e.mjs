// Сквозной браузерный тест: npm run e2e
//
// Поднимает server.js на свободном порту, запускает Chrome в headless-режиме и
// проходит основные сценарии через Chrome DevTools Protocol. Зависимостей нет:
// нужен Node 22+ (встроенные fetch и WebSocket) и установленный Chrome/Chromium.
// Путь к браузеру можно задать переменной CHROME_PATH.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COURSES = JSON.parse(readFileSync(join(ROOT, 'public/data/courses.json'), 'utf8'));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) {
    console.error('Chrome не найден. Укажите путь в переменной CHROME_PATH.');
    process.exit(2);
  }
  return found;
}

/* ---------- Сервер ---------- */

const PORT = 4100 + Math.floor(Math.random() * 800);
// localhost, а не 127.0.0.1: приложение регистрирует service worker только на HTTPS или localhost
const BASE = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + 'healthz')).ok) return; } catch { /* ещё стартует */ }
    await sleep(100);
  }
  throw new Error('server.js не запустился');
}

/* ---------- Браузер и CDP ---------- */

const profile = mkdtempSync(join(tmpdir(), 'skilltrainer-e2e-'));
const chromeArgs = [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=420,900', 'about:blank',
];
if (process.platform === 'linux') chromeArgs.unshift('--no-sandbox'); // в CI-контейнерах песочница недоступна
const chrome = spawn(findChrome(), chromeArgs, { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();
const jsErrors = [];
let expectNetworkErrors = false; // в сценариях со сбоем сети ошибки загрузки ожидаемы

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result.value;
}

async function waitFor(expression, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ev(`!!(${expression})`)) return true;
    await sleep(50);
  }
  return false;
}

async function nav(hash) {
  await ev(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(100);
}

async function press(key, code) {
  const text = key === 'Enter' ? '\r' : key;
  const vk = key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  await sleep(50);
}

async function connect() {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome не открыл порт отладки');
  const [port] = readFileSync(portFile, 'utf8').split('\n');
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { await sleep(100); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result || {});
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      jsErrors.push(d.exception?.description || d.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      jsErrors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const e = msg.params.entry;
      const isNetwork = e.source === 'network' || /Failed to load resource/.test(e.text);
      if (!(isNetwork && expectNetworkErrors)) jsErrors.push(`${e.text} ${e.url || ''}`.trim());
    }
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Network.enable');
}

/* ---------- Сценарии ---------- */

const results = [];
async function step(name, fn) {
  try {
    const res = await fn();
    const ok = res === true || (res && res.ok);
    results.push({ name, ok, note: res && res.note });
  } catch (err) {
    results.push({ name, ok: false, note: err.message.split('\n')[0] });
  }
}

const requested = [];

async function scenarios() {
  const firstCourse = COURSES[0];
  const quizCourse = COURSES.find((c) => c.id === 'go') || firstCourse;

  await step('главная: все курсы по категориям', async () => {
    await send('Page.navigate', { url: BASE });
    const ok = await waitFor(`document.querySelectorAll('.course-card').length === ${COURSES.length}`);
    return { ok: ok && (await ev(`document.querySelectorAll('h2.section').length`)) >= 2 };
  });

  await step('ленивая загрузка: на главной вопросы не скачиваются', async () => {
    const files = requested.filter((u) => /\/data\/[a-z]+-\d+\.json/.test(u));
    return { ok: files.length === 0, note: files.join(', ') };
  });

  await step('курс открывается, старт на 10 вопросов', async () => {
    await nav(`#/course/${quizCourse.id}`);
    if (!(await waitFor(`document.querySelector('[data-action="start"]')`))) return false;
    await ev(`document.querySelector('[data-action="set"][data-key="count"][data-value="10"]').click()`);
    await ev(`document.querySelector('[data-action="start"]').click()`);
    return waitFor(`location.hash === '#/quiz' && /из 10/.test(document.querySelector('.count').textContent)`);
  });

  await step('выбор варианта мышью без перерисовки вопроса', async () => {
    const before = await ev(`document.querySelector('.question').textContent`);
    await ev(`document.querySelectorAll('.option')[0].click()`);
    const ok = await ev(`(() => {
      const b = document.querySelectorAll('.option')[0];
      return b.classList.contains('selected') && b.getAttribute('aria-pressed') === 'true'
        && !document.querySelector('[data-action="submit"]').disabled;
    })()`);
    return ok && (await ev(`document.querySelector('.question').textContent`)) === before;
  });

  await step('ответ → разбор и ссылка на теорию → следующий вопрос', async () => {
    await ev(`document.querySelector('[data-action="submit"]').click()`);
    if (!(await waitFor(`document.querySelector('.feedback .theory-link')`))) return false;
    await ev(`document.querySelector('[data-action="next"]').click()`);
    return waitFor(`/Вопрос 2 из/.test(document.querySelector('.count').textContent)`);
  });

  await step('клавиатура: цифра выбирает, Enter отвечает и листает', async () => {
    await ev(`document.activeElement && document.activeElement.blur()`);
    await press('1', 'Digit1');
    await press('Enter', 'Enter');
    if (!(await waitFor(`document.querySelector('.feedback')`, 1500))) return false;
    await press('Enter', 'Enter');
    return waitFor(`/Вопрос 3 из/.test(document.querySelector('.count').textContent)`, 1500);
  });

  await step('русская раскладка: «ф» (KeyA) выбирает вариант A', async () => {
    await ev(`document.activeElement && document.activeElement.blur()`);
    await press('ф', 'KeyA');
    return ev(`document.querySelectorAll('.option')[0].classList.contains('selected')`);
  });

  await step('перезагрузка посреди теста → тест продолжается', async () => {
    await send('Page.reload');
    return waitFor(`/Вопрос 3 из/.test((document.querySelector('.count') || {}).textContent || '')`);
  });

  await step('тест доходит до результатов, статистика сохраняется', async () => {
    for (let i = 3; i <= 10; i++) {
      await ev(`document.activeElement && document.activeElement.blur()`);
      await press('2', 'Digit2');
      await press('Enter', 'Enter');
      await waitFor(`document.querySelector('.feedback')`, 1500);
      await press('Enter', 'Enter');
    }
    if (!(await waitFor(`location.hash === '#/result' && document.querySelector('.result-hero')`))) return false;
    const hero = await ev(`document.querySelector('.result-hero p').textContent`);
    const reviews = await ev(`document.querySelectorAll('details.review').length`);
    const stats = await ev(`Object.keys(JSON.parse(localStorage.getItem('skilltrainer:v1')).stats).length`);
    const session = await ev(`localStorage.getItem('skilltrainer:session:v1')`);
    return { ok: /из 10 верно · \d+ (сек|мин)/.test(hero) && reviews === 10 && stats === 10 && session === null, note: hero };
  });

  await step('главная показывает прогресс по пройденному курсу', async () => {
    await nav('#/');
    await waitFor(`document.querySelector('.course-card')`);
    const meta = await ev(`[...document.querySelectorAll('.course-card')]
      .find((c) => c.getAttribute('href') === '#/course/${quizCourse.id}').querySelector('.meta').textContent`);
    return { ok: /Точность/.test(meta), note: meta.replace(/\s+/g, ' ').trim() };
  });

  await step('теория: статья с оглавлением, тест по теме', async () => {
    const course = COURSES.find((c) => c.id === 'sql') || firstCourse;
    await nav(`#/theory/${course.id}`);
    if (!(await waitFor(`document.querySelector('.theory-row')`))) return false;
    await ev(`document.querySelector('.theory-row').click()`);
    if (!(await waitFor(`document.querySelectorAll('.article h2').length > 2`))) return false;
    await ev(`document.querySelector('[data-action="train-topic"]').click()`);
    const ok = await waitFor(`location.hash === '#/quiz' && document.querySelector('.option')`);
    await ev(`window.confirm = () => true; document.querySelector('[data-action="quit"]').click()`);
    return ok;
  });

  await step('импорт прогресса: валидный файл, мусор, __proto__, битый JSON', async () => {
    await nav('#/');
    await waitFor(`document.querySelector('.course-card')`);
    const r = await ev(`(async () => {
      const file = (body) => new File([body], 'p.json', { type: 'application/json' });
      const count = () => Object.keys(JSON.parse(localStorage.getItem('skilltrainer:v1')).stats).length;
      const before = count();
      importProgress(file(JSON.stringify({ app: 'skilltrainer', data: {
        stats: {
          'e2e-valid-001': { seen: 3, correct: 2, last: true, ts: Date.now() },
          '__proto__': { seen: 1, correct: 1, last: true, ts: 1 },
          'e2e-bad-001': { seen: 'x', correct: 1 },
        },
        history: [], settings: { '__proto__': { polluted: 1 } },
      } })));
      await new Promise((r) => setTimeout(r, 200));
      const added = count() - before;
      const stored = JSON.parse(localStorage.getItem('skilltrainer:v1')).stats;
      importProgress(file('not json'));
      await new Promise((r) => setTimeout(r, 200));
      return { added, bad: 'e2e-bad-001' in stored, polluted: ({}).polluted, toast: document.getElementById('toast').textContent };
    })()`);
    return { ok: r.added === 1 && !r.bad && r.polluted === undefined && /не файл прогресса/.test(r.toast), note: JSON.stringify(r) };
  });

  await step('испорченный localStorage не ломает запуск', async () => {
    await ev(`localStorage.setItem('skilltrainer:v1', '{"stats":[1],"settings":"x","history":{}}');
              localStorage.setItem('skilltrainer:session:v1', '{"courseId":"${quizCourse.id}","items":"oops"}')`);
    await send('Page.reload');
    return waitFor(`document.querySelectorAll('.course-card').length === ${COURSES.length}`);
  });

  await step('несуществующие курс и тема ведут на понятные страницы', async () => {
    await nav('#/course/__nope__');
    if (!(await waitFor(`document.querySelector('.course-card')`))) return false;
    await nav(`#/theory/${firstCourse.id}/__nope__`);
    return waitFor(`document.querySelector('.theory-row')`);
  });

  await step('сбой загрузки курса → «Повторить» → курс загружается', async () => {
    // нужен курс, который ещё не загружался в этой вкладке
    const course = COURSES.find((c) => !c.files.some((f) => requested.some((u) => u.endsWith('/' + f))));
    if (!course) return { ok: false, note: 'все курсы уже загружены — нечего проверять' };
    expectNetworkErrors = true;
    // Блокировка URL в CDP не действует на запросы service worker — идём в обход него.
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setBlockedURLs', { urls: course.files.map((f) => '*' + f) });
    await nav(`#/course/${course.id}`);
    const shown = await waitFor(`document.querySelector('[data-action="retry-route"]')`);
    await send('Network.setBlockedURLs', { urls: [] });
    await send('Network.setBypassServiceWorker', { bypass: false });
    expectNetworkErrors = false;
    if (!shown) return false;
    await ev(`document.querySelector('[data-action="retry-route"]').click()`);
    return waitFor(`document.querySelector('[data-action="start"]')`);
  });

  // Офлайн проверяем по-настоящему: останавливаем сервер. Эмуляция сети в CDP
  // не действует на сам service worker, поэтому она здесь не годится.
  await step('офлайн: открытые курсы и статьи работают, новые — «Повторить»', async () => {
    if (!(await waitFor(`navigator.serviceWorker && navigator.serviceWorker.controller`, 10000))) {
      return { ok: false, note: 'service worker не активировался' };
    }
    const theoryCourse = COURSES.find((c) => c.id === 'sql') || firstCourse;
    const unseen = COURSES.find((c) => ![quizCourse.id, theoryCourse.id].includes(c.id) && !c.files.some((f) => requested.some((u) => u.endsWith(f))));
    await nav(`#/course/${quizCourse.id}`);
    await waitFor(`document.querySelector('[data-action="start"]')`);
    await sleep(300);
    expectNetworkErrors = true;
    server.kill();
    await sleep(300);
    await send('Page.reload');
    const checks = {
      home: (await nav('#/'), await waitFor(`document.querySelectorAll('.course-card').length === ${COURSES.length}`)),
      course: (await nav(`#/course/${quizCourse.id}`), await waitFor(`document.querySelector('[data-action="start"]')`)),
      unseen: !unseen || (await nav(`#/course/${unseen.id}`), await waitFor(`document.querySelector('[data-action="retry-route"]')`)),
    };
    return { ok: Object.values(checks).every(Boolean), note: JSON.stringify(checks) };
  });

  await step('нет ошибок JavaScript в консоли', async () => ({
    ok: jsErrors.length === 0,
    note: jsErrors.slice(0, 3).join(' | '),
  }));
}

/* ---------- Запуск ---------- */

let exitCode = 1;
try {
  await waitForServer();
  await connect();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === 'Network.requestWillBeSent') requested.push(msg.params.request.url);
  });
  await scenarios();
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.note && !r.ok ? `\n    ${r.note}` : ''}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} сценариев пройдено`);
  exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.error('E2E не запустился:', err.message);
} finally {
  try { ws && ws.close(); } catch { /* уже закрыт */ }
  chrome.kill();
  server.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows может держать файлы профиля */ }
  process.exit(exitCode);
}
