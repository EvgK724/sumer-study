(() => {
  'use strict';
  const DATABASE = 'sumer-course-videos-v1';
  const STORE = 'videos';
  let opening;

  function userError(error) {
    if (error?.name === 'QuotaExceededError') return new Error('Недостаточно места в хранилище браузера. Освободите место на устройстве или удалите другое офлайн-видео. Прежний файл этой лекции сохранён.');
    if (error?.name === 'SecurityError' || error?.name === 'InvalidStateError' || error?.name === 'UnknownError') return new Error('Браузер не разрешил сохранить видео. Откройте приложение в обычном Safari, проверьте свободное место и повторите. Прежний файл не удалён.');
    return error instanceof Error ? error : new Error('Не удалось сохранить видео на этом устройстве. Прежний файл не удалён.');
  }

  function database() {
    if (!window.indexedDB) return Promise.reject(new Error('Этот браузер не поддерживает хранилище для офлайн-видео. Откройте приложение в Safari.'));
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let request;
      try { request = indexedDB.open(DATABASE, 1); } catch (error) { reject(userError(error)); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = undefined; };
        resolve(db);
      };
      request.onerror = () => { opening = undefined; reject(userError(request.error)); };
      request.onblocked = () => { opening = undefined; reject(new Error('Закройте другие вкладки этого приложения и попробуйте сохранить видео ещё раз.')); };
    });
    return opening;
  }

  function metadata(record) {
    return record ? { id: record.id, name: record.name, size: record.size, type: record.type, duration: record.duration, storedAt: record.storedAt } : null;
  }

  async function list() {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result.map(metadata));
      request.onerror = () => reject(userError(request.error));
    });
  }

  async function get(id) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(userError(request.error));
    });
  }

  function probe(file) {
    return new Promise((resolve, reject) => {
      if (!(file instanceof Blob) || !Number.isFinite(file.size) || file.size <= 0) { reject(new Error('Выберите непустой видеофайл из приложения «Файлы».')); return; }
      const extension = /\.(mp4|m4v|mov|webm)$/i.test(file.name || '');
      if (!/^video\//.test(file.type || '') && !extension) { reject(new Error('Нужен видеофайл MP4, MOV, M4V или другой формат, который воспроизводит ваш браузер.')); return; }
      const player = document.createElement('video');
      player.preload = 'metadata';
      player.playsInline = true;
      const url = URL.createObjectURL(file);
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        player.removeAttribute('src');
        player.load();
        URL.revokeObjectURL(url);
        error ? reject(error) : resolve(result);
      };
      const timeout = setTimeout(() => finish(new Error('Не удалось прочитать видеофайл. Убедитесь, что он полностью скачан в «Файлы» и открывается на устройстве.')), 25000);
      player.addEventListener('loadedmetadata', () => {
        if (!player.videoWidth || !player.videoHeight) finish(new Error('В файле не найдена видеодорожка. Выберите полную запись лекции.'));
        else finish(null, { duration: Number.isFinite(player.duration) ? player.duration : null });
      }, { once: true });
      player.addEventListener('error', () => finish(new Error('Этот браузер не может прочитать формат видео. Выберите воспроизводимый на устройстве файл, например MP4 с видео H.264.')), { once: true });
      player.src = url;
      player.load();
    });
  }

  async function save(id, file) {
    if (typeof id !== 'string' || !/^l[1-4]$/.test(id)) throw new Error('Не удалось определить лекцию для видео.');
    const details = await probe(file);
    const db = await database();
    const record = { id, blob: file, name: file.name || 'lecture.mp4', size: file.size, type: file.type || 'video/mp4', duration: details.duration, storedAt: new Date().toISOString() };
    await new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(STORE, 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(userError(transaction.error));
        transaction.onerror = () => {};
        transaction.objectStore(STORE).put(record);
      } catch (error) {
        try { transaction?.abort(); } catch {}
        reject(userError(error));
      }
    });
    try { await navigator.storage?.persist?.(); } catch {}
    return metadata(record);
  }

  async function remove(id) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(userError(transaction.error));
      transaction.onerror = () => {};
      transaction.objectStore(STORE).delete(id);
    });
  }

  window.SUMER_VIDEO_STORE = Object.freeze({ list, get, save, remove });
})();
