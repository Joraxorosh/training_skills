'use strict';

/* ================= Storage ================= */

const STORE_KEY = 'skilltrainer:v1';
const SESSION_KEY = 'skilltrainer:session:v1';
const THEME_KEY = 'skilltrainer:theme';

const DEFAULT_SETTINGS = {
  mode: 'mix',          // mix | topics | mistakes | new
  topics: null,         // выбранные темы для режима topics (null = все)
  count: 20,            // 0 = все
  difficulty: 'all',    // all | easy | medium | hard
  instant: true,        // показывать ответ сразу (тренировка) / в конце (экзамен)
  shuffleOptions: true,
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* приватный режим / переполнение — работаем без сохранения */ }
}

// db.stats[questionId] = { seen, correct, last: boolean, ts }
const db = Object.assign({ stats: {}, settings: {}, history: [] }, readJSON(STORE_KEY, {}));
const saveDb = () => writeJSON(STORE_KEY, db);

function courseSettings(courseId) {
  const s = Object.assign({}, DEFAULT_SETTINGS, db.settings[courseId]);
  if (!Array.isArray(s.topics)) s.topics = state.data[courseId].topics.map((t) => t.id);
  return s;
}

function saveCourseSettings(courseId, settings) {
  db.settings[courseId] = settings;
  saveDb();
}

/* ================= Data ================= */

const state = {
  courses: [],
  data: {},      // courseId -> { topics, questions, byId, topicTitle }
  quiz: null,    // текущая сессия
  selected: new Set(),
};

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function loadCourse(course) {
  const parts = await Promise.all(
    course.files.map((f) => fetchJSON('data/' + f).catch((err) => {
      console.warn('Не удалось загрузить', f, err);
      return { topics: [], questions: [] };
    }))
  );
  const topics = [];
  const questions = [];
  const seenTopics = new Set();
  for (const p of parts) {
    for (const t of p.topics || []) {
      if (!seenTopics.has(t.id)) { seenTopics.add(t.id); topics.push(t); }
    }
    questions.push(...(p.questions || []));
  }
  const byId = new Map(questions.map((q) => [q.id, q]));
  const topicTitle = Object.fromEntries(topics.map((t) => [t.id, t.title]));
  state.data[course.id] = { topics, questions, byId, topicTitle };
}

// Вопросы курса грузятся при первом входе в него. Для главной хватает index.json
// (его генерирует scripts/validate.js): там id вопросов каждого курса.
const courseLoads = new Map();
function ensureCourse(courseId) {
  if (state.data[courseId]) return Promise.resolve();
  if (!courseLoads.has(courseId)) {
    courseLoads.set(courseId, loadCourse(state.courses.find((c) => c.id === courseId)));
  }
  return courseLoads.get(courseId);
}

const hasCourse = (id) => state.courses.some((c) => c.id === id);

async function init() {
  try {
    state.courses = await fetchJSON('data/courses.json');
    state.index = await fetchJSON('data/index.json').catch(() => null);
    const complete = state.index && state.index.courses && state.courses.every((c) => state.index.courses[c.id]);
    if (!complete) { // индекса нет или он устарел — грузим всё сразу
      state.index = null;
      await Promise.all(state.courses.map((c) => ensureCourse(c.id)));
    }
    const saved = readJSON(SESSION_KEY, null);
    if (saved && hasCourse(saved.courseId)) {
      await ensureCourse(saved.courseId);
      state.quiz = saved;
    }
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="empty">Не удалось загрузить данные.<br>${esc(err.message)}</div>`;
    return;
  }
  route();
}

/* ================= Helpers ================= */

const app = document.getElementById('app');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Экранирование + поддержка `inline code`
function rich(s) {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

// Вариант ответа: многострочный (обычно SQL-запрос) показываем как код
function optionHtml(text) {
  return String(text).includes('\n')
    ? `<span class="txt code-opt">${esc(text)}</span>`
    : `<span class="txt">${rich(text)}</span>`;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function go(path) {
  if (location.hash === '#' + path) route();
  else location.hash = path;
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

const CATEGORIES = [
  ['infra', 'Инфраструктура и архитектура'],
  ['data', 'Данные и AI'],
  ['lang', 'Языки программирования'],
  ['cs', 'Computer Science и практики'],
  ['other', 'Другое'],
];

const DIFF_LABEL = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' };
const LETTERS = 'ABCDEFGHIJ';

const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};

function courseStats(courseId) {
  const ids = state.data[courseId]
    ? state.data[courseId].questions.map((q) => q.id)
    : state.index.courses[courseId].ids;
  let seen = 0, correctLast = 0, mistakes = 0, attempts = 0, correct = 0;
  for (const id of ids) {
    const s = db.stats[id];
    if (!s) continue;
    seen++;
    attempts += s.seen;
    correct += s.correct;
    if (s.last) correctLast++; else mistakes++;
  }
  return { total: ids.length, seen, correctLast, mistakes, accuracy: pct(correct, attempts), unseen: ids.length - seen };
}

function topicStats(courseId, topicId) {
  const qs = state.data[courseId].questions.filter((q) => q.topic === topicId);
  let seen = 0, ok = 0;
  for (const q of qs) {
    const s = db.stats[q.id];
    if (s) { seen++; if (s.last) ok++; }
  }
  return { total: qs.length, seen, ok };
}

function toggleTheme() {
  const root = document.documentElement;
  const isDark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = isDark ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch { /* ignore */ }
}

/* ================= Router ================= */

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  window.scrollTo(0, 0);
  if ((parts[0] === 'course' || parts[0] === 'theory') && hasCourse(parts[1]) && !state.data[parts[1]]) {
    app.innerHTML = '<div class="loading">Загрузка курса…</div>';
    const key = location.hash;
    ensureCourse(parts[1]).then(() => { if (location.hash === key) route(); });
    return;
  }
  if (parts[0] === 'course' && state.data[parts[1]]) return renderCourse(parts[1]);
  if (parts[0] === 'theory' && state.data[parts[1]]) {
    const topic = parts[2] && decodeURIComponent(parts[2]);
    if (topic && state.data[parts[1]].topicTitle[topic]) return renderArticle(parts[1], topic);
    return renderTheoryList(parts[1]);
  }
  if (parts[0] === 'quiz') {
    if (state.quiz && !state.quiz.finished) return renderQuestion();
    if (state.quiz && state.quiz.finished) return go('/result');
    return go('/');
  }
  if (parts[0] === 'result') {
    if (state.quiz && state.quiz.finished) return renderResult();
    return go('/');
  }
  renderHome();
}

window.addEventListener('hashchange', route);

/* ================= Home ================= */

function renderHome() {
  const q = state.quiz;
  const resume = q && !q.finished
    ? `<div class="banner">
        <div class="grow"><strong>Незавершённый тест</strong>${esc(q.courseTitle)} · вопрос ${q.index + 1} из ${q.items.length}</div>
        <button class="btn small primary" data-action="resume">Продолжить</button>
      </div>`
    : '';

  const card = (c) => {
    const s = courseStats(c.id);
    return `<a class="card course-card" href="#/course/${esc(c.id)}">
      <div class="badge${String(c.badge).length > 4 ? ' long' : ''}" style="background:${esc(c.color)}">${esc(c.badge)}</div>
      <div>
        <h3>${esc(c.title)}</h3>
        <p>${esc(c.description)}</p>
        <div class="bar ok"><span style="width:${pct(s.correctLast, s.total)}%"></span></div>
        <div class="meta">
          <span>${s.total} ${plural(s.total, 'вопрос', 'вопроса', 'вопросов')}</span>
          <span>Освоено ${pct(s.correctLast, s.total)}%</span>
          ${s.seen ? `<span>Точность ${s.accuracy}%</span>` : ''}
        </div>
      </div>
    </a>`;
  };
  const groups = CATEGORIES.map(([id, title]) => [title, state.courses.filter((c) => (c.category || 'other') === id)])
    .filter(([, list]) => list.length);
  const cards = groups.map(([title, list]) => `
    <h2 class="section">${esc(title)}</h2>
    <div class="stack">${list.map(card).join('')}</div>`).join('');

  app.innerHTML = `
    <header class="topbar">
      <h1>Тренажёр скиллов</h1>
      <button class="icon-btn" data-action="theme" aria-label="Сменить тему">${ICONS.theme}</button>
    </header>
    <p class="lead">Выберите курс: в каждом есть тесты и теория по темам.</p>
    ${resume}
    ${cards}

    <h2 class="section">Прогресс</h2>
    <div class="card transfer">
      <p>Прогресс хранится в этом браузере. Чтобы перенести его на другое устройство (например, с компьютера на телефон), сохраните файл здесь и загрузите его там. Данные объединяются, ничего не теряется.</p>
      <div class="transfer-actions">
        <button class="btn small" data-action="export">Сохранить в файл</button>
        <label class="btn small">Загрузить из файла<input type="file" accept="application/json,.json" data-action="import" hidden></label>
      </div>
    </div>
  `;
}

/* ================= Progress transfer ================= */

function exportProgress() {
  const payload = { app: 'skilltrainer', version: 1, exportedAt: new Date().toISOString(), data: db };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'skilltrainer-progress-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Файл с прогрессом сохранён');
}

// Объединение: по каждому вопросу берём более свежую запись, историю склеиваем.
function importProgress(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let incoming;
    try {
      const parsed = JSON.parse(reader.result);
      incoming = parsed && parsed.app === 'skilltrainer' ? parsed.data : null;
    } catch { incoming = null; }
    if (!incoming || !incoming.stats || typeof incoming.stats !== 'object') { toast('Это не файл прогресса тренажёра'); return; }
    let added = 0;
    for (const [id, st] of Object.entries(incoming.stats)) {
      if (!st || typeof st !== 'object') continue;
      const cur = db.stats[id];
      if (!cur || (st.ts || 0) > (cur.ts || 0)) { db.stats[id] = st; added++; }
    }
    const seen = new Set(db.history.map((h) => h.courseId + ':' + h.ts));
    for (const h of Array.isArray(incoming.history) ? incoming.history : []) {
      if (h && !seen.has(h.courseId + ':' + h.ts)) db.history.push(h);
    }
    db.history.sort((a, b) => b.ts - a.ts);
    db.history = db.history.slice(0, 50);
    db.settings = Object.assign({}, incoming.settings, db.settings);
    saveDb();
    route();
    toast(`Прогресс загружен: обновлено ${added} ${plural(added, 'вопрос', 'вопроса', 'вопросов')}`);
  };
  reader.onerror = () => toast('Не удалось прочитать файл');
  reader.readAsText(file);
}

/* ================= Course ================= */

function buildPool(courseId, settings) {
  const { questions } = state.data[courseId];
  let pool = questions;
  if (settings.mode === 'topics') {
    const set = new Set(settings.topics);
    pool = pool.filter((q) => set.has(q.topic));
  } else if (settings.mode === 'mistakes') {
    pool = pool.filter((q) => db.stats[q.id] && db.stats[q.id].last === false);
  } else if (settings.mode === 'new') {
    pool = pool.filter((q) => !db.stats[q.id]);
  }
  if (settings.difficulty !== 'all') pool = pool.filter((q) => q.difficulty === settings.difficulty);
  return pool;
}

function renderCourse(courseId) {
  const course = state.courses.find((c) => c.id === courseId);
  const data = state.data[courseId];
  const st = courseStats(courseId);
  const s = courseSettings(courseId);

  const pool = buildPool(courseId, s);
  const willAsk = s.count ? Math.min(s.count, pool.length) : pool.length;

  const mode = (id, title, sub, disabled) => `
    <button class="mode" data-action="mode" data-value="${id}" aria-pressed="${s.mode === id}" ${disabled ? 'disabled' : ''}>
      <b>${title}</b><span>${sub}</span>
    </button>`;

  const seg = (key, options) => `<div class="seg" role="group">${options.map(([v, label]) =>
    `<button data-action="set" data-key="${key}" data-value="${v}" aria-pressed="${String(s[key]) === String(v)}">${label}</button>`
  ).join('')}</div>`;

  const topicsHtml = s.mode === 'topics' ? `
    <h2 class="section">Темы</h2>
    <div class="card topics" style="padding:0">
      <div class="topic-actions">
        <button class="link-btn" data-action="topics-all">Выбрать все</button>
        <button class="link-btn" data-action="topics-none">Снять все</button>
      </div>
      ${data.topics.map((t) => {
        const ts = topicStats(courseId, t.id);
        return `<label class="topic">
          <input type="checkbox" data-action="topic" value="${esc(t.id)}" ${s.topics.includes(t.id) ? 'checked' : ''}>
          <div class="grow">
            <div class="name">${esc(t.title)}</div>
            <div class="sub">${ts.total} ${plural(ts.total, 'вопрос', 'вопроса', 'вопросов')} · освоено ${ts.ok}</div>
            <div class="bar ok"><span style="width:${pct(ts.ok, ts.total)}%"></span></div>
          </div>
        </label>`;
      }).join('')}
    </div>` : '';

  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="Назад">${ICONS.back}</a>
      <div class="title">${esc(course.title)}</div>
      <button class="icon-btn" data-action="theme" aria-label="Сменить тему">${ICONS.theme}</button>
    </header>
    ${courseTabs(courseId, 'train')}

    <div class="stats">
      <div class="stat"><b>${st.total}</b><span>вопросов</span></div>
      <div class="stat"><b>${st.seen}</b><span>пройдено</span></div>
      <div class="stat"><b>${st.seen ? st.accuracy + '%' : '—'}</b><span>точность</span></div>
      <div class="stat"><b>${st.mistakes}</b><span>ошибок</span></div>
    </div>

    <h2 class="section">Режим</h2>
    <div class="modes">
      ${mode('mix', 'Вперемешку', 'Все темы в случайном порядке')}
      ${mode('topics', 'По темам', 'Выберите одну или несколько тем')}
      ${mode('mistakes', 'Работа над ошибками', st.mistakes ? `${st.mistakes} ${plural(st.mistakes, 'вопрос', 'вопроса', 'вопросов')} с ошибкой` : 'Ошибок пока нет', !st.mistakes)}
      ${mode('new', 'Новые вопросы', st.unseen ? `${st.unseen} ещё не встречались` : 'Все вопросы пройдены', !st.unseen)}
    </div>

    ${topicsHtml}

    <h2 class="section">Настройки</h2>
    <div class="card" style="padding:0">
      <div class="setting">
        <span class="label">Количество вопросов</span>
        ${seg('count', [[10, '10'], [20, '20'], [30, '30'], [0, 'Все']])}
      </div>
      <div class="setting">
        <span class="label">Сложность</span>
        ${seg('difficulty', [['all', 'Любая'], ['easy', 'Лёгкая'], ['medium', 'Средняя'], ['hard', 'Сложная']])}
      </div>
      <div class="setting">
        <label class="switch-row">
          <span class="grow">Показывать ответ сразу<br><span class="sub">Выключите для режима экзамена — результаты в конце</span></span>
          <input type="checkbox" class="switch" data-action="toggle" data-key="instant" ${s.instant ? 'checked' : ''}>
        </label>
      </div>
      <div class="setting">
        <label class="switch-row">
          <span class="grow">Перемешивать варианты ответов</span>
          <input type="checkbox" class="switch" data-action="toggle" data-key="shuffleOptions" ${s.shuffleOptions ? 'checked' : ''}>
        </label>
      </div>
    </div>

    <div style="margin-top:16px">
      <button class="link-btn danger" data-action="reset-course">Сбросить прогресс курса</button>
    </div>

    <div class="actionbar">
      <div class="inner">
        <button class="btn primary" data-action="start" ${willAsk ? '' : 'disabled'}>
          ${willAsk ? `Начать · ${willAsk} ${plural(willAsk, 'вопрос', 'вопроса', 'вопросов')}` : s.mode === 'topics' && !s.topics.length ? 'Выберите хотя бы одну тему' : 'Нет вопросов под фильтры'}
        </button>
      </div>
    </div>
  `;
  app.dataset.course = courseId;
}

function updateSetting(courseId, patch) {
  const s = Object.assign(courseSettings(courseId), patch);
  saveCourseSettings(courseId, s);
  const y = window.scrollY;
  renderCourse(courseId);
  window.scrollTo(0, y);
}

/* ================= Theory ================= */

const theoryCache = new Map(); // "course/topic" -> markdown | null

function courseTabs(courseId, active) {
  const tab = (id, href, label) =>
    `<a class="tab" href="${href}" aria-current="${active === id ? 'page' : 'false'}">${label}</a>`;
  return `<nav class="tabs">
    ${tab('train', '#/course/' + esc(courseId), 'Тренировка')}
    ${tab('theory', '#/theory/' + esc(courseId), 'Теория')}
  </nav>`;
}

async function loadTheory(courseId, topicId) {
  const key = courseId + '/' + topicId;
  if (theoryCache.has(key)) return theoryCache.get(key);
  let text = null;
  try {
    const res = await fetch(`data/theory/${encodeURIComponent(courseId)}/${encodeURIComponent(topicId)}.md`, { cache: 'no-cache' });
    if (res.ok) text = await res.text();
  } catch { /* офлайн и нет в кэше */ }
  if (text !== null) theoryCache.set(key, text);
  return text;
}

// Инлайн-разметка: `код` и **жирный**. Внутри кода ничего не трогаем.
function mdInline(s) {
  const codes = [];
  const text = String(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${esc(codes[n])}</code>`);
}

// Небольшой Markdown: ##/###, абзацы, списки, ```код```, таблицы, > врезки.
function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const toc = [];
  let para = [];
  let list = null; // { tag, items: [] }

  const flushPara = () => {
    if (para.length) out.push(`<p>${mdInline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${mdInline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };
  // Ячейки таблицы: `|` внутри `кода` и экранированный `\|` не разделяют ячейки.
  const cells = (row) => {
    const body = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    const res = [];
    let cur = '';
    let inCode = false;
    for (let k = 0; k < body.length; k++) {
      const ch = body[k];
      if (ch === '\\' && body[k + 1] === '|') { cur += '|'; k++; continue; }
      if (ch === '`') inCode = !inCode;
      if (ch === '|' && !inCode) { res.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    res.push(cur.trim());
    return res;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (t.startsWith('```')) {
      flush();
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) code.push(lines[i]);
      out.push(`<pre class="code">${esc(code.join('\n'))}</pre>`);
      continue;
    }
    if (!t) { flush(); continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      flush();
      const level = Math.min(Math.max(h[1].length, 2), 3);
      if (level === 2) {
        const id = 'sec-' + toc.length;
        toc.push({ id, title: h[2].replace(/[`*]/g, '') });
        out.push(`<h2 id="${id}">${mdInline(h[2])}</h2>`);
      } else {
        out.push(`<h3>${mdInline(h[2])}</h3>`);
      }
      continue;
    }

    if (t.startsWith('>')) {
      flush();
      const quote = [];
      for (; i < lines.length && lines[i].trim().startsWith('>'); i++) quote.push(lines[i].trim().replace(/^>\s?/, ''));
      i--;
      const paras = quote.join('\n').split(/\n\s*\n/).map((p) => `<p>${mdInline(p.replace(/\n/g, ' '))}</p>`);
      out.push(`<blockquote class="callout">${paras.join('')}</blockquote>`);
      continue;
    }

    if (t.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      flush();
      const head = cells(t);
      const body = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) body.push(cells(lines[i]));
      i--;
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')
      }</tbody></table></div>`);
      continue;
    }

    const li = /^([-*]|\d+[.)])\s+(.*)$/.exec(t);
    if (li) {
      flushPara();
      const tag = /^\d/.test(li[1]) ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(li[2]);
      continue;
    }

    if (list && /^\s{2,}/.test(line)) { // продолжение пункта списка
      list.items[list.items.length - 1] += ' ' + t;
      continue;
    }
    flushList();
    para.push(t);
  }
  flush();
  return { html: out.join('\n'), toc };
}

function renderTheoryList(courseId) {
  const course = state.courses.find((c) => c.id === courseId);
  const data = state.data[courseId];
  app.dataset.course = courseId;

  const rows = data.topics.map((t, n) => {
    const ts = topicStats(courseId, t.id);
    return `<a class="theory-row" href="#/theory/${esc(courseId)}/${esc(t.id)}">
      <span class="num">${n + 1}</span>
      <div class="grow">
        <div class="name">${esc(t.title)}</div>
        <div class="sub">${ts.total} ${plural(ts.total, 'вопрос', 'вопроса', 'вопросов')} · освоено ${pct(ts.ok, ts.total)}%</div>
        <div class="bar ok"><span style="width:${pct(ts.ok, ts.total)}%"></span></div>
      </div>
      <span class="chev">›</span>
    </a>`;
  }).join('');

  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="Назад">${ICONS.back}</a>
      <div class="title">${esc(course.title)}</div>
      <button class="icon-btn" data-action="theme" aria-label="Сменить тему">${ICONS.theme}</button>
    </header>
    ${courseTabs(courseId, 'theory')}
    <p class="lead">Краткий конспект по каждой теме: ключевые понятия, примеры и частые вопросы с собеседований. После чтения закрепите тему тестом.</p>
    <div class="card" style="padding:0">${rows}</div>
  `;
}

async function renderArticle(courseId, topicId) {
  const course = state.courses.find((c) => c.id === courseId);
  const data = state.data[courseId];
  const idx = data.topics.findIndex((t) => t.id === topicId);
  const topic = data.topics[idx];
  const prev = data.topics[idx - 1];
  const next = data.topics[idx + 1];
  const ts = topicStats(courseId, topicId);
  app.dataset.course = courseId;
  const routeKey = location.hash;

  const shell = (body) => `
    <header class="topbar">
      <a class="icon-btn" href="#/theory/${esc(courseId)}" aria-label="К списку тем">${ICONS.back}</a>
      <div class="title">${esc(course.title)} · теория</div>
      <button class="icon-btn" data-action="theme" aria-label="Сменить тему">${ICONS.theme}</button>
    </header>
    <article class="article">
      <h1>${esc(topic.title)}</h1>
      ${body}
    </article>
    <nav class="pager">
      ${prev ? `<a class="btn small" href="#/theory/${esc(courseId)}/${esc(prev.id)}">‹ ${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a class="btn small" href="#/theory/${esc(courseId)}/${esc(next.id)}">${esc(next.title)} ›</a>` : ''}
    </nav>
    <div class="actionbar"><div class="inner">
      <button class="btn primary" data-action="train-topic" data-value="${esc(topicId)}" ${ts.total ? '' : 'disabled'}>
        ${ts.total ? 'Проверить себя по теме' : 'Вопросов по теме пока нет'}
      </button>
    </div></div>`;

  app.innerHTML = shell('<div class="loading">Загрузка…</div>');
  const text = await loadTheory(courseId, topicId);
  if (location.hash !== routeKey) return; // пользователь уже ушёл на другую страницу

  if (text === null) {
    app.innerHTML = shell('<div class="empty">Конспект по этой теме пока не написан или недоступен офлайн.</div>');
    return;
  }
  const { html, toc } = renderMarkdown(text);
  const tocHtml = toc.length > 2
    ? `<div class="toc">${toc.map((s) => `<button class="chip" data-action="toc" data-value="${s.id}">${esc(s.title)}</button>`).join('')}</div>`
    : '';
  app.innerHTML = shell(tocHtml + html);
}

/* ================= Quiz ================= */

function startQuiz(courseId, settings, fixedIds) {
  const course = state.courses.find((c) => c.id === courseId);
  const data = state.data[courseId];
  let pool;
  if (fixedIds) {
    pool = fixedIds.map((id) => data.byId.get(id)).filter(Boolean);
  } else {
    pool = buildPool(courseId, settings);
  }
  pool = shuffle(pool.slice());
  if (!fixedIds && settings.count) pool = pool.slice(0, settings.count);
  if (!pool.length) { toast('Нет вопросов под выбранные фильтры'); return; }

  state.quiz = {
    courseId,
    courseTitle: course.title,
    settings: Object.assign({}, settings),
    instant: settings.instant,
    items: pool.map((q) => {
      const order = q.options.map((_, i) => i);
      return { id: q.id, order: settings.shuffleOptions ? shuffle(order) : order };
    }),
    index: 0,
    answers: {},   // id -> { selected: [origIdx], ok }
    startedAt: Date.now(),
    finishedAt: null,
    finished: false,
  };
  state.selected = new Set();
  persistQuiz();
  go('/quiz');
}

function persistQuiz() {
  writeJSON(SESSION_KEY, state.quiz && !state.quiz.finished ? state.quiz : null);
}

function currentQuestion() {
  const qz = state.quiz;
  const item = qz.items[qz.index];
  return { item, q: state.data[qz.courseId].byId.get(item.id) };
}

function renderQuestion() {
  const qz = state.quiz;
  const { item, q } = currentQuestion();
  if (!q) { // вопрос удалили из банка — пропускаем
    qz.items.splice(qz.index, 1);
    if (qz.index >= qz.items.length) return finishQuiz();
    return renderQuestion();
  }
  const data = state.data[qz.courseId];
  const ans = qz.answers[item.id];
  const revealed = Boolean(ans) && qz.instant;
  const selected = ans ? new Set(ans.selected) : state.selected;
  const multi = q.type === 'multiple' || q.correct.length > 1;
  const correctSet = new Set(q.correct);
  const answeredCount = Object.keys(qz.answers).length;
  const okCount = Object.values(qz.answers).filter((a) => a.ok).length;
  const isLast = qz.index === qz.items.length - 1;

  const options = item.order.map((orig, pos) => {
    let cls = 'option' + (multi ? ' multi' : '');
    if (revealed) {
      if (correctSet.has(orig) && selected.has(orig)) cls += ' correct';
      else if (correctSet.has(orig)) cls += multi ? ' missed' : ' correct';
      else if (selected.has(orig)) cls += ' wrong';
    } else if (selected.has(orig)) {
      cls += ' selected';
    }
    return `<button class="${cls}" data-action="pick" data-value="${orig}" ${revealed ? 'disabled' : ''}>
      <span class="letter">${LETTERS[pos]}</span>${optionHtml(q.options[orig])}
    </button>`;
  }).join('');

  const feedback = revealed ? `
    <div class="feedback ${ans.ok ? 'ok' : 'bad'}">
      <div class="verdict">${ans.ok ? 'Верно!' : ans.skipped ? 'Правильный ответ' : 'Неверно'}</div>
      ${q.explanation ? `<p>${rich(q.explanation)}</p>` : ''}
      <a class="theory-link" href="#/theory/${esc(qz.courseId)}/${esc(q.topic)}">${ICONS.book}Теория по теме</a>
    </div>` : '';

  let actions;
  if (revealed) {
    actions = `<button class="btn primary" data-action="next">${isLast ? 'Результаты' : 'Далее'}</button>`;
  } else {
    actions = `
      <button class="btn secondary" data-action="skip">Не знаю</button>
      <button class="btn primary" data-action="submit" ${selected.size ? '' : 'disabled'}>Ответить</button>`;
  }

  app.innerHTML = `
    <header class="quiz-head">
      <button class="icon-btn" data-action="quit" aria-label="Выйти из теста">${ICONS.close}</button>
      <div class="count">Вопрос ${qz.index + 1} из ${qz.items.length}</div>
      ${qz.instant && answeredCount ? `<div class="score">${okCount}/${answeredCount} верно</div>` : ''}
    </header>
    <div class="progress"><span style="width:${pct(qz.index + (ans ? 1 : 0), qz.items.length)}%"></span></div>

    <div class="chips">
      <span class="chip">${esc(data.topicTitle[q.topic] || q.topic)}</span>
      ${q.difficulty ? `<span class="chip ${esc(q.difficulty)}">${DIFF_LABEL[q.difficulty] || esc(q.difficulty)}</span>` : ''}
    </div>
    <p class="question">${rich(q.question)}</p>
    ${multi && !revealed ? '<p class="multi-hint">Несколько правильных ответов</p>' : ''}
    ${q.code ? `<pre class="code">${esc(q.code)}</pre>` : ''}
    <div class="options">${options}</div>
    ${feedback}

    <div class="actionbar"><div class="inner">${actions}</div></div>
  `;

  if (revealed) {
    const fb = app.querySelector('.feedback');
    if (fb && fb.getBoundingClientRect().bottom > window.innerHeight - 90) {
      fb.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }
}

function pickOption(orig) {
  const { item, q } = currentQuestion();
  if (state.quiz.answers[item.id] && state.quiz.instant) return;
  const multi = q.type === 'multiple' || q.correct.length > 1;
  if (multi) {
    if (state.selected.has(orig)) state.selected.delete(orig);
    else state.selected.add(orig);
  } else {
    state.selected = new Set([orig]);
  }
  const y = window.scrollY;
  renderQuestion();
  window.scrollTo(0, y);
}

function submitAnswer(skipped) {
  const qz = state.quiz;
  const { item, q } = currentQuestion();
  if (qz.answers[item.id]) return;
  const selected = skipped ? [] : [...state.selected];
  if (!skipped && !selected.length) return;
  const correct = new Set(q.correct);
  const ok = !skipped && selected.length === correct.size && selected.every((i) => correct.has(i));
  qz.answers[item.id] = { selected, ok, skipped: Boolean(skipped) };

  const s = db.stats[q.id] || { seen: 0, correct: 0 };
  s.seen++;
  if (ok) s.correct++;
  s.last = ok;
  s.ts = Date.now();
  db.stats[q.id] = s;
  saveDb();

  if (qz.instant) {
    persistQuiz();
    const y = window.scrollY;
    renderQuestion();
    if (!app.querySelector('.feedback')) window.scrollTo(0, y);
  } else {
    nextQuestion();
  }
}

function nextQuestion() {
  const qz = state.quiz;
  state.selected = new Set();
  if (qz.index >= qz.items.length - 1) return finishQuiz();
  qz.index++;
  persistQuiz();
  window.scrollTo(0, 0);
  renderQuestion();
}

function finishQuiz() {
  const qz = state.quiz;
  qz.finished = true;
  qz.finishedAt = Date.now();
  const total = qz.items.length;
  const ok = Object.values(qz.answers).filter((a) => a.ok).length;
  db.history.unshift({ courseId: qz.courseId, ts: qz.finishedAt, total, ok });
  db.history = db.history.slice(0, 50);
  saveDb();
  persistQuiz();
  go('/result');
}

function quitQuiz() {
  const qz = state.quiz;
  const answered = Object.keys(qz.answers).length;
  if (answered && confirm('Завершить тест и посмотреть результаты по отвеченным вопросам?')) {
    qz.items = qz.items.filter((it) => qz.answers[it.id]);
    return finishQuiz();
  }
  if (!answered || confirm('Выйти без сохранения теста?')) {
    const courseId = qz.courseId;
    state.quiz = null;
    persistQuiz();
    go('/course/' + courseId);
  }
}

/* ================= Result ================= */

function renderResult() {
  const qz = state.quiz;
  const data = state.data[qz.courseId];
  const total = qz.items.length;
  const results = qz.items.map((it) => ({ it, q: data.byId.get(it.id), a: qz.answers[it.id] })).filter((r) => r.q);
  const ok = results.filter((r) => r.a && r.a.ok).length;
  const score = pct(ok, total);
  const mins = Math.max(1, Math.round((qz.finishedAt - qz.startedAt) / 60000));
  const wrong = results.filter((r) => !r.a || !r.a.ok);

  const verdict = score >= 90 ? 'Отлично!' : score >= 70 ? 'Хороший результат' : score >= 50 ? 'Неплохо, есть что подтянуть' : 'Стоит повторить материал';
  const color = score >= 70 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';

  const byTopic = {};
  for (const r of results) {
    const t = (byTopic[r.q.topic] ||= { total: 0, ok: 0 });
    t.total++;
    if (r.a && r.a.ok) t.ok++;
  }
  const breakdown = Object.entries(byTopic)
    .sort((a, b) => pct(a[1].ok, a[1].total) - pct(b[1].ok, b[1].total))
    .map(([topic, t]) => `<div class="row">
      <div class="row-head"><a href="#/theory/${esc(qz.courseId)}/${esc(topic)}">${esc(data.topicTitle[topic] || topic)}</a><span>${t.ok} из ${t.total}</span></div>
      <div class="bar ${pct(t.ok, t.total) >= 70 ? 'ok' : ''}"><span style="width:${pct(t.ok, t.total)}%"></span></div>
    </div>`).join('');

  const answerText = (q, idxs) => idxs.length
    ? idxs.map((i) => (q.options[i].includes('\n') ? `<pre class="code">${esc(q.options[i])}</pre>` : rich(q.options[i]))).join('; ')
    : '—';
  const review = results.map((r) => {
    const good = r.a && r.a.ok;
    return `<details class="review">
      <summary><span class="mark ${good ? 'ok' : 'bad'}">${good ? '✓' : '✗'}</span><span>${rich(r.q.question)}</span></summary>
      <div class="body">
        ${r.q.code ? `<pre class="code">${esc(r.q.code)}</pre>` : ''}
        ${good ? '' : `<p class="ans-bad">Ваш ответ: ${r.a && !r.a.skipped ? answerText(r.q, r.a.selected) : 'пропущен'}</p>`}
        <p class="ans-ok">Правильно: ${answerText(r.q, r.q.correct)}</p>
        ${r.q.explanation ? `<p>${rich(r.q.explanation)}</p>` : ''}
      </div>
    </details>`;
  }).join('');

  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/course/${esc(qz.courseId)}" aria-label="К курсу">${ICONS.back}</a>
      <div class="title">${esc(qz.courseTitle)} · результат</div>
    </header>

    <div class="card result-hero">
      <div class="ring" style="--p:${score};--c:${color}"><b>${score}%</b></div>
      <h2>${verdict}</h2>
      <p>${ok} из ${total} верно · ${mins} мин</p>
    </div>

    ${breakdown ? `<h2 class="section">По темам</h2><div class="card breakdown" style="padding:0">${breakdown}</div>` : ''}

    <div class="row-buttons">
      ${wrong.length ? `<button class="btn primary block" data-action="retry-wrong">Повторить ошибки (${wrong.length})</button>` : ''}
      <button class="btn block" data-action="again">Новый тест с теми же настройками</button>
      <a class="btn block" href="#/course/${esc(qz.courseId)}">К курсу</a>
    </div>

    <h2 class="section">Разбор вопросов</h2>
    <div class="card" style="padding:0">${review}</div>
  `;
}

/* ================= Events ================= */

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = el.dataset.action;
  const courseId = app.dataset.course;

  switch (action) {
    case 'theme': toggleTheme(); break;
    case 'resume': go('/quiz'); break;

    case 'mode': updateSetting(courseId, { mode: el.dataset.value }); break;
    case 'set': {
      const v = el.dataset.value;
      updateSetting(courseId, { [el.dataset.key]: el.dataset.key === 'count' ? Number(v) : v });
      break;
    }
    case 'topics-all':
      updateSetting(courseId, { topics: state.data[courseId].topics.map((t) => t.id) });
      break;
    case 'topics-none': updateSetting(courseId, { topics: [] }); break;
    case 'reset-course': {
      if (!confirm('Сбросить весь прогресс по этому курсу?')) break;
      for (const q of state.data[courseId].questions) delete db.stats[q.id];
      saveDb();
      updateSetting(courseId, {});
      toast('Прогресс сброшен');
      break;
    }
    case 'start': {
      const s = courseSettings(courseId);
      startQuiz(courseId, s);
      break;
    }

    case 'pick': pickOption(Number(el.dataset.value)); break;
    case 'submit': submitAnswer(false); break;
    case 'skip': submitAnswer(true); break;
    case 'next': nextQuestion(); break;
    case 'quit': quitQuiz(); break;

    case 'retry-wrong': {
      const qz = state.quiz;
      const ids = qz.items.filter((it) => !(qz.answers[it.id] && qz.answers[it.id].ok)).map((it) => it.id);
      startQuiz(qz.courseId, qz.settings, ids);
      break;
    }
    case 'again': startQuiz(state.quiz.courseId, state.quiz.settings); break;

    case 'export': exportProgress(); break;
    case 'train-topic': {
      const s = courseSettings(courseId);
      startQuiz(courseId, Object.assign({}, s, { mode: 'topics', topics: [el.dataset.value], difficulty: 'all' }));
      break;
    }
    case 'toc': {
      const target = document.getElementById(el.dataset.value);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
  }
});

app.addEventListener('change', (e) => {
  const el = e.target;
  const courseId = app.dataset.course;
  if (el.dataset.action === 'import') {
    if (el.files && el.files[0]) importProgress(el.files[0]);
    el.value = '';
  } else if (el.dataset.action === 'toggle') {
    updateSetting(courseId, { [el.dataset.key]: el.checked });
  } else if (el.dataset.action === 'topic') {
    const s = courseSettings(courseId);
    const all = state.data[courseId].topics.map((t) => t.id);
    const current = new Set(s.topics);
    if (el.checked) current.add(el.value); else current.delete(el.value);
    updateSetting(courseId, { topics: all.filter((t) => current.has(t)) });
  }
});

// Клавиатура: 1–9 / A–J — выбор варианта, Enter — ответить/далее
document.addEventListener('keydown', (e) => {
  if (!location.hash.startsWith('#/quiz') || !state.quiz || state.quiz.finished) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const { item } = currentQuestion();
  if (e.key === 'Enter') {
    e.preventDefault();
    const answered = state.quiz.answers[item.id];
    if (answered && state.quiz.instant) nextQuestion();
    else if (state.selected.size) submitAnswer(false);
    return;
  }
  let pos = -1;
  if (/^[1-9]$/.test(e.key)) pos = Number(e.key) - 1;
  else if (/^[a-j]$/i.test(e.key)) pos = LETTERS.indexOf(e.key.toUpperCase());
  if (pos >= 0 && pos < item.order.length) pickOption(item.order[pos]);
});

/* ================= PWA ================= */

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

init();
