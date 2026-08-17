// Точка входа: загрузка, игровой цикл, автосохранение, реклама.
(() => {

  const SAVE_EVERY = 10000;   // автосохранение раз в 10 с
  const AD_EVERY   = 195000;  // полноэкранная реклама не чаще раза в ~3.5 мин

  let paused = false;
  let manualPause = false;
  let last = 0;
  let sinceSave = 0;
  let sinceAd = 0;
  let adPending = false;   // время пришло, ждём подходящий момент

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
      buy: () => ping(560, 0.13),
      // Требование платформы: звук замолкает при потере фокуса вкладки и на
      // время рекламного ролика. Одних коротких сигналов мало — проверяют
      // состояние аудиоконтекста, поэтому глушим его целиком.
      suspend() { try { if (actx && actx.state === 'running') actx.suspend(); } catch (e) {} },
      resume()  { try { if (actx && actx.state === 'suspended') actx.resume(); } catch (e) {} }
    };
  })();

  /* ---------- сохранение ---------- */

  // В витринном режиме сохраняться нельзя: иначе один открытый скриншотный
  // адрес затрёт автосохранением настоящий прогресс игрока.
  const DEMO_MODE = /[?&]demo=\d/.test(location.search);

  let saving = false;
  async function save() {
    if (DEMO_MODE || saving) return;
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
      // Таймер только взводит показ, но не показывает: реклама обязана
      // появляться в логической паузе, а не поверх копания.
      if (sinceAd >= AD_EVERY) { sinceAd = 0; adPending = true; }
    }

    Render.draw(State.raw.depth, dt, State.rate());
  }

  // Тяжёлый DOM обновляем 5 раз в секунду, а не каждый кадр
  function slowRefresh() {
    UI.refreshHud();
    UI.refreshBoosts();
    UI.refreshPanel();
  }

  /* ---------- реклама в паузах ---------- */

  // Логическая пауза — это момент, когда игрок и так оторвался от копания:
  // закрыл окно, вернулся из паузы, переплавил ядро. Показывать полноэкранную
  // рекламу посреди активной игры платформа прямо запрещает.
  function adAtBreak() {
    if (!adPending || SDK.busy || paused) return;
    adPending = false;
    SDK.interstitial();
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
    UI.resetLists();          // буров у игрока больше нет, список строим заново
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
    if (paused) {
      SDK.gameplayStop();
      Sound.suspend();      // вкладка ушла из фокуса или идёт ролик — звука быть не должно
      save();
    } else {
      SDK.gameplayStart();
      Sound.resume();
      last = performance.now();
      // Возврат в игру — это уже пройденная пауза, здесь реклама уместна.
      adAtBreak();
    }
  }

  /* ---------- витринные состояния ---------- */

  // Пресеты для съёмки промо-скриншотов: ?demo=1..5. Иначе, чтобы снять кадр
  // в магме, пришлось бы честно доигрывать до неё полчаса. Прогресс при этом
  // не сохраняется — состояние живёт только до перезагрузки.
  const DEMOS = {
    1: { depth: 210,    ore: 340,   drills: { auger: 8 } },
    2: { depth: 2600,   ore: 4.1e4, drills: { auger: 22, jack: 15, exca: 6 } },
    3: { depth: 92000,  ore: 3.8e7, drills: { auger: 34, jack: 28, exca: 22, plasma: 16, borer: 9, grav: 3 } },
    4: { depth: 620000, ore: 8.4e9, drills: { auger: 40, jack: 34, exca: 28, plasma: 21, borer: 14, grav: 9, anni: 4 } },
    5: { depth: 92000,  ore: 3.8e7, drills: { auger: 34, jack: 28, exca: 22, plasma: 16, borer: 9, grav: 3 }, tab: 'upgrades',
         upgrades: { click: 7, speed: 5, value: 4 } }
  };

  function applyDemo(n) {
    const d = DEMOS[n];
    if (!d) return null;
    State.hydrate(State.fresh());
    const s = State.raw;
    s.depth = d.depth;
    s.ore = d.ore;
    s.drills = Object.assign({}, d.drills);
    s.upgrades = Object.assign({}, d.upgrades || {});
    State.grantBoost();
    return d;
  }

  /* ---------- запуск ---------- */

  async function boot() {
    Render.init();
    UI.init({
      onSmelt: doSmelt,
      onWatchBoost: doWatchBoost,
      onBuy: () => Sound.buy(),
      onModalClose: adAtBreak
    });

    await SDK.init();

    if (/[?&]reset/.test(location.search)) await SDK.wipe();

    const saved = await SDK.load();
    const demo = /[?&]demo=(\d)/.exec(location.search);
    if (saved) State.hydrate(saved);

    I18N.set(State.raw.lang || I18N.detect(SDK.lang()));
    UI.el['btn-sound'].classList.toggle('off', !!State.raw.muted);
    UI.el['btn-sound'].textContent = State.raw.muted ? '🔇' : '🔊';

    const offline = State.applyOffline();

    SDK.onPause(() => setPause(true, false));
    SDK.onResume(() => setPause(false, false));

    // --- кнопки ---
    UI.el.dig.addEventListener('pointerdown', doDig);

    // Копать можно тыком в любое свободное место, а не только по кнопке.
    // Интерфейс из этого исключён, иначе покупка бура считалась бы ещё и ударом.
    const UI_ZONES = '#panel, #tools, #boosts, #modal, #dig';
    document.addEventListener('pointerdown', e => {
      if (e.target.closest && e.target.closest(UI_ZONES)) return;
      doDig(e);
    });
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

    const shown = demo ? applyDemo(+demo[1]) : null;

    UI.relabel();
    if (shown && shown.tab) UI.switchTab(shown.tab);
    UI.bootDone();
    SDK.ready();          // платформе: игра готова, можно играть
    SDK.gameplayStart();

    // Возвращение с накопленным офлайном — лучший момент предложить рекламу:
    // игроку показывают уже заработанное и дают удвоить. Смотрит он по своей
    // воле и ради очевидной выгоды, а это и есть условие высокой ставки за
    // просмотр и отсутствия вреда для удержания.
    if (offline && offline.ore > 0 && !DEMO_MODE) {
      const gained = offline.ore;
      UI.modal(
        I18N.t('welcome_title'),
        I18N.t('welcome_text', { depth: DATA.fmt(offline.depth), ore: DATA.fmt(gained) }),
        {
          label: '📺 ' + I18N.t('boost_offline', { amount: DATA.fmt(gained) }),
          run: () => SDK.rewarded(() => {
            State.raw.ore += gained;
            Sound.buy();
            save();
            UI.refreshHud();
            UI.toast('✅ +' + DATA.fmt(gained));
          })
        }
      );
    }

    setInterval(slowRefresh, 200);
    last = performance.now();
    requestAnimationFrame(frame);
  }

  boot();
})();
