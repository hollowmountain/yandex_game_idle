// Заглушка SDK Яндекс Игр для локальной проверки.
//
// Дев-сервер отдаёт этот файл по адресу /sdk.js — тому самому, откуда
// настоящий загрузчик приходит на платформе. Благодаря этому локально
// проверяется именно боевая ветка кода: тег в index.html срабатывает,
// YaGames появляется, игра идёт по пути «мы внутри Яндекса».
//
// В архив игры файл не попадает: он лежит в tools/, а на платформе /sdk.js
// отдаёт сам Яндекс.
(function () {
  const log = (...a) => console.log('%c[sdk-mock]', 'color:#ffa62b', ...a);
  const listeners = {};
  let store = {};

  try {
    const raw = localStorage.getItem('sdkmock_cloud');
    if (raw) store = JSON.parse(raw);
  } catch (e) {}

  const persist = () => {
    try { localStorage.setItem('sdkmock_cloud', JSON.stringify(store)); } catch (e) {}
  };

  window.YaGames = {
    init: function () {
      log('init()');
      return Promise.resolve({
        features: {
          LoadingAPI: { ready: () => log('LoadingAPI.ready()') },
          GameplayAPI: {
            start: () => log('GameplayAPI.start()'),
            stop:  () => log('GameplayAPI.stop()')
          }
        },
        environment: { i18n: { lang: (navigator.language || 'ru').slice(0, 2) } },
        on: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); log('on(' + evt + ')'); },
        getPlayer: function () {
          log('getPlayer()');
          return Promise.resolve({
            setData: (d) => { store = Object.assign({}, store, d); persist(); log('player.setData', d); return Promise.resolve(); },
            getData: (keys) => {
              const out = {};
              (keys || Object.keys(store)).forEach(k => { if (k in store) out[k] = store[k]; });
              log('player.getData', keys, out);
              return Promise.resolve(out);
            }
          });
        },
        adv: {
          showFullscreenAdv: function (o) {
            const cb = (o && o.callbacks) || {};
            log('showFullscreenAdv');
            cb.onOpen && cb.onOpen();
            setTimeout(() => cb.onClose && cb.onClose(true), 400);
          },
          showRewardedVideo: function (o) {
            const cb = (o && o.callbacks) || {};
            log('showRewardedVideo');
            cb.onOpen && cb.onOpen();
            setTimeout(() => { cb.onRewarded && cb.onRewarded(); cb.onClose && cb.onClose(); }, 400);
          }
        }
      });
    }
  };

  // Ручная проверка паузы от платформы из консоли браузера
  window.__fireSdk = (evt) => (listeners[evt] || []).forEach(f => f());
  log('готов; события можно слать через __fireSdk("game_api_pause")');
})();
