(() => {
  'use strict';

  const STORAGE_KEY = 'sumer.study.bundle.v1';
  const ACCESS_APP = 'sumer-study-access';
  const base = new URL('.', document.currentScript?.src || new URL('./boot.js', location.href));
  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  let activeBundle = null;
  let busy = false;
  let appLoading = null;
  let storageAvailable = true;

  document.documentElement.classList.add('access-locked');
  let root = document.getElementById('access-root');
  if (!root) {
    root = document.createElement('section');
    root.id = 'access-root';
    document.body.prepend(root);
  }
  root.className = 'access-screen';
  root.setAttribute('aria-labelledby', 'access-title');
  root.innerHTML = `<div class="access-card">
    <div class="access-mark" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M8 11h28l-7 6H15zM12 23h28l-7 6H19zM8 35h24l-7 6H15zM22 7l6 5v25l-6-5z"/></svg></div>
    <p class="access-eyebrow">Ваше пространство для изучения</p>
    <h1 id="access-title">Шумер</h1>
    <p class="access-subtitle">Четыре лекции. Один древний мир.</p>
    <div class="access-divider" aria-hidden="true"></div>
    <h2>Подключить мой курс</h2>
    <p class="access-description">Файл содержит учебные материалы и ссылки на ваши лекции. Видео добавляются отдельно.</p>
    <input id="access-file" class="access-file-input" type="file" accept=".json,application/json,text/plain" aria-label="Личный файл курса">
    <button class="access-button" id="access-choose" type="button">Выбрать личный файл курса <span aria-hidden="true">↗</span></button>
    <p id="access-status" class="access-status" role="status" aria-live="polite" aria-atomic="true"></p>
    <p class="access-note">Выберите файл из «Файлов» один раз на этом устройстве. Материалы сохранятся в браузере; содержимое личного файла никуда не отправляется.</p>
    <p class="access-device-note">На другом iPhone или iPad выберите тот же файл.</p>
  </div>`;

  const fileInput = document.getElementById('access-file');
  const chooseButton = document.getElementById('access-choose');
  const status = document.getElementById('access-status');

  function say(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('access-error', isError);
  }

  function decodeBase64(value, urlSafe = false) {
    if (typeof value !== 'string' || !value || value.length > 40_000_000) throw new Error('invalid-data');
    const pattern = urlSafe ? /^[A-Za-z0-9_-]+={0,2}$/ : /^[A-Za-z0-9+/]+={0,2}$/;
    if (!pattern.test(value) || value.length % 4 === 1) throw new Error('invalid-data');
    const normalized = (urlSafe ? value.replace(/-/g, '+').replace(/_/g, '/') : value).replace(/=+$/, '');
    const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, ch => ch.charCodeAt(0));
  }

  function checkedKey(value) {
    if (typeof value !== 'string' || value.length > 44) throw new Error('invalid-key');
    if (decodeBase64(value, true).length !== 32) throw new Error('invalid-key');
    return value.replace(/=+$/, '');
  }

  function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function checkedBundle(value) {
    if (!record(value) || value.app !== ACCESS_APP || value.version !== 1 || !record(value.pack)) throw new Error('invalid-file');
    const key = checkedKey(value.key);
    const pack = value.pack;
    if (pack.version !== 1 || pack.algorithm !== 'AES-GCM' || typeof pack.iv !== 'string' || typeof pack.ciphertext !== 'string' || pack.ciphertext.length > MAX_FILE_BYTES) throw new Error('invalid-file');
    return { app: ACCESS_APP, version: 1, key, pack: { version: 1, algorithm: 'AES-GCM', iv: pack.iv, ciphertext: pack.ciphertext } };
  }

  function checkedUrl(value, purpose) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || value.length > 12000 || /[\r\n\u0000]/.test(value)) throw new Error('invalid-payload');
    let url;
    try { url = new URL(value); } catch { throw new Error('invalid-payload'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('invalid-payload');
    const allowed = purpose === 'embed'
      ? url.hostname === 'kinescope.io' && url.pathname.startsWith('/embed/') && url.pathname.length > 7
      : purpose === 'official'
        ? url.hostname === 'mifcourse.getcourse.ru'
        : url.hostname === 'docs.google.com';
    if (!allowed) throw new Error('invalid-payload');
    // Keep the signed player URL and its watermark parameters exactly as supplied.
    return value;
  }

  function checkedPayload(payload) {
    if (!record(payload) || !record(payload.data) || !Array.isArray(payload.data.lessons) || payload.data.lessons.length !== 4 || !record(payload.privateConfig) || !record(payload.privateConfig.lessons)) throw new Error('invalid-payload');
    const lessons = Object.create(null);
    for (const [id, item] of Object.entries(payload.privateConfig.lessons)) {
      if (!record(item) || !payload.data.lessons.some(lesson => lesson.id === id)) throw new Error('invalid-payload');
      lessons[id] = {
        embedUrl: checkedUrl(item.embedUrl, 'embed'),
        officialUrl: checkedUrl(item.officialUrl, 'official'),
        slidesUrl: checkedUrl(item.slidesUrl, 'slides'),
        slides: Array.isArray(item.slides) ? item.slides.map(slide => {
          if (!record(slide) || typeof slide.title !== 'string') throw new Error('invalid-payload');
          return { title: slide.title, url: checkedUrl(slide.url, 'slides') };
        }) : []
      };
    }
    return { data: payload.data, privateConfig: { lessons } };
  }

  async function decryptCourse(bundle) {
    if (!window.crypto?.subtle) throw new Error('crypto-unavailable');
    const { key: keyText, pack } = bundle;
    let iv, ciphertext;
    try {
      iv = decodeBase64(pack.iv);
      ciphertext = decodeBase64(pack.ciphertext);
      if (iv.length !== 12 || ciphertext.length < 17) throw new Error('invalid-data');
    } catch { throw new Error('invalid-file'); }
    const key = await crypto.subtle.importKey('raw', decodeBase64(keyText, true), { name: 'AES-GCM' }, false, ['decrypt']);
    let bytes;
    try { bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, ciphertext); }
    catch { throw new Error('wrong-key'); }
    let payload;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error('invalid-payload'); }
    return checkedPayload(payload);
  }

  function loadApp() {
    if (appLoading) return appLoading;
    appLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('app.js', base).href;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        appLoading = null;
        reject(new Error('app-unavailable'));
      };
      document.head.append(script);
    });
    return appLoading;
  }

  function exportKey() {
    if (!activeBundle) return false;
    const text = JSON.stringify(activeBundle, null, 2) + '\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Шумер — личный курс.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }

  window.SumerAccess = Object.freeze({ exportKey, exportCourse: exportKey, get storageAvailable() { return storageAvailable; } });

  function storageWarning() {
    if (storageAvailable || document.getElementById('access-storage-warning')) return;
    const warning = document.createElement('aside');
    warning.id = 'access-storage-warning';
    warning.className = 'access-storage-warning';
    warning.setAttribute('role', 'status');
    const text = document.createElement('p');
    text.textContent = 'Курс открыт, но браузер не смог сохранить материалы на устройстве. Сохраните личный файл курса: при следующем открытии его потребуется выбрать снова.';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'access-button access-button-secondary';
    button.textContent = 'Сохранить личный файл курса';
    button.addEventListener('click', exportKey);
    warning.append(text, button);
    document.body.prepend(warning);
  }

  async function unlock(candidate) {
    if (busy) return;
    busy = true;
    chooseButton.disabled = true;
    root.setAttribute('aria-busy', 'true');
    say('Открываю ваш курс…');
    try {
      const bundle = checkedBundle(candidate);
      const payload = await decryptCourse(bundle);
      window.SUMER_DATA = payload.data;
      window.SUMER_PRIVATE = payload.privateConfig;
      activeBundle = bundle;
      try {
        const serialized = JSON.stringify(bundle);
        localStorage.setItem(STORAGE_KEY, serialized);
        storageAvailable = localStorage.getItem(STORAGE_KEY) === serialized;
      } catch { storageAvailable = false; }
      await loadApp();
      root.hidden = true;
      document.documentElement.classList.remove('access-locked');
      storageWarning();
      window.dispatchEvent(new CustomEvent('sumer-access-ready'));
    } catch (error) {
      const messages = {
        'invalid-file': 'Этот файл не содержит полного курса. Выберите личный файл курса «Шумер» с расширением .json.',
        'invalid-key': 'Этот файл не подходит. Выберите личный файл курса «Шумер».',
        'invalid-data': 'Этот файл не подходит. Выберите личный файл курса «Шумер».',
        'wrong-key': 'Не удалось открыть материалы в этом файле. Выберите исходный личный файл курса «Шумер».',
        'app-unavailable': 'Не удалось загрузить приложение. Подключитесь к интернету и выберите файл ещё раз.',
        'crypto-unavailable': 'Этот браузер не может открыть материалы. Откройте приложение по защищённой ссылке в Safari.',
        'invalid-payload': 'Не удалось прочитать материалы курса. Выберите исправленный личный файл курса.'
      };
      say(messages[error.message] || 'Не удалось открыть курс. Выберите личный файл курса ещё раз.', true);
    } finally {
      busy = false;
      chooseButton.disabled = false;
      root.removeAttribute('aria-busy');
    }
  }

  chooseButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || busy) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('invalid-file');
      const value = JSON.parse(await file.text());
      await unlock(value);
    } catch {
      say('Не удалось прочитать личный файл курса. Выберите файл «Шумер» с расширением .json размером до 2 МБ.', true);
    }
  });

  let storedBundle = '';
  try { storedBundle = localStorage.getItem(STORAGE_KEY) || ''; }
  catch { storageAvailable = false; }
  if (storedBundle) {
    try {
      if (storedBundle.length > MAX_FILE_BYTES) throw new Error('invalid-file');
      unlock(JSON.parse(storedBundle));
    } catch {
      say('Не удалось прочитать сохранённый курс. Выберите ваш личный файл курса ещё раз. Заметки остаются на устройстве.', true);
    }
  }
})();
