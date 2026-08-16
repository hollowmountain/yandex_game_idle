// Точка входа: загрузка, игровой цикл, автосохранение, реклама.
(() => {

  const SAVE_EVERY = 10000;   // автосохранение раз в 10 с
  const AD_EVERY   = 195000;  // полноэкранная реклама не чаще раза в ~3.5 мин

  let paused = false;
  let manualPause = false;
  let last = 0;
  let sinceSave = 0;
  let sinceAd = 0;

  /* ---------- звук ---------- */
  const Sound = (() => {
    let actx = null;
    function ping(freq, len) {
      if (State.raw.muted) return;
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'triangle';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.05, actx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + len);
        o.connect(g).connect(actx.destination);
        o.start();
        o.stop(actx.currentTime + len);
      } catch (e) {}
    }
    return {
      dig: () => ping(150 + Math.random() * 60, 0.07),
      buy: () => ping(560, 0.13)
    };
  })();

  /* ---------- сохранение ---------- */

  let saving = false;
  async function save() {
    if (saving) return;
    saving = true;
    try { await SDK.save(State.serialize()); } finally { saving = false; }
  }

  /* ---------- цикл ---------- */

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;

    if (!paused) {
      State.tick(dt);
      sinceSave += dt * 1000;
      sinceAd += dt * 1000;

      if (sinceSave >= SAVE_EVERY) { sinceSave = 0; save(); }
      if (sinceAd >= AD_EVERY && !SDK.busy) { sinceAd = 0; SDK.interstitial(); }
    }

    Render.draw(State.raw.depth, dt);
  }

  // Тяжёлый DOM обновляем 5 раз в секунду, а не каждый кадр
  function slowRefresh() {
    UI.refreshHud();
    UI.refreshBoosts();
    UI.refreshPanel();
  }

  /* ---------- действия ---------- */

  function doDig(ev) {
    if (paused) return;
    const r = State.click();
    Render.burst(r.meters);
    Sound.dig();
    const x = ev && ev.clientX ? ev.clientX : window.innerWidth / 2;
    const y = ev && ev.clientY ? ev.clientY : window.innerHeight * 0.6;
    UI.floater(x, y - 30, '+' + DATA.fmt(r.ore));
    UI.refreshHud();
  }

  function doSmelt() {
    const bonus = Math.round((State.raw.cores + 1) * DATA.CORE_BONUS * 100);
    if (!State.smelt()) return;
    Sound.buy();
    save();
    UI.modal(I18N.t('reset_title'), I18N.t('reset_text', { bonus }));
    UI.switchTab('drills');
    slowRefresh();
  }

  function doWatchBoost() {
    SDK.rewarded(() => {
      State.grantBoost();
      Sound.buy();
      save();
      UI.refreshBoosts();
    });
  }

  function setPause(on, manual) {
    if (manual) manualPause = on;
    paused = on || manualPause;
    UI.el['btn-pause'].textContent = paused ? '▶' : '⏸';
    if (paused) { SDK.gameplayStop(); save(); }
    else { SDK.gameplayStart(); last = performance.now(); }
  }

  /* ---------- запуск ---------- */

  async function boot() {
    Render.init();
    UI.init({ onSmelt: doSmelt, onWatchBoost: doWatchBoost });

    await SDK.init();

    const saved = await SDK.load();
    if (saved) State.hydrate(saved);

    I18N.set(State.raw.lang || I18N.detect(SDK.lang()));
    UI.el['btn-sound'].classList.toggle('off', !!State.raw.muted);
    UI.el['btn-sound'].textContent = State.raw.muted ? '🔇' : '🔊';

    const offline = State.applyOffline();

    SDK.onPause(() => setPause(true, false));
    SDK.onResume(() => setPause(false, false));

    // --- кнопки ---
    UI.el.dig.addEventListener('pointerdown', doDig);
    UI.el['btn-pause'].addEventListener('click', () => setPause(!manualPause, true));
    UI.el['btn-lang'].addEventListener('click', () => {
      State.raw.lang = I18N.toggle();
      UI.relabel();
      save();
    });
    UI.el['btn-sound'].addEventListener('click', () => {
      const m = !State.raw.muted;
      State.raw.muted = m;
      UI.el['btn-sound'].textContent = m ? '🔇' : '🔊';
      UI.el['btn-sound'].classList.toggle('off', m);
      save();
    });

    // Сохраняемся при уходе со страницы — обновление вкладки не должно
    // терять прогресс (прямое требование модерации).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { save(); setPause(true, false); }
      else setPause(false, false);
    });
    window.addEventListener('pagehide', save);

    UI.relabel();
    UI.bootDone();
    SDK.ready();          // платформе: игра готова, можно играть
    SDK.gameplayStart();

    if (offline && offline.ore > 0) {
      UI.modal(I18N.t('welcome_title'), I18N.t('welcome_text', {
        depth: DATA.fmt(offline.depth),
        ore: DATA.fmt(offline.ore)
      }));
    }

    setInterval(slowRefresh, 200);
    last = performance.now();
    requestAnimationFrame(frame);
  }

  boot();
})();
