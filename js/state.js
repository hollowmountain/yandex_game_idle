// Состояние игры и все производные величины.
const State = (() => {

  const BOOST_MS = 4 * 3600 * 1000; // ×2 на 4 часа за просмотр рекламы

  let s = fresh();

  function fresh(keepCores = 0) {
    return {
      v: 1,
      depth: 0,
      ore: 0,
      cores: keepCores,
      drills: {},
      upgrades: {},
      boostUntil: 0,
      lastSeen: Date.now(),
      lang: null,
      muted: false
    };
  }

  /* ---------- производные множители ---------- */

  const coreMult   = () => 1 + s.cores * DATA.CORE_BONUS;
  const boostMult  = () => (s.boostUntil > Date.now() ? 2 : 1);
  const speedMult  = () => Math.pow(1.25, s.upgrades.speed || 0);
  const valueMult  = () => Math.pow(1.20, s.upgrades.value || 0) * coreMult();
  const clickPower = () => Math.pow(2, s.upgrades.click || 0) * coreMult() * boostMult();

  // Метров в секунду от всех буров
  function rate() {
    let r = 0;
    for (const d of DATA.DRILLS) r += d.rate * (s.drills[d.id] || 0);
    return r * speedMult() * boostMult();
  }

  // Сколько руды приносит один метр на текущей глубине
  function orePerMeter(depth = s.depth) {
    return DATA.layerAt(depth).value * valueMult();
  }

  /* ---------- продвижение вглубь ---------- */

  // Проходим метры порциями до границы слоя, чтобы руда считалась честно
  // и на офлайн-прогрессе тоже.
  function advance(meters) {
    let left = meters, earned = 0, guard = 0;
    while (left > 0 && guard++ < 500) {
      const boundary = DATA.nextLayerFrom(s.depth);
      const step = Math.min(left, Math.max(boundary - s.depth, 0.0001));
      earned += step * orePerMeter();
      s.depth += step;
      left -= step;
    }
    s.ore += earned;
    return earned;
  }

  function tick(dtSeconds) {
    const meters = rate() * dtSeconds;
    return meters > 0 ? { meters, ore: advance(meters) } : null;
  }

  function click() {
    const meters = clickPower();
    return { meters, ore: advance(meters) };
  }

  /* ---------- покупки ---------- */

  function drillCount(id) { return s.drills[id] || 0; }
  function upgLevel(id)   { return s.upgrades[id] || 0; }

  function buyDrill(id) {
    const d = DATA.DRILLS.find(x => x.id === id);
    if (!d) return false;
    const cost = DATA.drillCost(d, drillCount(id));
    if (s.ore < cost) return false;
    s.ore -= cost;
    s.drills[id] = drillCount(id) + 1;
    return true;
  }

  function buyUpgrade(id) {
    const u = DATA.UPGRADES.find(x => x.id === id);
    if (!u) return false;
    const lvl = upgLevel(id);
    if (lvl >= u.max) return false;
    const cost = DATA.upgradeCost(u, lvl);
    if (s.ore < cost) return false;
    s.ore -= cost;
    s.upgrades[id] = lvl + 1;
    return true;
  }

  /* ---------- ядро (престиж) ---------- */

  const canSmelt = () => s.depth >= DATA.CORE_DEPTH;

  function smelt() {
    if (!canSmelt()) return false;
    const cores = s.cores + 1;
    const lang = s.lang, muted = s.muted;
    s = fresh(cores);
    s.lang = lang;
    s.muted = muted;
    return true;
  }

  /* ---------- бусты ---------- */

  function grantBoost() {
    const base = Math.max(s.boostUntil, Date.now());
    s.boostUntil = base + BOOST_MS;
  }

  const boostLeft = () => Math.max(0, s.boostUntil - Date.now());

  /* ---------- офлайн ---------- */

  // Считаем, сколько накопали, пока игрока не было. Ограничено потолком,
  // чтобы вернуться через неделю не означало «игра пройдена».
  function applyOffline() {
    const now = Date.now();
    const elapsed = Math.min(now - (s.lastSeen || now), DATA.OFFLINE_CAP_H * 3600 * 1000);
    s.lastSeen = now;
    if (elapsed < 60000 || rate() <= 0) return null;

    const before = { depth: s.depth, ore: s.ore };
    // моделируем секундами крупными шагами — точности достаточно
    const seconds = elapsed / 1000;
    const meters = rate() * seconds;
    advance(meters);
    return { depth: s.depth - before.depth, ore: s.ore - before.ore, seconds };
  }

  /* ---------- сохранение ---------- */

  function serialize() {
    s.lastSeen = Date.now();
    return s;
  }

  function hydrate(raw) {
    if (!raw || typeof raw !== 'object') return false;
    const base = fresh();
    s = Object.assign(base, raw);
    s.drills = Object.assign({}, raw.drills || {});
    s.upgrades = Object.assign({}, raw.upgrades || {});
    // защита от битого сейва
    if (!isFinite(s.depth) || s.depth < 0) s.depth = 0;
    if (!isFinite(s.ore) || s.ore < 0) s.ore = 0;
    if (!isFinite(s.cores) || s.cores < 0) s.cores = 0;
    return true;
  }

  return {
    get raw() { return s; },
    fresh, tick, click, advance,
    rate, orePerMeter, clickPower, coreMult, boostMult, valueMult,
    drillCount, upgLevel, buyDrill, buyUpgrade,
    canSmelt, smelt,
    grantBoost, boostLeft,
    applyOffline, serialize, hydrate
  };
})();
