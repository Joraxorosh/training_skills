'use strict';

// Проверка банков вопросов и теории.
//   node scripts/validate.js                  — все курсы из courses.json; при успехе
//                                               пишет public/data/index.json (id вопросов
//                                               по курсам — главная страница грузит только его)
//   node scripts/validate.js data/x.json ...  — только указанные файлы вопросов

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const DIFFS = new Set(['easy', 'medium', 'hard']);
const TYPES = new Set(['single', 'multiple']);

let errors = 0;
let warnings = 0;
const fail = (where, msg) => { errors++; console.error(`✗ ${where}: ${msg}`); };
const warn = (where, msg) => { warnings++; console.warn(`! ${where}: ${msg}`); };

function readJson(full, label) {
  if (!fs.existsSync(full)) { fail(label, 'файл не найден'); return null; }
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    fail(label, 'невалидный JSON: ' + e.message);
    return null;
  }
}

function checkQuestion(q, where, topics) {
  if (!topics.has(q.topic)) fail(where, `неизвестная тема "${q.topic}"`);
  if (!DIFFS.has(q.difficulty)) fail(where, `неверная сложность "${q.difficulty}"`);
  if (!TYPES.has(q.type)) fail(where, `неверный тип "${q.type}"`);
  if (!q.question || typeof q.question !== 'string') fail(where, 'нет текста вопроса');
  if (q.code !== undefined && typeof q.code !== 'string') fail(where, 'code должен быть строкой');
  if (!q.explanation) warn(where, 'нет объяснения');
  if (!Array.isArray(q.options) || q.options.length < 2) fail(where, 'меньше 2 вариантов');
  else {
    if (q.options.some((o) => typeof o !== 'string' || !o.trim())) fail(where, 'пустой или нестроковый вариант');
    if (new Set(q.options).size !== q.options.length) fail(where, 'повторяющиеся варианты');
    if (q.options.length > 10) fail(where, 'больше 10 вариантов');
  }
  if (!Array.isArray(q.correct) || !q.correct.length) fail(where, 'нет правильных ответов');
  else {
    if (q.correct.some((i) => !Number.isInteger(i) || i < 0 || i >= (q.options || []).length)) fail(where, 'индекс correct вне диапазона');
    if (new Set(q.correct).size !== q.correct.length) fail(where, 'повторяющиеся индексы correct');
    if (q.type === 'single' && q.correct.length !== 1) fail(where, 'single должен иметь ровно 1 правильный ответ');
    if (q.type === 'multiple' && q.correct.length < 2) fail(where, 'multiple должен иметь 2+ правильных ответа');
  }
}

// Если правильный ответ почти всегда на одной позиции — без перемешивания это подсказка.
function checkAnswerPositions(label, questions) {
  const single = questions.filter((q) => q.type === 'single' && Array.isArray(q.correct));
  if (single.length < 12) return;
  const counts = {};
  for (const q of single) counts[q.correct[0]] = (counts[q.correct[0]] || 0) + 1;
  const max = Math.max(...Object.values(counts));
  if (max / single.length > 0.45) warn(label, `правильный ответ слишком часто на одной позиции: ${JSON.stringify(counts)}`);
}

// Правильный вариант заметно длиннее всех остальных — частая подсказка «выбери самый длинный».
const clearlyLongest = (q) => {
  const lens = q.options.map((o) => o.length);
  const sorted = [...lens].sort((a, b) => b - a);
  return lens[q.correct[0]] === sorted[0] && sorted[0] > 1.25 * sorted[1];
};

function checkLengthBias(label, questions) {
  const single = questions.filter((q) => q.type === 'single' && Array.isArray(q.options) && Array.isArray(q.correct));
  if (single.length < 12) return;
  const biased = single.filter(clearlyLongest);
  if (biased.length / single.length > 0.2) {
    warn(label, `в ${biased.length} из ${single.length} вопросов правильный вариант заметно длиннее остальных: ${
      biased.slice(0, 5).map((q) => q.id).join(', ')}${biased.length > 5 ? ', …' : ''}`);
  }
}

function checkFile(file, ctx) {
  const data = readJson(path.join(DATA, file), file);
  if (!data) return;
  const local = new Set((data.topics || []).map((t) => t.id));
  for (const t of data.topics || []) {
    if (!t.id || !t.title) fail(file, 'у темы нет id или title');
    ctx.topics.set(t.id, t.title);
  }
  const texts = new Set();
  for (const q of data.questions || []) {
    const where = `${file} ${q.id || '(без id)'}`;
    ctx.total++;
    if (!q.id) fail(where, 'нет id');
    else if (ctx.allIds.has(q.id)) fail(where, 'дублирующийся id');
    ctx.allIds.add(q.id);
    if (ctx.ids && q.id) ctx.ids.push(q.id);
    const norm = String(q.question).trim().toLowerCase() + '|' + (q.code || '');
    if (texts.has(norm)) warn(where, 'повторяющийся текст вопроса');
    texts.add(norm);
    checkQuestion(q, where, ctx.topics);
    ctx.perTopic[q.topic] = (ctx.perTopic[q.topic] || 0) + 1;
  }
  checkAnswerPositions(file, data.questions || []);
  checkLengthBias(file, data.questions || []);
}

const args = process.argv.slice(2);
const index = { version: 1, courses: {} };

if (args.length) {
  for (const arg of args) {
    const file = path.relative(DATA, path.resolve(arg));
    const ctx = { topics: new Map(), allIds: new Set(), perTopic: {}, total: 0 };
    checkFile(file, ctx);
    console.log(`${file}: ${ctx.total} вопросов`, ctx.perTopic);
  }
} else {
  const courses = readJson(path.join(DATA, 'courses.json'), 'courses.json') || [];
  const allIds = new Set();
  const seenCourses = new Set();
  for (const course of courses) {
    if (seenCourses.has(course.id)) fail('courses.json', `дублирующийся курс "${course.id}"`);
    seenCourses.add(course.id);
    for (const key of ['id', 'title', 'description', 'badge', 'color']) {
      if (!course[key]) fail(`courses.json ${course.id || '?'}`, `нет поля ${key}`);
    }
    if (!Array.isArray(course.files) || !course.files.length) {
      fail(`courses.json ${course.id || '?'}`, 'нет файлов вопросов (files)');
    }
    const ctx = { topics: new Map(), allIds, perTopic: {}, total: 0, ids: [] };
    for (const file of course.files || []) checkFile(file, ctx);
    index.courses[course.id] = { total: ctx.ids.length, ids: ctx.ids };

    let theory = 0;
    for (const [topic] of ctx.topics) {
      const md = path.join(DATA, 'theory', course.id, topic + '.md');
      if (fs.existsSync(md)) theory++;
      else warn(course.id, `нет теории для темы "${topic}" (${path.relative(DATA, md)})`);
    }

    console.log(`${course.title}: ${ctx.total} вопросов, ${ctx.topics.size} тем, теория ${theory}/${ctx.topics.size}`);
    for (const [t, n] of Object.entries(ctx.perTopic)) console.log(`  ${t}: ${n}`);
  }
}

if (!args.length && !errors) {
  fs.writeFileSync(path.join(DATA, 'index.json'), JSON.stringify(index) + '\n');
}

if (warnings) console.warn(`\nПредупреждений: ${warnings}`);
if (errors) {
  console.error(`Найдено ошибок: ${errors}`);
  process.exit(1);
}
console.log('\n✓ Проверка пройдена');
