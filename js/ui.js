// Весь DOM-слой: HUD, вкладки, карточки покупок, бусты, модалка.
const UI = (() => {

  const $ = id => document.getElementById(id);
  const el = {};
  let activeTab = 'drills';
  let onSmelt = () => {};
  let onWatchBoost = () => {};

  function init(hooks) {
    onSmelt = hooks.onSmelt;
    onWatchBoost = hooks.onWatchBoost;

    ['v-depth','v-ore','v-layer','v-rate','v-progress','v-clickpower',
     'boosts','tab-drills','tab-upgrades','tab-core',
     'modal','modal-title','modal-text','modal-ok',
     'btn-lang','btn-sound','btn-pause','dig','app','boot'].forEach(id => el[id] = $(id));

    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });

    el['modal-ok'].addEventListener('click', () => { el.modal.hidden = true; });

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

  function refreshHud() {
    const s = State.raw;
    const layer = DATA.layerAt(s.depth);
    const from = layer.from;
    const to = DATA.nextLayerFrom(s.depth);
    const pct = Math.min(100, ((s.depth - from) / (to - from)) * 100);

    el['v-depth'].textContent = DATA.fmt(s.depth) + ' ' + I18N.t('meters');
    el['v-ore'].textContent = DATA.fmt(s.ore);
    el['v-layer'].textContent = layer[I18N.lang] || layer.ru;
    el['v-rate'].textContent = DATA.fmt(State.rate()) + ' ' + I18N.t('per_sec');
    el['v-progress'].style.width = pct + '%';
    el['v-clickpower'].textContent = '+' + DATA.fmt(State.clickPower()) + ' ' + I18N.t('meters');
  }

  /* ---------- карточки ---------- */

  function card({ icon, name, desc, cost, count, disabled, onClick, locked }) {
    const b = document.createElement('button');
    b.className = 'card';
    b.disabled = !!disabled;
    b.innerHTML =
      '<span class="card-icon"></span>' +
      '<span><span class="card-name"></span><span class="card-desc"></span></span>' +
      (count !== undefined
        ? '<span class="card-count"></span>'
        : '<span class="card-cost"></span>');
    b.querySelector('.card-icon').textContent = icon;
    b.querySelector('.card-name').textContent = name;
    const d = b.querySelector('.card-desc');
    d.textContent = locked ? I18N.t('buy_locked') : desc;
    d.style.display = 'block';
    if (count !== undefined) {
      b.querySelector('.card-count').innerHTML =
        '<span class="card-cost">' + cost + '</span><br>' + count;
    } else {
      b.querySelector('.card-cost').textContent = cost;
    }
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function renderDrills() {
    const box = el['tab-drills'];
    box.innerHTML = '';
    const s = State.raw;
    const visible = DATA.DRILLS.filter(d => s.depth >= d.unlock || State.drillCount(d.id) > 0);
    if (!visible.length) {
      box.innerHTML = '<div class="empty">' + I18N.t('buy_locked') + '</div>';
      return;
    }
    for (const d of visible) {
      const owned = State.drillCount(d.id);
      const cost = DATA.drillCost(d, owned);
      box.appendChild(card({
        icon: d.icon,
        name: d[I18N.lang] || d.ru,
        desc: '+' + DATA.fmt(d.rate) + ' ' + I18N.t('per_sec'),
        cost: DATA.fmt(cost),
        count: owned,
        disabled: s.ore < cost,
        onClick: () => { if (State.buyDrill(d.id)) { refreshPanel(); refreshHud(); } }
      }));
    }
  }

  function renderUpgrades() {
    const box = el['tab-upgrades'];
    box.innerHTML = '';
    const s = State.raw;
    for (const u of DATA.UPGRADES) {
      const lvl = State.upgLevel(u.id);
      const maxed = lvl >= u.max;
      const cost = DATA.upgradeCost(u, lvl);
      box.appendChild(card({
        icon: u.icon,
        name: I18N.t(u.key + '_name'),
        desc: I18N.t(u.key + '_desc'),
        cost: maxed ? 'MAX' : DATA.fmt(cost),
        count: lvl + '/' + u.max,
        disabled: maxed || s.ore < cost,
        onClick: () => { if (State.buyUpgrade(u.id)) { refreshPanel(); refreshHud(); } }
      }));
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
    box.appendChild(card({
      icon: '🔆',
      name: ready ? I18N.t('core_ready') : I18N.t('core_locked', { left: DATA.fmt(DATA.CORE_DEPTH - s.depth) }),
      desc: '+' + Math.round(DATA.CORE_BONUS * 100) + '%',
      cost: ready ? '✓' : '🔒',
      disabled: !ready,
      onClick: () => { if (ready) onSmelt(); }
    }));
  }

  function refreshPanel() {
    if (activeTab === 'drills') renderDrills();
    else if (activeTab === 'upgrades') renderUpgrades();
    else renderCore();
  }

  /* ---------- бусты ---------- */

  function refreshBoosts() {
    const box = el.boosts;
    const left = State.boostLeft();
    box.innerHTML = '';
    const b = document.createElement('button');
    b.className = 'boost' + (left > 0 ? ' active' : '');
    b.textContent = left > 0
      ? I18N.t('boost_x2_on', { time: DATA.fmtTime(left) })
      : '📺 ' + I18N.t('boost_x2');
    b.addEventListener('click', onWatchBoost);
    box.appendChild(b);
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

  function modal(title, text) {
    el['modal-title'].textContent = title;
    el['modal-text'].textContent = text;
    el.modal.hidden = false;
  }

  function bootDone() {
    el.app.hidden = false;
    el.boot.classList.add('gone');
    setTimeout(() => el.boot.remove(), 400);
    Render.resize();
  }

  function relabel() {
    I18N.apply();
    el['btn-lang'].textContent = I18N.t('lang_code');
    refreshHud();
    refreshPanel();
    refreshBoosts();
  }

  return {
    init, refreshHud, refreshPanel, refreshBoosts, relabel,
    floater, modal, bootDone, switchTab,
    get el() { return el; }
  };
})();
