'use strict';

// Проверка банков вопросов: node scripts/validate.js

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const DIFFS = new Set(['easy', 'medium', 'hard']);
const TYPES = new Set(['single', 'multiple']);

let errors = 0;
const fail = (where, msg) => { errors++; console.error(`✗ ${where}: ${msg}`); };

const courses = JSON.parse(fs.readFileSync(path.join(DATA, 'courses.json'), 'utf8'));
const allIds = new Set();

for (const course of courses) {
  const topics = new Set();
  const perTopic = {};
  let total = 0;

  for (const file of course.files) {
    const full = path.join(DATA, file);
    if (!fs.existsSync(full)) { fail(file, 'файл не найден'); continue; }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      fail(file, 'невалидный JSON: ' + e.message);
      continue;
    }
    for (const t of data.topics || []) topics.add(t.id);

    for (const q of data.questions || []) {
      const where = `${file} ${q.id || '(без id)'}`;
      total++;
      if (!q.id) fail(where, 'нет id');
      else if (allIds.has(q.id)) fail(where, 'дублирующийся id');
      allIds.add(q.id);
      if (!topics.has(q.topic)) fail(where, `неизвестная тема "${q.topic}"`);
      if (!DIFFS.has(q.difficulty)) fail(where, `неверная сложность "${q.difficulty}"`);
      if (!TYPES.has(q.type)) fail(where, `неверный тип "${q.type}"`);
      if (!q.question || typeof q.question !== 'string') fail(where, 'нет текста вопроса');
      if (!Array.isArray(q.options) || q.options.length < 2) fail(where, 'меньше 2 вариантов');
      else if (new Set(q.options).size !== q.options.length) fail(where, 'повторяющиеся варианты');
      if (!Array.isArray(q.correct) || !q.correct.length) fail(where, 'нет правильных ответов');
      else {
        if (q.correct.some((i) => !Number.isInteger(i) || i < 0 || i >= q.options.length)) fail(where, 'индекс correct вне диапазона');
        if (new Set(q.correct).size !== q.correct.length) fail(where, 'повторяющиеся индексы correct');
        if (q.type === 'single' && q.correct.length !== 1) fail(where, 'single должен иметь ровно 1 правильный ответ');
        if (q.type === 'multiple' && q.correct.length < 2) fail(where, 'multiple должен иметь 2+ правильных ответа');
      }
      perTopic[q.topic] = (perTopic[q.topic] || 0) + 1;
    }
  }

  console.log(`${course.title}: ${total} вопросов`);
  for (const [t, n] of Object.entries(perTopic)) console.log(`  ${t}: ${n}`);
}

if (errors) {
  console.error(`\nНайдено ошибок: ${errors}`);
  process.exit(1);
}
console.log('\n✓ Все банки вопросов валидны');
