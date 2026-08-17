// Состояние игры и все производные величины.
const State = (() => {

  const BOOST_MS = 4 * 3600 * 1000;      // ×2 на 4 часа за просмотр рекламы
  const BOOST_CAP_MS = 12 * 3600 * 1000; // но не больше 12 часов в запасе

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
  // Множитель клика умышленно мягкий: тычок добавляет метры напрямую, и
  // любая двойка в основании обгоняет всю шкалу глубины за считанные минуты.
  const clickPower = () => Math.pow(1.55, s.upgrades.click || 0) * coreMult() * boostMult();

  // Паспортная мощность всех буров, до поправки на породу.
  function rawRate() {
    let r = 0;
    for (const d of DATA.DRILLS) r += d.rate * (s.drills[d.id] || 0);
    return r * speedMult() * boostMult();
  }

  const hardness = (depth = s.depth) => DATA.hardAt(depth);

  // Фактические метры в секунду здесь и сейчас. Именно это число видит игрок.
  function rate() {
    return rawRate() / hardness();
  }

  // Сколько руды приносит один метр на текущей глубине
  function orePerMeter(depth = s.depth) {
    return DATA.layerAt(depth).value * valueMult();
  }

  /* ---------- продвижение вглубь ---------- */

  // Проходим метры порциями до границы слоя, чтобы руда считалась честно
  // и на офлайн-прогрессе тоже.
  //
  // nextLayerFrom возвращает границу строго ниже текущей глубины, а когда
  // слои кончились — саму глубину ядра. Ниже ядра границы больше нет, и
  // остаток надо зачесть одним куском: иначе шаг схлопывается в 0.0001,
  // цикл упирается в guard и игрок намертво встаёт на месте.
  function advance(meters) {
    let left = meters, earned = 0, guard = 0;
    while (left > 0 && guard++ < 500) {
      const boundary = DATA.nextLayerFrom(s.depth);
      const gap = boundary - s.depth;
      const step = gap > 0 ? Math.min(left, gap) : left;
      earned += step * orePerMeter();
      s.depth += step;
      left -= step;
    }
    s.ore += earned;
    return earned;
  }

  // Проходка за отрезок времени. Считать по секундам, а не по метрам,
  // обязательно: на границе слоя меняется и твёрдость, и цена метра, поэтому
  // один и тот же час работы даёт разное в разных слоях. Через эту же функцию
  // идёт офлайн — иначе возвращение через восемь часов считалось бы по
  // скорости того слоя, в котором игрок закрыл вкладку.
  function advanceSeconds(seconds) {
    const raw = rawRate();
    if (raw <= 0 || seconds <= 0) return { meters: 0, ore: 0 };

    let left = seconds, meters = 0, ore = 0, guard = 0;
    while (left > 0 && guard++ < 2000) {
      const layer = DATA.layerAt(s.depth);
      const speed = raw / layer.hard;
      const gap = DATA.nextLayerFrom(s.depth) - s.depth;
      // Ниже последней границы слои кончились — досчитываем остаток разом.
      const step = gap > 0 ? Math.min(left, gap / speed) : left;
      const m = speed * step;
      meters += m;
      ore += m * layer.value * valueMult();
      s.depth += m;
      left -= step;
    }
    s.ore += ore;
    return { meters, ore };
  }

  function tick(dtSeconds) {
    const r = advanceSeconds(dtSeconds);
    return r.meters > 0 ? r : null;
  }

  // Тычок тоже упирается в породу: иначе на глубине он обгонял бы весь парк буров.
  // Но обнулять его нельзя — тап это основное действие игры. Поэтому тычок
  // стоит либо силу кирки, либо 0.15 секунды работы всего парка буров, смотря
  // что больше: в начале работает кирка, дальше — доля от буров, и нажатие
  // остаётся осмысленным до самого ядра. Долю держим низкой намеренно —
  // на 0.5 активное закликивание вдвое обгоняло пассивную игру и съедало
  // весь смысл покупать буры.
  // Число вынесено отдельно, потому что его же показывает кнопка: интерфейс
  // не должен обещать метры, которых игрок не получит.
  const clickMeters = () => Math.max(clickPower() / hardness(), rate() * 0.15);

  function click() {
    const meters = clickMeters();
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

  // Буст копится, но не бесконечно: без потолка игрок за один вечер набивает
  // сутки ×2 и потом неделю не возвращается, а нам нужен ежедневный заход.
  function grantBoost() {
    const now = Date.now();
    const base = Math.max(s.boostUntil, now);
    s.boostUntil = Math.min(base + BOOST_MS, now + BOOST_CAP_MS);
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

    const seconds = elapsed / 1000;
    const r = advanceSeconds(seconds);
    return { depth: r.meters, ore: r.ore, seconds };
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
    fresh, tick, click, advance, advanceSeconds,
    rate, rawRate, hardness, orePerMeter, clickPower, clickMeters, coreMult, boostMult, valueMult,
    drillCount, upgLevel, buyDrill, buyUpgrade,
    canSmelt, smelt,
    grantBoost, boostLeft,
    applyOffline, serialize, hydrate
  };
})();
