// Весь DOM-слой: HUD, вкладки, карточки покупок, бусты, модалка, тосты.
const UI = (() => {

  const $ = id => document.getElementById(id);
  const el = {};
  let activeTab = 'drills';
  let onSmelt = () => {};
  let onWatchBoost = () => {};
  let onBuy = () => {};
  let onDoubleOffline = null;

  // Карточки живут между кадрами и обновляются по месту. Пересобирать их на
  // каждом обновлении нельзя: панель освежается пять раз в секунду, и любая
  // анимация покупки умирала бы, не начавшись, а браузер лишний раз считал бы
  // раскладку десяти узлов.
  const drillCards = new Map();
  const upgCards = new Map();
  let listsReady = false;

  function init(hooks) {
    onSmelt = hooks.onSmelt;
    onWatchBoost = hooks.onWatchBoost;
    onBuy = hooks.onBuy || (() => {});

    ['v-depth','v-ore','v-layer','v-rate','v-progress','v-clickpower',
     'boosts','tab-drills','tab-upgrades','tab-core','toasts',
     'modal','modal-title','modal-text','modal-ok','modal-bonus',
     'btn-lang','btn-sound','btn-pause','dig','app','boot'].forEach(id => el[id] = $(id));

    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });

    el['modal-ok'].addEventListener('click', closeModal);
    el['modal-bonus'].addEventListener('click', () => {
      const fn = onDoubleOffline;
      closeModal();
      if (fn) fn();
    });

    // Игровое поле не должно вызывать системное меню — требование модерации
    document.addEventListener('contextmenu', e => e.preventDefault());
  }

  function switchTab(name) {
    activeTab = name;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    ['drills','upgrades','core'].forEach(n => { el['tab-' + n].hidden = (n !== name); });
    refreshPanel();
  }

  /* ---------- HUD ---------- */

  // Глубина подпрыгивает на каждом новом порядке — мелкая, но заметная
  // награда за то, что счётчик перевалил круглую отметку.
  let lastTier = -1;
  function popDepth(depth) {
    const tier = depth < 10 ? 0 : Math.floor(Math.log10(depth));
    if (tier === lastTier) return;
    if (lastTier >= 0 && tier > lastTier) {
      const n = el['v-depth'];
      n.classList.remove('pop');
      void n.offsetWidth;            // перезапуск анимации
      n.classList.add('pop');
    }
    lastTier = tier;
  }

  function refreshHud() {
    const s = State.raw;
    const layer = DATA.layerAt(s.depth);
    const from = layer.from;
    const to = DATA.nextLayerFrom(s.depth);
    const pct = Math.min(100, ((s.depth - from) / (to - from)) * 100);

    popDepth(s.depth);
    el['v-depth'].textContent = DATA.fmt(s.depth) + ' ' + I18N.t('meters');
    el['v-ore'].textContent = DATA.fmt(s.ore);
    // Твёрдость показываем рядом со слоем: без неё падение м/с на новом слое
    // выглядит как поломка, а не как «порода стала крепче».
    el['v-layer'].textContent = (layer[I18N.lang] || layer.ru) +
      (layer.hard > 1 ? ' · ' + I18N.t('hardness', { n: DATA.fmt(layer.hard) }) : '');
    el['v-rate'].textContent = DATA.fmt(State.rate()) + ' ' + I18N.t('per_sec');
    el['v-progress'].style.width = pct + '%';
    el['v-clickpower'].textContent = '+' + DATA.fmt(State.clickMeters()) + ' ' + I18N.t('meters');
  }

  /* ---------- карточки ---------- */

  function buildCard() {
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML =
      '<span class="card-icon"></span>' +
      '<span><span class="card-name"></span><span class="card-desc"></span></span>' +
      '<span class="card-count"><span class="card-cost"></span><br><span class="card-n"></span></span>';
    b.el = {
      icon: b.querySelector('.card-icon'),
      name: b.querySelector('.card-name'),
      desc: b.querySelector('.card-desc'),
      cost: b.querySelector('.card-cost'),
      n: b.querySelector('.card-n')
    };
    return b;
  }

  function fillCard(b, o) {
    if (b.el.icon.textContent !== o.icon) b.el.icon.textContent = o.icon;
    if (b.el.name.textContent !== o.name) b.el.name.textContent = o.name;
    if (b.el.desc.textContent !== o.desc) b.el.desc.textContent = o.desc;
    if (b.el.cost.textContent !== o.cost) b.el.cost.textContent = o.cost;
    const nn = String(o.count);
    if (b.el.n.textContent !== nn) b.el.n.textContent = nn;
    b.disabled = !o.afford;
    b.classList.toggle('can', !!o.afford);
  }

  function flashBought(b) {
    b.classList.remove('bought');
    void b.offsetWidth;
    b.classList.add('bought');
  }

  function renderDrills() {
    const box = el['tab-drills'];
    const s = State.raw;
    const visible = DATA.DRILLS.filter(d => s.depth >= d.unlock || State.drillCount(d.id) > 0);

    for (const d of visible) {
      const owned = State.drillCount(d.id);
      const cost = DATA.drillCost(d, owned);
      let b = drillCards.get(d.id);
      if (!b) {
        b = buildCard();
        drillCards.set(d.id, b);
        box.appendChild(b);
        b.addEventListener('click', () => {
          if (!State.buyDrill(d.id)) return;
          flashBought(b);
          onBuy();
          refreshPanel();
          refreshHud();
        });
        // Открытие нового бура — событие, о нём надо сказать вслух. На самом
        // первом построении списка молчим, иначе игрока встречает пачка тостов.
        if (listsReady) {
          b.classList.add('fresh');
          toast('🔓 ' + I18N.t('unlocked') + ': ' + (d[I18N.lang] || d.ru));
        }
      }
      fillCard(b, {
        icon: d.icon,
        name: d[I18N.lang] || d.ru,
        desc: '+' + DATA.fmt(d.rate) + ' ' + I18N.t('per_sec'),
        cost: DATA.fmt(cost),
        count: owned,
        afford: s.ore >= cost
      });
    }

    // после переплавки часть буров снова прячется
    const alive = new Set(visible.map(d => d.id));
    for (const [id, b] of drillCards) {
      if (!alive.has(id)) { b.remove(); drillCards.delete(id); }
    }

    if (!visible.length && !box.querySelector('.empty')) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = I18N.t('buy_locked');
      box.appendChild(e);
    } else if (visible.length) {
      const e = box.querySelector('.empty');
      if (e) e.remove();
    }
  }

  function renderUpgrades() {
    const box = el['tab-upgrades'];
    const s = State.raw;
    for (const u of DATA.UPGRADES) {
      const lvl = State.upgLevel(u.id);
      const maxed = lvl >= u.max;
      const cost = DATA.upgradeCost(u, lvl);
      let b = upgCards.get(u.id);
      if (!b) {
        b = buildCard();
        upgCards.set(u.id, b);
        box.appendChild(b);
        b.addEventListener('click', () => {
          if (!State.buyUpgrade(u.id)) return;
          flashBought(b);
          onBuy();
          refreshPanel();
          refreshHud();
        });
      }
      fillCard(b, {
        icon: u.icon,
        name: I18N.t(u.key + '_name'),
        desc: I18N.t(u.key + '_desc'),
        cost: maxed ? 'MAX' : DATA.fmt(cost),
        count: lvl + '/' + u.max,
        afford: !maxed && s.ore >= cost
      });
    }
  }

  function renderCore() {
    const box = el['tab-core'];
    box.innerHTML = '';
    const s = State.raw;
    const bonus = Math.round(s.cores * DATA.CORE_BONUS * 100);

    const info = document.createElement('div');
    info.className = 'empty';
    info.innerHTML =
      '<b>' + I18N.t('core_title') + '</b><br><br>' +
      I18N.t('core_desc', { depth: DATA.fmt(DATA.CORE_DEPTH), bonus: Math.round(DATA.CORE_BONUS * 100) }) +
      '<br><br>' + I18N.t('core_have', { n: s.cores, bonus });
    box.appendChild(info);

    const ready = State.canSmelt();
    const b = buildCard();
    fillCard(b, {
      icon: '🔆',
      name: ready ? I18N.t('core_ready') : I18N.t('core_locked', { left: DATA.fmt(DATA.CORE_DEPTH - s.depth) }),
      desc: '+' + Math.round(DATA.CORE_BONUS * 100) + '%',
      cost: ready ? '✓' : '🔒',
      count: s.cores,
      afford: ready
    });
    if (ready) b.addEventListener('click', onSmelt);
    box.appendChild(b);
  }

  function refreshPanel() {
    if (activeTab === 'drills') renderDrills();
    else if (activeTab === 'upgrades') renderUpgrades();
    else renderCore();
    listsReady = true;
  }

  /* ---------- бусты ---------- */

  let boostBtn = null;
  function refreshBoosts() {
    const left = State.boostLeft();
    if (!boostBtn) {
      boostBtn = document.createElement('button');
      boostBtn.className = 'boost';
      boostBtn.addEventListener('click', onWatchBoost);
      el.boosts.appendChild(boostBtn);
    }
    boostBtn.classList.toggle('active', left > 0);
    const txt = left > 0
      ? I18N.t('boost_x2_on', { time: DATA.fmtTime(left) })
      : '📺 ' + I18N.t('boost_x2');
    if (boostBtn.textContent !== txt) boostBtn.textContent = txt;
  }

  /* ---------- тосты ---------- */

  function toast(text) {
    // Больше трёх на экране — уже стена текста поверх игры. Такое возможно,
    // когда рывок глубины открывает несколько буров разом.
    while (el.toasts.children.length >= 3) el.toasts.firstChild.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    el.toasts.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 340);
    }, 2600);
  }

  /* ---------- мелочи ---------- */

  function floater(x, y, text) {
    const f = document.createElement('div');
    f.className = 'floater';
    f.textContent = text;
    f.style.left = x + 'px';
    f.style.top = y + 'px';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 760);
  }

  // bonus = { label, run } — необязательная кнопка награды за рекламу.
  function modal(title, text, bonus) {
    el['modal-title'].textContent = title;
    el['modal-text'].textContent = text;
    if (bonus) {
      el['modal-bonus'].textContent = bonus.label;
      el['modal-bonus'].hidden = false;
      onDoubleOffline = bonus.run;
    } else {
      el['modal-bonus'].hidden = true;
      onDoubleOffline = null;
    }
    el.modal.hidden = false;
  }

  function closeModal() {
    el.modal.hidden = true;
    onDoubleOffline = null;
  }

  function bootDone() {
    el.app.hidden = false;
    el.boot.classList.add('gone');
    setTimeout(() => el.boot.remove(), 400);
    Render.resize();
    Render.relayout();
  }

  function relabel() {
    I18N.apply();
    el['btn-lang'].textContent = I18N.t('lang_code');
    refreshHud();
    refreshPanel();
    refreshBoosts();
  }

  // Переплавка сбрасывает прогресс: списки надо построить заново, иначе
  // останутся карточки буров, которых у игрока больше нет.
  function resetLists() {
    drillCards.forEach(b => b.remove()); drillCards.clear();
    upgCards.forEach(b => b.remove()); upgCards.clear();
    listsReady = false;
    lastTier = -1;
  }

  return {
    init, refreshHud, refreshPanel, refreshBoosts, relabel, resetLists,
    floater, modal, closeModal, toast, bootDone, switchTab,
    get el() { return el; }
  };
})();
