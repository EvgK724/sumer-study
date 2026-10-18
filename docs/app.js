(() => {
  'use strict';

  const APP_ID = 'sumer-course-study';
  const STORAGE_KEY = 'sumer-course-study.v1';
  const DATA = window.SUMER_DATA || { course: {}, lessons: [], cities: [], timeline: [], figures: [], sources: [] };
  const lessons = Array.isArray(DATA.lessons) ? DATA.lessons : [];
  const cities = Array.isArray(DATA.cities) ? DATA.cities : [];
  const timeline = Array.isArray(DATA.timeline) ? DATA.timeline : [];
  const figures = Array.isArray(DATA.figures) ? DATA.figures : [];
  const sources = Array.isArray(DATA.sources) ? DATA.sources : [];
  const course = DATA.course || {};
  const lessonIds = new Set(lessons.map(l => l.id));
  const main = document.getElementById('main');
  const allRecall = lessons.flatMap(l => (Array.isArray(l.recall) ? l.recall : []).map((r, i) => ({ ...r, lessonId: l.id, lessonTitle: l.title, number: l.number, id: `${l.id}-${i}` })));
  let storageAvailable = true;
  let state = loadState();
  let worldTab = 'map';
  let cityId = cities[0]?.id || '';
  let timelineId = timeline[0]?.id || '';
  let figureId = figures[0]?.id || '';
  let figureFilter = 'all';
  let recallFilter = 'all';
  let recallIndex = 0;
  let recallRevealed = false;
  let toastTimer;
  let noteTimer;
  const videoStore = window.SUMER_VIDEO_STORE;
  const videoMetadata = new Map();
  const videoSaving = new Set();
  const videoErrors = new Map();
  const videoObjectUrls = new Set();
  let videoStoreReady = false;
  let videoStoreError = '';

  function videoCountText() {
    if (videoStoreError) return 'Офлайн-видео: хранилище сейчас недоступно';
    return videoStoreReady ? `Видео на устройстве: ${videoMetadata.size} из ${lessons.length}` : 'Видео на устройстве: проверяется…';
  }

  function sizeText(bytes) {
    return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ГБ` : `${(bytes / 1024 ** 2).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`;
  }

  function clearPlayers() {
    document.querySelectorAll('video[data-local-video]').forEach(player => { player.pause(); player.removeAttribute('src'); player.load(); });
    for (const url of videoObjectUrls) URL.revokeObjectURL(url);
    videoObjectUrls.clear();
  }

  function updateVideoPanel(id, force = false) {
    const panel = document.querySelector(`[data-video-panel="${id}"]`);
    const lesson = lessons.find(l => l.id === id);
    if (panel && lesson && (force || !panel.querySelector('iframe,video'))) {
      if (force) clearPlayers();
      panel.outerHTML = renderVideo(lesson);
    }
    document.querySelectorAll('[data-video-count]').forEach(el => { el.textContent = videoCountText(); });
  }

  async function refreshStoredVideos() {
    try {
      if (!videoStore) throw new Error('Модуль офлайн-видео не подключён.');
      const list = await videoStore.list();
      videoMetadata.clear();
      for (const item of list) if (lessonIds.has(item.id)) videoMetadata.set(item.id, item);
      videoStoreReady = true;
      videoStoreError = '';
    } catch (error) { videoStoreError = error.message || 'Не удалось открыть хранилище видео.'; }
    lessons.forEach(l => updateVideoPanel(l.id));
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }

  function paragraphs(value) {
    const items = Array.isArray(value) ? value : String(value || '').split(/\n\s*\n/);
    return items.filter(Boolean).map(t => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`).join('');
  }

  function freshState() {
    return { app: APP_ID, version: 1, learned: {}, notes: {}, lastLesson: null, updatedAt: null };
  }

  function checkedState(value) {
    if (!value || typeof value !== 'object' || value.app !== APP_ID || value.version !== 1) throw new Error('Это не резервная копия приложения «Шумер».');
    if (!value.notes || typeof value.notes !== 'object' || Array.isArray(value.notes) || !value.learned || typeof value.learned !== 'object' || Array.isArray(value.learned)) throw new Error('В файле нет корректных заметок и отметок.');
    const result = freshState();
    for (const [id, text] of Object.entries(value.notes)) {
      if (!lessonIds.has(id) || typeof text !== 'string' || text.length > 50000) throw new Error('Формат заметок в файле не подходит этому курсу.');
      result.notes[id] = text;
    }
    for (const [id, learned] of Object.entries(value.learned)) {
      if (!lessonIds.has(id) || typeof learned !== 'boolean') throw new Error('Формат отметок в файле не подходит этому курсу.');
      result.learned[id] = learned;
    }
    result.lastLesson = lessonIds.has(value.lastLesson) ? value.lastLesson : null;
    result.updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null;
    return result;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? checkedState(JSON.parse(raw)) : freshState();
    } catch {
      storageAvailable = false;
      return freshState();
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageAvailable = true;
      return true;
    } catch {
      storageAvailable = false;
      toast('Браузер не смог сохранить данные. Выгрузите резервную копию в разделе «Заметки».');
      return false;
    }
  }

  function toast(message) {
    const el = document.getElementById('toast');
    clearTimeout(toastTimer);
    el.textContent = message;
    el.hidden = false;
    toastTimer = setTimeout(() => { el.hidden = true; }, 6500);
  }

  function route() {
    const value = location.hash.slice(1) || 'course';
    if (value.startsWith('lesson/')) {
      const id = value.slice(7);
      if (lessonIds.has(id)) return { page: 'lesson', id };
    }
    return { page: ['course', 'world', 'recall', 'notes'].includes(value) ? value : 'course' };
  }

  function lessonLink(id, text, classes = 'text-link') {
    return lessonIds.has(id) ? `<a class="${classes}" href="#lesson/${esc(id)}">${esc(text)}</a>` : '';
  }

  function externalLink(url, label, classes = '') {
    const safe = safeUrl(url);
    return safe ? `<a class="${classes}" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)} <span aria-hidden="true">↗</span></a>` : '';
  }

  function renderSources(ids) {
    const list = ids?.length ? sources.filter(s => ids.includes(s.id)) : sources;
    if (!list.length && !course.sourceNote) return '';
    return `<details class="source-details"><summary>Материалы и границы конспекта</summary><div>${course.sourceNote ? `<div class="source-note">${paragraphs(course.sourceNote)}</div>` : ''}${list.length ? `<ul class="sources-list">${list.map(s => `<li>${safeUrl(s.url) ? externalLink(s.url, s.title) : esc(s.title)}${s.note ? `<small>${esc(s.note)}</small>` : ''}</li>`).join('')}</ul>` : ''}</div></details>`;
  }

  function renderCourse() {
    const completed = lessons.filter(l => state.learned[l.id]).length;
    const last = lessons.find(l => l.id === state.lastLesson);
    return `<section class="page-heading course-top"><div><p class="eyebrow">От города к мифу</p><h1>${esc(course.title || 'Мир Шумера')}</h1><p class="lead">${esc(course.subtitle || 'Четыре лекции, карта, хронология и вопросы для возвращения к главным идеям.')}</p>${course.lecturer ? `<p class="course-lecturer">Лектор: ${esc(course.lecturer)}</p>` : ''}</div><div class="course-meta"><strong>${completed ? `${completed} / ${lessons.length}` : String(lessons.length)}</strong><span>${completed ? 'отмечено изученными' : 'лекции в курсе'}</span></div></section>
      ${last ? `<section class="continue-box" aria-label="Продолжение"><div><small>Последняя открытая лекция</small><strong>${esc(last.number)}. ${esc(last.title)}</strong></div>${lessonLink(last.id, 'Вернуться к лекции', 'button primary')}</section>` : ''}
      <div class="offline-summary"><p data-video-count>${esc(videoCountText())}</p><p>Полные записи сохраняются отдельно — в каждой лекции через «Добавить видео из Файлов».</p></div><div class="section-head"><h2>Четыре встречи с Шумером</h2><p>Выберите лекцию, с которой хотите начать.</p></div>
      <section class="lesson-grid" aria-label="Лекции курса">${lessons.map(l => `<article class="lesson-card ${state.learned[l.id] ? 'is-learned' : ''}"><div class="card-top"><span class="lesson-number">${esc(String(l.number).padStart(2, '0'))}</span><span class="tag ${state.learned[l.id] ? 'learned' : ''}">${state.learned[l.id] ? 'Изучено вами' : 'Лекция'}</span></div>${l.kicker ? `<p class="kicker">${esc(l.kicker)}</p>` : ''}<h2>${esc(l.title)}</h2><p class="card-question">${esc(l.summary || l.question || l.intro)}</p><div class="card-action">${lessonLink(l.id, 'Открыть лекцию', 'button')}</div></article>`).join('')}</section>
      <section class="guide-strip" aria-label="Как заниматься"><div><strong>Сначала — лекция</strong><p>Смотрите запись и оставляйте собственные заметки.</p></div><div><strong>Затем — связи</strong><p>Расположите города, события и персонажей в общей картине.</p></div><div><strong>Позже — вспомнить</strong><p>Ответьте своими словами и только потом откройте объяснение.</p></div></section>
      ${renderSources()}`;
  }

  function mediaConfig(id) {
    const item = window.SUMER_PRIVATE?.lessons?.[id] || {};
    return {
      embedUrl: safeUrl(item.embedUrl),
      officialUrl: safeUrl(item.officialUrl),
      slides: Array.isArray(item.slides) ? item.slides.map((s, i) => ({ title: s.title || `Материалы ${i + 1}`, url: safeUrl(s.url) })).filter(s => s.url) : (safeUrl(item.slidesUrl) ? [{ title: 'Презентация лекции', url: safeUrl(item.slidesUrl) }] : [])
    };
  }

  function renderVideo(l) {
    const media = mediaConfig(l.id);
    const local = videoMetadata.get(l.id);
    const saving = videoSaving.has(l.id);
    const error = videoErrors.get(l.id) || videoStoreError;
    const status = saving ? 'Проверяем и сохраняем полный видеофайл…' : local ? `Сохранено на устройстве · ${sizeText(local.size)}` : videoStoreReady ? 'Полная запись ещё не сохранена на этом устройстве.' : 'Проверяем видео на этом устройстве…';
    return `<section class="video-panel" data-video-panel="${esc(l.id)}" aria-label="Запись лекции"><div class="video-head"><span class="play-symbol" aria-hidden="true">▶</span><div><h2>Запись лекции ${esc(l.number)}</h2><p class="video-caption">${media.embedUrl || media.officialUrl ? 'Ваша официальная запись курса' : 'Онлайн-запись ещё не подключена'}</p></div></div><div class="button-row">${local ? `<button type="button" class="button primary" data-action="play-local-video" data-id="${esc(l.id)}">Смотреть без интернета</button>` : ''}${media.embedUrl ? `<button type="button" class="button ${local ? '' : 'primary'}" data-action="play-video" data-id="${esc(l.id)}">Смотреть онлайн</button>` : media.officialUrl ? externalLink(media.officialUrl, 'Открыть запись курса', 'button') : ''}</div><div data-video-slot="${esc(l.id)}"></div><div class="offline-video-box"><p class="offline-video-status ${local ? 'is-stored' : ''}" aria-live="polite">${esc(status)}</p>${local ? `<p class="video-filename">${esc(local.name)}</p>` : ''}${error ? `<p class="video-error" role="status">${esc(error)}</p>` : ''}<div class="button-row"><button type="button" class="button small ghost" data-action="choose-video" data-id="${esc(l.id)}" ${saving || !videoStore ? 'disabled' : ''}>${saving ? 'Сохраняется…' : local ? 'Заменить файл видео' : 'Добавить видео из «Файлов»'}</button>${local ? `<button type="button" class="button small ghost" data-action="delete-video" data-id="${esc(l.id)}" ${saving ? 'disabled' : ''}>Удалить с устройства</button>` : ''}</div><input type="file" id="video-file-${esc(l.id)}" data-video-file="${esc(l.id)}" accept="video/*,.mp4,.m4v,.mov,.webm" hidden><p class="video-help">Выберите полный файл лекции, который уже скачан в «Файлы». Приложение проверит его и сохранит для просмотра без сети. Не очищайте данные сайта: вместе с ними удаляются офлайн-видео.</p></div>${media.officialUrl || media.slides.length ? `<div class="video-links">${externalLink(media.officialUrl, 'На странице курса')}${media.slides.map(s => externalLink(s.url, s.title)).join('')}</div>` : ''}<p class="video-help">${esc(course.accessNote || (media.embedUrl || media.officialUrl ? 'Онлайн-проигрыватель использует доступ платформы курса. При запросе авторизации откройте страницу курса и войдите в свой аккаунт.' : 'Конспект и интерактивные разделы доступны. Личные ссылки на онлайн-записи добавляются отдельно.'))}</p></section>`;
  }

  function learnedControl(l) {
    return `<label class="learned-check"><input type="checkbox" data-learned="${esc(l.id)}" ${state.learned[l.id] ? 'checked' : ''}><span>Я изучил эту лекцию</span></label>`;
  }

  function noteField(l, prefix = 'lesson') {
    const id = `${prefix}-note-${l.id}`;
    return `<label class="note-label" for="${esc(id)}">Мои мысли и вопросы</label><textarea id="${esc(id)}" data-note="${esc(l.id)}" maxlength="50000" placeholder="Что меня удивило? Какую связь я хочу запомнить? Что уточнить при следующем просмотре?">${esc(state.notes[l.id] || '')}</textarea><p class="note-status" data-note-status="${esc(l.id)}" aria-live="polite">${state.notes[l.id] ? 'Сохранено на этом устройстве' : 'Сохраняется автоматически'}</p>`;
  }

  function renderLesson(id) {
    const l = lessons.find(x => x.id === id);
    const sections = Array.isArray(l.sections) ? l.sections : [];
    const index = lessons.findIndex(x => x.id === id);
    state.lastLesson = id;
    saveState();
    return `<nav class="lesson-nav" aria-label="Выбор лекции">${lessons.map(item => `<a href="#lesson/${esc(item.id)}" ${item.id === id ? 'aria-current="page"' : ''}>Лекция ${esc(item.number)}${state.learned[item.id] ? '<span aria-label="изучена">✓</span>' : ''}</a>`).join('')}</nav>
      <header class="lesson-title"><p class="eyebrow">Лекция ${esc(l.number)}${l.kicker ? ` · ${esc(l.kicker)}` : ''}</p><h1>${esc(l.title)}</h1>${l.question ? `<p class="lesson-question">${esc(l.question)}</p>` : ''}${l.intro ? `<div class="lesson-intro">${paragraphs(l.intro)}</div>` : ''}</header>
      <div class="lesson-columns"><div class="lesson-body">${renderVideo(l)}${sections.map((s, i) => `<section class="study-section" id="section-${esc(l.id)}-${i}"><span class="section-index">${String(i + 1).padStart(2, '0')} · ОПОРНАЯ ИДЕЯ</span><h2>${esc(s.title)}</h2>${s.anchor ? `<p class="section-reference">${esc(s.anchor)}</p>` : ''}<div class="section-text">${paragraphs(s.text)}</div>${s.memory ? `<div class="memory-line"><strong>Для запоминания</strong>${esc(s.memory)}</div>` : ''}</section>`).join('')}
      ${l.recall?.length ? `<section class="recall-inline"><h2>Вернитесь к главному</h2><p>Сначала ответьте своими словами. Нажмите на вопрос, чтобы раскрыть объяснение.</p>${l.recall.map(r => `<details><summary>${esc(r.question)}</summary><div>${paragraphs(r.answer)}</div></details>`).join('')}</section>` : ''}${renderSources(l.sourceIds)}
      <nav class="lesson-bottom" aria-label="Переход между лекциями">${index > 0 ? lessonLink(lessons[index - 1].id, '← Предыдущая', 'button ghost') : '<a class="button ghost" href="#course">← Все лекции</a>'}${index < lessons.length - 1 ? lessonLink(lessons[index + 1].id, 'Следующая лекция →', 'button') : '<a class="button" href="#recall">Вспомнить весь курс →</a>'}</nav></div>
      <aside class="lesson-aside"><div class="aside-panel contents-panel"><h2>Опорные идеи</h2><nav class="contents-list" aria-label="Содержание лекции">${sections.map((s, i) => `<a href="#section-${esc(l.id)}-${i}" data-section-link="section-${esc(l.id)}-${i}">${esc(s.title)}</a>`).join('')}</nav></div><div class="aside-panel">${learnedControl(l)}<p class="aside-caption">Отметка появится только по вашему выбору. Её можно снять в любой момент.</p></div><div class="aside-panel">${noteField(l)}</div></aside></div>`;
  }

  function mapMarkup() {
    return `<svg class="map-art" viewBox="0 0 800 560" role="img" aria-labelledby="map-title map-desc"><title id="map-title">Схематическая карта Междуречья</title><desc id="map-desc">Города между Тигром и Евфратом. Для выбора города используйте точки на схеме или кнопки под картой.</desc><rect class="map-land" width="800" height="560"/><path fill="#30302b" opacity=".8" d="M550 0H800V348L732 276 700 218 646 191 600 97Z"/><path class="map-gulf" d="M533 485Q568 445 611 467T689 485L800 476V560H562Z"/><path class="map-river" d="M285 0C225 52 238 95 285 132S316 189 330 224 344 273 393 305 406 359 449 390 476 444 547 491"/><path class="map-river" d="M445 0C472 61 444 80 483 129S482 200 497 240 530 278 526 325 558 391 572 430 574 462 593 491"/><path stroke="#7b715d" stroke-dasharray="3 9" stroke-width="2" fill="none" opacity=".45" d="M170 360Q345 370 505 320T712 270"/><text class="map-region" x="110" y="80">МЕЖДУРЕЧЬЕ</text><text class="map-label" transform="translate(226 215) rotate(45)">ЕВФРАТ</text><text class="map-label" transform="translate(548 160) rotate(68)">ТИГР</text><text class="map-label" x="616" y="533" style="font-size:15px;letter-spacing:1px">ПЕРСИДСКИЙ ЗАЛИВ</text>${cities.map(c => {
      const x = Math.max(28, Math.min(760, Number(c.x) * 8 || 400));
      const y = Math.max(40, Math.min(505, Number(c.y) * 5.6 || 280));
      const right = x > 610;
      return `<g class="map-city" role="button" tabindex="0" aria-label="${esc(c.name)}" aria-pressed="${c.id === cityId}" data-action="select-city" data-id="${esc(c.id)}"><circle fill="transparent" cx="${x}" cy="${y}" r="25"/><circle class="map-dot" cx="${x}" cy="${y}" r="10"/><text x="${x + (right ? -19 : 19)}" y="${y + 7}" text-anchor="${right ? 'end' : 'start'}">${esc(c.name)}</text></g>`;
    }).join('')}</svg>`;
  }

  function renderMap() {
    if (!cities.length) return '<div class="empty-state"><h2>Карта готовится</h2><p>Города появятся после добавления материалов курса.</p></div>';
    const c = cities.find(x => x.id === cityId) || cities[0];
    cityId = c.id;
    return `<div class="atlas-layout"><div class="map-panel">${mapMarkup()}<p class="map-caption">Схема помогает связать города с идеями курса. Расстояния и древние русла рек показаны условно.</p></div><article class="info-panel" aria-live="polite"><p class="eyebrow">Город и его место в истории</p><h2>${esc(c.name)}</h2><p class="subtitle">${esc(c.subtitle)}</p><div class="info-text">${paragraphs(c.text)}</div><div class="button-row">${lessonLink(c.lessonId, 'Вернуться к лекции →')}</div></article></div><div class="city-buttons" aria-label="Города">${cities.map(item => `<button type="button" class="city-button" aria-pressed="${item.id === cityId}" data-action="select-city" data-id="${esc(item.id)}">${esc(item.name)}</button>`).join('')}</div>`;
  }

  function renderTimeline() {
    if (!timeline.length) return '<div class="empty-state"><h2>Хронология готовится</h2><p>События появятся после добавления материалов курса.</p></div>';
    const t = timeline.find(x => x.id === timelineId) || timeline[0];
    timelineId = t.id;
    return `<div class="timeline-layout"><ol class="timeline-list">${timeline.map(item => `<li class="timeline-item ${item.id === timelineId ? 'is-selected' : ''}"><button type="button" class="timeline-button" aria-pressed="${item.id === timelineId}" data-action="select-event" data-id="${esc(item.id)}"><strong>${esc(item.date)}</strong><span>${esc(item.title)}</span></button></li>`).join('')}</ol><article class="info-panel timeline-info" aria-live="polite"><p class="date-display">${esc(t.date)}</p><h2>${esc(t.title)}</h2><div class="info-text">${paragraphs(t.text)}</div><div class="button-row">${lessonLink(t.lessonId, 'Связь с лекцией →')}</div></article></div><p class="backup-note">Даты древней истории могут быть приблизительными. Хронология показывает последовательность и связи, а не проверяет запоминание чисел.</p>`;
  }

  function typeLabel(type) {
    return ({ deity: 'Божества', god: 'Божества', hero: 'Герои', king: 'Правители', ruler: 'Правители', human: 'Люди', healer: 'Помощь и судьба', spirit: 'Духи', concept: 'Идеи' })[type] || type || 'Персонажи';
  }

  function renderFigures() {
    const types = [...new Set(figures.map(f => f.type).filter(Boolean))];
    const visible = figures.filter(f => figureFilter === 'all' || f.type === figureFilter);
    if (!visible.some(f => f.id === figureId)) figureId = visible[0]?.id;
    const f = visible.find(x => x.id === figureId);
    return `<div class="figure-filter" aria-label="Тип персонажа"><button type="button" class="city-button" aria-pressed="${figureFilter === 'all'}" data-action="filter-figures" data-filter="all">Все</button>${types.map(type => `<button type="button" class="city-button" aria-pressed="${figureFilter === type}" data-action="filter-figures" data-filter="${esc(type)}">${esc(typeLabel(type))}</button>`).join('')}</div><div class="figure-grid">${visible.map(item => `<button type="button" class="figure-button" aria-pressed="${item.id === figureId}" data-action="select-figure" data-id="${esc(item.id)}"><span class="figure-type">${esc(typeLabel(item.type))}</span><strong>${esc(item.name)}</strong><span class="figure-tagline">${esc(item.tagline)}</span></button>`).join('')}</div>${f ? `<article class="info-panel figure-detail" aria-live="polite"><p class="eyebrow">Связи и роли</p><h2>${esc(f.name)}</h2><p class="subtitle">${esc(f.tagline)}</p><div class="info-text">${paragraphs(f.text)}</div>${f.association ? `<div class="association"><strong>Связь для запоминания</strong><br>${esc(f.association)}</div>` : ''}<div class="button-row">${lessonLink(f.lessonId, 'Перейти к лекции →')}</div></article>` : '<div class="empty-state"><h2>Персонажи появятся здесь</h2></div>'}`;
  }

  function renderWorld() {
    return `<header class="page-heading"><p class="eyebrow">Собрать общую картину</p><h1>Мир Шумера</h1><p class="lead">Выберите город, событие или персонажа — и свяжите его с тем, что услышали в лекциях.</p></header><div class="tabs" role="tablist" aria-label="Как исследовать"><button type="button" class="tab" role="tab" id="tab-map" aria-controls="world-content" aria-selected="${worldTab === 'map'}" data-action="world-tab" data-tab="map">Города</button><button type="button" class="tab" role="tab" id="tab-time" aria-controls="world-content" aria-selected="${worldTab === 'time'}" data-action="world-tab" data-tab="time">Время</button><button type="button" class="tab" role="tab" id="tab-figures" aria-controls="world-content" aria-selected="${worldTab === 'figures'}" data-action="world-tab" data-tab="figures">Персонажи</button></div><section id="world-content" role="tabpanel" aria-labelledby="tab-${worldTab}">${worldTab === 'map' ? renderMap() : worldTab === 'time' ? renderTimeline() : renderFigures()}</section>`;
  }

  function recallItems() {
    return allRecall.filter(r => recallFilter === 'all' || r.lessonId === recallFilter);
  }

  function renderRecall() {
    const items = recallItems();
    if (recallIndex >= items.length) recallIndex = 0;
    const r = items[recallIndex];
    return `<header class="page-heading"><p class="eyebrow">Восстановить, а не перечитать</p><h1>Что осталось в памяти?</h1><p class="lead">Дайте себе время на ответ. Здесь нет оценок: задача — заново собрать связи и заметить, к чему хочется вернуться.</p></header><div class="recall-toolbar"><label class="select-label" for="recall-filter">Материал<select id="recall-filter"><option value="all" ${recallFilter === 'all' ? 'selected' : ''}>Все четыре лекции</option>${lessons.map(l => `<option value="${esc(l.id)}" ${recallFilter === l.id ? 'selected' : ''}>Лекция ${esc(l.number)}</option>`).join('')}</select></label>${r ? `<span class="recall-count">Вопрос ${recallIndex + 1} из ${items.length}</span>` : ''}</div>${r ? `<article class="recall-card"><p class="eyebrow">Лекция ${esc(r.number)} · ${esc(r.lessonTitle)}</p><h2 id="recall-question">${esc(r.question)}</h2><p class="recall-instruction">Попробуйте объяснить вслух в двух-трёх предложениях.</p>${!recallRevealed ? '<button type="button" class="button primary" data-action="reveal-recall">Раскрыть объяснение</button>' : `<div class="recall-answer" id="recall-answer" tabindex="-1"><p class="eyebrow">Опора для ответа</p>${paragraphs(r.answer)}<div class="button-row">${lessonLink(r.lessonId, 'Вернуться к материалу →')}</div></div>`}</article><div class="recall-actions"><div class="buttons-pair"><button type="button" class="button ghost" data-action="previous-recall" ${items.length < 2 ? 'disabled' : ''}>← Предыдущий</button><button type="button" class="button" data-action="next-recall" ${items.length < 2 ? 'disabled' : ''}>Следующий →</button></div><button type="button" class="button ghost" data-action="random-recall" ${items.length < 2 ? 'disabled' : ''}>Случайный вопрос</button></div>` : '<div class="empty-state"><h2>Вопросы появятся здесь</h2><p>Они будут связаны с материалами лекций.</p></div>'}`;
  }

  function renderNotes() {
    return `<header class="page-heading"><p class="eyebrow">Ваш собственный конспект</p><h1>Мысли, вопросы и связи</h1><p class="lead">Запишите то, что хотите удержать: удивившую деталь, собственную формулировку или вопрос к следующему просмотру.</p></header><div class="notes-tools"><button type="button" class="button" data-action="export-notes">Скачать резервную копию</button><button type="button" class="button ghost" data-action="import-notes">Восстановить копию</button>${typeof window.SumerAccess?.exportKey === 'function' ? '<button type="button" class="button ghost" data-action="export-access">Сохранить личный файл курса</button>' : ''}<input type="file" id="notes-import" accept="application/json,.json" hidden></div><div class="notes-grid">${lessons.map(l => `<section class="note-card"><div class="note-top"><p class="eyebrow">Лекция ${esc(l.number)}</p>${learnedControl(l)}</div><h2>${esc(l.title)}</h2>${noteField(l, 'all')}<div class="button-row">${lessonLink(l.id, 'Открыть материал →')}</div></section>`).join('')}</div><p class="backup-note">В копию входят только ваши заметки и отметки. Личные ссылки на видео в неё не включаются. Восстановление заменит текущие заметки данными выбранного файла.</p>`;
  }

  function render(options = {}) {
    clearPlayers();
    const current = route();
    const navPage = current.page === 'lesson' ? 'course' : current.page;
    document.querySelectorAll('[data-nav]').forEach(a => {
      if (a.dataset.nav === navPage) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (!lessons.length) {
      main.innerHTML = '<section class="empty-state"><h1>Материалы курса пока не подключены</h1><p>Приложению нужен файл с четырьмя лекциями. После его подключения здесь появятся записи, конспекты и интерактивные разделы.</p></section>';
      return;
    }
    main.innerHTML = current.page === 'lesson' ? renderLesson(current.id) : current.page === 'world' ? renderWorld() : current.page === 'recall' ? renderRecall() : current.page === 'notes' ? renderNotes() : renderCourse();
    const pageTitle = current.page === 'lesson' ? lessons.find(l => l.id === current.id).title : ({ course: course.title || 'Четыре лекции', world: 'Мир Шумера', recall: 'Вспомнить', notes: 'Заметки' })[current.page];
    document.title = `${pageTitle} · Шумер`;
    if (options.focus) {
      main.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  function updateWorld() {
    const container = document.getElementById('world-content');
    if (!container) return;
    const previousFocus = container.contains(document.activeElement) ? { action: document.activeElement.dataset.action, id: document.activeElement.dataset.id, filter: document.activeElement.dataset.filter } : null;
    container.innerHTML = worldTab === 'map' ? renderMap() : worldTab === 'time' ? renderTimeline() : renderFigures();
    container.setAttribute('aria-labelledby', `tab-${worldTab}`);
    document.querySelectorAll('[data-action="world-tab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === worldTab)));
    if (previousFocus?.action) {
      const candidates = Array.from(container.querySelectorAll('[data-action]'));
      candidates.find(el => el.dataset.action === previousFocus.action && el.dataset.id === previousFocus.id && el.dataset.filter === previousFocus.filter)?.focus({ preventScroll: true });
    }
  }

  function playVideo(id) {
    const media = mediaConfig(id);
    if (!media.embedUrl) return;
    updateVideoPanel(id, true);
    const slot = document.querySelector(`[data-video-slot="${id}"]`);
    const button = document.querySelector(`[data-action="play-video"][data-id="${id}"]`);
    if (!slot || !button) return;
    const frame = document.createElement('iframe');
    frame.className = 'video-frame';
    frame.title = `Запись: ${lessons.find(l => l.id === id)?.title || 'лекция'}`;
    const url = new URL(media.embedUrl);
    url.searchParams.delete('autoplay');
    frame.src = url.href;
    frame.allow = 'fullscreen; encrypted-media; picture-in-picture';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    slot.append(frame);
    button.textContent = 'Закрыть проигрыватель';
    button.dataset.action = 'close-video';
  }

  async function playLocalVideo(id, clickedButton) {
    if (!videoStore) return;
    clickedButton.disabled = true;
    clickedButton.textContent = 'Открывается…';
    try {
      const record = await videoStore.get(id);
      if (!record?.blob) throw new Error('Сохранённое видео не найдено. Добавьте файл заново.');
      const current = route();
      if (current.page !== 'lesson' || current.id !== id) return;
      updateVideoPanel(id, true);
      const slot = document.querySelector(`[data-video-slot="${id}"]`);
      const button = document.querySelector(`[data-action="play-local-video"][data-id="${id}"]`);
      if (!slot || !button) return;
      const url = URL.createObjectURL(record.blob);
      videoObjectUrls.add(url);
      const player = document.createElement('video');
      player.className = 'video-frame';
      player.dataset.localVideo = id;
      player.controls = true;
      player.playsInline = true;
      player.preload = 'metadata';
      player.src = url;
      player.setAttribute('aria-label', `Сохранённая запись: ${lessons.find(l => l.id === id)?.title || 'лекция'}`);
      player.addEventListener('error', () => {
        if (!player.getAttribute('src')) return;
        const message = document.createElement('p');
        message.className = 'video-error';
        message.textContent = 'Браузер не смог воспроизвести файл. Проверьте его в приложении «Файлы» или замените на совместимый MP4.';
        if (!slot.querySelector('.video-error')) slot.append(message);
      });
      slot.append(player);
      player.scrollIntoView({block:'nearest'});
      button.textContent = 'Закрыть видео';
      button.dataset.action = 'close-video';
    } catch (error) {
      videoErrors.set(id, error.message || 'Не удалось открыть сохранённое видео.');
      updateVideoPanel(id, true);
      toast(error.message || 'Не удалось открыть видео.');
    }
  }

  async function saveLocalVideo(id, file) {
    if (!file || !lessonIds.has(id) || !videoStore || videoSaving.has(id)) return;
    videoSaving.add(id);
    videoErrors.delete(id);
    updateVideoPanel(id, true);
    try {
      const item = await videoStore.save(id, file);
      videoMetadata.set(id, item);
      videoStoreReady = true;
      videoStoreError = '';
      toast(`Видео лекции ${lessons.find(l => l.id === id).number} сохранено на устройстве: ${sizeText(item.size)}.`);
    } catch (error) {
      videoErrors.set(id, error.message || 'Не удалось сохранить видео. Прежний файл не удалён.');
      toast(error.message || 'Не удалось сохранить видео. Прежний файл не удалён.');
    } finally {
      videoSaving.delete(id);
      updateVideoPanel(id, true);
    }
  }

  async function deleteLocalVideo(id) {
    if (!videoStore || !videoMetadata.has(id)) return;
    const lesson = lessons.find(l => l.id === id);
    if (!window.confirm(`Удалить сохранённое видео лекции ${lesson.number} с этого устройства? Заметки и доступ к онлайн-записи сохранятся.`)) return;
    try {
      await videoStore.remove(id);
      videoMetadata.delete(id);
      videoErrors.delete(id);
      updateVideoPanel(id, true);
      toast('Видео удалено с устройства. Ваши заметки сохранены.');
    } catch { toast('Не удалось удалить файл. Попробуйте ещё раз.'); }
  }

  function exportNotes() {
    clearTimeout(noteTimer);
    saveState();
    const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Шумер-заметки-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Резервная копия подготовлена. Сохраните её в надёжном месте.');
  }

  async function importNotes(file) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Файл слишком большой для копии заметок.');
      const next = checkedState(JSON.parse(await file.text()));
      clearTimeout(noteTimer);
      state = next;
      if (!saveState()) return;
      render();
      toast('Заметки и отметки восстановлены из выбранной копии.');
    } catch (error) {
      toast(error instanceof SyntaxError ? 'Не удалось прочитать JSON. Выберите резервную копию из этого приложения.' : error.message || 'Не удалось восстановить копию.');
    }
  }

  document.addEventListener('click', event => {
    if (event.target.closest('.skip-link')) {
      event.preventDefault();
      main.focus();
      return;
    }
    const sectionLink = event.target.closest('[data-section-link]');
    if (sectionLink) {
      event.preventDefault();
      document.getElementById(sectionLink.dataset.sectionLink)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'play-video') playVideo(button.dataset.id, button);
    if (action === 'play-local-video') playLocalVideo(button.dataset.id, button);
    if (action === 'close-video') updateVideoPanel(button.dataset.id, true);
    if (action === 'choose-video') document.getElementById(`video-file-${button.dataset.id}`)?.click();
    if (action === 'delete-video') deleteLocalVideo(button.dataset.id);
    if (action === 'world-tab') { worldTab = button.dataset.tab; updateWorld(); }
    if (action === 'select-city') { cityId = button.dataset.id; updateWorld(); }
    if (action === 'select-event') { timelineId = button.dataset.id; updateWorld(); }
    if (action === 'select-figure') { figureId = button.dataset.id; updateWorld(); }
    if (action === 'filter-figures') { figureFilter = button.dataset.filter; updateWorld(); }
    if (action === 'reveal-recall') {
      recallRevealed = true;
      render();
      document.getElementById('recall-answer')?.focus({ preventScroll: true });
    }
    if (['previous-recall', 'next-recall', 'random-recall'].includes(action)) {
      const length = recallItems().length;
      if (length < 2) return;
      recallIndex = action === 'previous-recall' ? (recallIndex - 1 + length) % length : action === 'next-recall' ? (recallIndex + 1) % length : (recallIndex + 1 + Math.floor(Math.random() * (length - 1))) % length;
      recallRevealed = false;
      render();
      document.getElementById('recall-question')?.scrollIntoView({ block: 'nearest' });
    }
    if (action === 'export-notes') exportNotes();
    if (action === 'export-access') window.SumerAccess?.exportKey?.();
    if (action === 'import-notes') document.getElementById('notes-import')?.click();
  });

  document.addEventListener('keydown', event => {
    const interactive = event.target.closest('g[data-action]');
    if (interactive && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      cityId = interactive.dataset.id;
      updateWorld();
      document.querySelector(`.city-button[data-id="${cityId}"]`)?.focus({ preventScroll: true });
    }
    if (event.target.matches('[role="tab"]') && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const current = tabs.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      tabs[next].click();
    }
  });

  document.addEventListener('input', event => {
    const id = event.target.dataset.note;
    if (!id || !lessonIds.has(id)) return;
    state.notes[id] = event.target.value.slice(0, 50000);
    document.querySelectorAll(`[data-note-status="${id}"]`).forEach(el => { el.textContent = 'Сохраняется…'; });
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      const saved = saveState();
      document.querySelectorAll('[data-note-status]').forEach(el => { el.textContent = saved ? 'Сохранено на этом устройстве' : 'Не удалось сохранить — выгрузите копию'; });
    }, 400);
  });

  document.addEventListener('change', event => {
    const id = event.target.dataset.learned;
    if (id && lessonIds.has(id)) {
      state.learned[id] = event.target.checked;
      saveState();
      toast(event.target.checked ? 'Вы отметили лекцию как изученную.' : 'Отметка об изучении снята.');
    }
    if (event.target.id === 'recall-filter') {
      recallFilter = event.target.value;
      recallIndex = 0;
      recallRevealed = false;
      render();
      document.getElementById('recall-filter')?.focus();
    }
    if (event.target.id === 'notes-import') importNotes(event.target.files?.[0]);
    if (event.target.dataset.videoFile) saveLocalVideo(event.target.dataset.videoFile, event.target.files?.[0]);
  });

  window.addEventListener('hashchange', () => {
    clearTimeout(noteTimer);
    saveState();
    render({ focus: true });
  });
  window.addEventListener('pagehide', () => { clearTimeout(noteTimer); saveState(); clearPlayers(); });
  render();
  refreshStoredVideos();
  if (!storageAvailable) toast('Сохранённые данные сейчас недоступны. Новые заметки можно выгрузить в резервную копию.');
})();
