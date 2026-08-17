// Обёртка над SDK Яндекс Игр.
// Если SDK недоступен (локальный запуск, Poki, CrazyGames, itch) — всё
// молча деградирует в заглушки, и игра продолжает работать.
const SDK = (() => {

  const SDK_URL = 'https://yandex.ru/games/sdk/v2';
  const SAVE_KEY = 'deepcore_save_v1';
  const AD_MIN_GAP = 180000; // 3 минуты — минимальный интервал между рекламой

  let ysdk = null;
  let player = null;
  let available = false;
  let lastAd = 0;
  let adActive = false;

  const handlers = { pause: () => {}, resume: () => {} };

  function loadScript(url, timeout = 6000) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const timer = setTimeout(() => reject(new Error('sdk timeout')), timeout);
      s.src = url;
      s.onload = () => { clearTimeout(timer); resolve(); };
      s.onerror = () => { clearTimeout(timer); reject(new Error('sdk failed')); };
      document.head.appendChild(s);
    });
  }

  // SDK Яндекса грузим только когда мы действительно внутри Яндекс Игр.
  // На Poki, CrazyGames, itch и на локальной машине он не просто бесполезен —
  // он сыплет необработанными ошибками в консоль, а это причина отказа модерации.
  function onYandex() {
    const q = location.search;
    if (/[?&]nosdk/.test(q)) return false;
    if (/[?&]ysdk/.test(q)) return true;
    const host = location.hostname || '';
    const ref = document.referrer || '';
    return /(^|\.)yandex\.|(^|\.)ya\.ru|games\.s3|yandex\.net/.test(host) ||
           /(^|\/\/)([\w-]+\.)*yandex\.|ya\.ru/.test(ref);
  }

  async function init() {
    if (!onYandex()) { available = false; return false; }
    try {
      await loadScript(SDK_URL);
      ysdk = await window.YaGames.init();
      available = true;
      try {
        player = await ysdk.getPlayer({ scopes: false });
      } catch (e) {
        player = null; // гость — сохраняемся в localStorage
      }
      // Яндекс сам шлёт паузу при сворачивании вкладки и показе рекламы
      ysdk.on('game_api_pause', () => handlers.pause());
      ysdk.on('game_api_resume', () => handlers.resume());
    } catch (e) {
      available = false;
    }
    return available;
  }

  // Обязательный сигнал платформе: игра загрузилась и в неё можно играть.
  function ready() {
    try { ysdk && ysdk.features.LoadingAPI.ready(); } catch (e) {}
  }

  function gameplayStart() { try { ysdk && ysdk.features.GameplayAPI.start(); } catch (e) {} }
  function gameplayStop()  { try { ysdk && ysdk.features.GameplayAPI.stop();  } catch (e) {} }

  async function save(data) {
    const json = JSON.stringify(data);
    try { localStorage.setItem(SAVE_KEY, json); } catch (e) {}
    if (player) {
      try { await player.setData({ save: data }, true); } catch (e) {}
    }
  }

  async function load() {
    if (player) {
      try {
        const remote = await player.getData(['save']);
        if (remote && remote.save) return remote.save;
      } catch (e) {}
    }
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  // Полноэкранная реклама. Сама следит, чтобы не мелькать чаще раза в 3 минуты —
  // частый показ бьёт и по удержанию, и по самой ставке eCPM.
  function interstitial() {
    const now = Date.now();
    if (!available || adActive || now - lastAd < AD_MIN_GAP) return false;
    adActive = true;
    lastAd = now;
    try {
      ysdk.adv.showFullscreenAdv({
        callbacks: {
          onOpen: () => handlers.pause(),
          onClose: () => { adActive = false; handlers.resume(); },
          onError: () => { adActive = false; handlers.resume(); }
        }
      });
      return true;
    } catch (e) {
      adActive = false;
      return false;
    }
  }

  // Реклама за вознаграждение. onReward вызывается только при полном просмотре.
  function rewarded(onReward) {
    if (!available) {           // вне Яндекса просто выдаём награду
      onReward();
      return;
    }
    if (adActive) return;
    adActive = true;
    let paid = false;
    try {
      ysdk.adv.showRewardedVideo({
        callbacks: {
          onOpen: () => handlers.pause(),
          onRewarded: () => { paid = true; },
          onClose: () => {
            adActive = false;
            handlers.resume();
            if (paid) onReward();
          },
          onError: () => { adActive = false; handlers.resume(); }
        }
      });
    } catch (e) {
      adActive = false;
      onReward();
    }
  }

  function lang() {
    try { return ysdk.environment.i18n.lang; } catch (e) { return null; }
  }

  // Полный сброс прогресса. Нужен для отладки: без него испорченное
  // сохранение не выкинуть, потому что игра честно сохраняется при уходе
  // со страницы и тут же восстанавливает его обратно.
  async function wipe() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    if (player) {
      try { await player.setData({ save: null }, true); } catch (e) {}
    }
  }

  return {
    init, ready, gameplayStart, gameplayStop,
    save, load, wipe, interstitial, rewarded, lang,
    onPause(fn) { handlers.pause = fn; },
    onResume(fn) { handlers.resume = fn; },
    get available() { return available; },
    get busy() { return adActive; }
  };
})();
