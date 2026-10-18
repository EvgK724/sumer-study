(() => {
  'use strict';
  const status = document.getElementById('offline-status');
  let ready = false;
  function update() {
    status.textContent = ready
      ? 'Приложение сохранено для работы без интернета. Видеофайлы добавляются отдельно в каждой лекции.'
      : 'Для первого сохранения приложения нужно подключение к интернету.';
  }
  if (!('serviceWorker' in navigator)) { update(); return; }
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SUMER_OFFLINE_READY') { ready = true; update(); }
  });
  navigator.serviceWorker.register('./sw.js').then(async registration => {
    await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller || registration.active;
    worker?.postMessage({type: 'SUMER_CHECK_OFFLINE'});
  }).catch(update);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    navigator.serviceWorker.controller?.postMessage({type: 'SUMER_CHECK_OFFLINE'});
  });
})();
