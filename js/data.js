// Баланс игры. Все числа для настройки — здесь и только здесь.
const DATA = (() => {

  // Слои породы.
  //   from  — глубина в метрах, с которой слой начинается
  //   value — руды за метр
  //   hard  — твёрдость: во столько раз медленнее идёт здесь любой бур
  //
  // Твёрдость — это то, что вообще делает игру игрой. Без неё скорость буров
  // растёт неограниченно, а шкала глубины конечна, поэтому верхние буры
  // проходят всю игру за секунды и половина контента становится мертвечиной.
  // Твёрдость растёт вместе с ценой метра: глубже — дороже руда, но и
  // медленнее проходка, и за счёт этого каждый слой стоит игроку сравнимого
  // времени, а каждый следующий бур снова ощущается нужным.
  //   style — характер породы, по нему рендер выбирает способ рисования
  //   vein  — цвет рудной жилы, вкраплений и осколков этого слоя
  const LAYERS = [
    { from: 0,     value: 1,     hard: 1,     style: 'soil',    color: '#6b4f3a', dark: '#4c3728', vein: '#a28a5c', ru: 'Почва',     en: 'Soil'       },
    { from: 150,   value: 4,     hard: 2.6,   style: 'clay',    color: '#8a6240', dark: '#63462d', vein: '#c39a63', ru: 'Глина',     en: 'Clay'       },
    { from: 600,   value: 17,    hard: 7,     style: 'stone',   color: '#63636e', dark: '#45454e', vein: '#a8b0bd', ru: 'Камень',    en: 'Stone'      },
    { from: 2.2e3, value: 75,    hard: 19,    style: 'coal',    color: '#35353c', dark: '#1e1e23', vein: '#6f7a86', ru: 'Уголь',     en: 'Coal'       },
    { from: 7.5e3, value: 340,   hard: 52,    style: 'metal',   color: '#8a5f4d', dark: '#5f4135', vein: '#e8a37a', ru: 'Железо',    en: 'Iron'       },
    { from: 2.4e4, value: 1.6e3, hard: 145,   style: 'metal',   color: '#b08a2e', dark: '#7d6120', vein: '#ffd964', ru: 'Золото',    en: 'Gold'       },
    { from: 7e4,   value: 7.5e3, hard: 400,   style: 'crystal', color: '#3f7ca8', dark: '#2b5875', vein: '#8fe3ff', ru: 'Кристаллы', en: 'Crystals'   },
    { from: 1.9e5, value: 3.4e4, hard: 1.1e3, style: 'glass',   color: '#3a2b4a', dark: '#211830', vein: '#b98cff', ru: 'Обсидиан',  en: 'Obsidian'   },
    { from: 4.8e5, value: 1.6e5, hard: 5e3,   style: 'magma',   color: '#a83c1e', dark: '#5e2010', vein: '#ffb257', hot: .45, ru: 'Магма',     en: 'Magma'      },
    { from: 1.1e6, value: 3e6,   hard: 4.5e4, style: 'magma',   color: '#c2532a', dark: '#6d2812', vein: '#ffc46b', hot: .65, ru: 'Мантия',    en: 'Mantle'     },
    { from: 2.4e6, value: 1.4e8, hard: 1.2e6, style: 'magma',   color: '#e07a2f', dark: '#8a3d12', vein: '#ffdf8f', hot: .85, ru: 'Внешнее ядро', en: 'Outer Core' },
    { from: 4.5e6, value: 3.5e9, hard: 1.6e7, style: 'magma',   color: '#ffb347', dark: '#b06318', vein: '#fff3c4', hot: 1,   ru: 'Оболочка ядра', en: 'Core Shell' }
  ];

  // Реальный радиус Земли — до центра планеты ровно столько.
  const CORE_DEPTH = 6371000; // глубина, на которой доступна переплавка
  const CORE_BONUS = 0.25;    // +25% ко всей добыче за каждое ядро
  const COST_SCALE = 1.15;    // удорожание каждой следующей копии бура
  const OFFLINE_CAP_H = 8;    // максимум офлайн-накопления, часов

  // Буры: пассивная добыча в метрах в секунду.
  const DRILLS = [
    { id: 'auger',  icon: '🔩', cost: 15,     rate: 0.3,   unlock: 0,     ru: 'Ручной бур',         en: 'Hand Auger'    },
    { id: 'jack',   icon: '⚒️', cost: 250,    rate: 2.2,   unlock: 150,   ru: 'Отбойник',           en: 'Jackhammer'    },
    { id: 'exca',   icon: '🚜', cost: 4.5e3,  rate: 16,    unlock: 600,   ru: 'Экскаватор',         en: 'Excavator'     },
    { id: 'plasma', icon: '🔥', cost: 9e4,    rate: 120,   unlock: 2.2e3, ru: 'Плазменный резак',   en: 'Plasma Cutter' },
    { id: 'borer',  icon: '🚂', cost: 1.8e6,  rate: 900,   unlock: 7.5e3, ru: 'Тоннельный комбайн', en: 'Tunnel Borer'  },
    { id: 'grav',   icon: '🛸', cost: 3.6e7,  rate: 6.5e3, unlock: 2.4e4, ru: 'Гравибур',           en: 'Gravity Drill' },
    { id: 'anni',   icon: '⚛️', cost: 7.5e8,  rate: 5e4,   unlock: 7e4,   ru: 'Аннигилятор',        en: 'Annihilator'   },
    { id: 'rift',   icon: '🌀', cost: 1.6e10, rate: 3.8e5, unlock: 1.9e5, ru: 'Разлом',             en: 'Rift Engine'   },
    { id: 'singu',  icon: '🕳️', cost: 3.5e11, rate: 2.9e6, unlock: 4.8e5, ru: 'Сингулярность',      en: 'Singularity'   },
    { id: 'void',   icon: '🌌', cost: 8e12,   rate: 2.2e7, unlock: 1.1e6, ru: 'Пустотный бур',      en: 'Void Drill'    }
  ];

  // Улучшения: множители. max — сколько раз можно купить.
  //
  // Клик даёт метры напрямую, поэтому его множитель обязан быть скромным.
  // Прежние ×2 за уровень при 20 уровнях давали ×1 000 000 к силе тычка —
  // игрок проскакивал всю игру за пару минут одними нажатиями.
  const UPGRADES = [
    { id: 'click', icon: '⛏️', cost: 60,   scale: 3.1, max: 25, key: 'upg_click' },
    { id: 'speed', icon: '🛢️', cost: 400,  scale: 3.6, max: 20, key: 'upg_speed' },
    { id: 'value', icon: '⚖️', cost: 1500, scale: 4.2, max: 20, key: 'upg_value' }
  ];

  function layerAt(depth) {
    let l = LAYERS[0];
    for (const layer of LAYERS) if (depth >= layer.from) l = layer;
    return l;
  }

  function hardAt(depth) { return layerAt(depth).hard; }

  function nextLayerFrom(depth) {
    for (const layer of LAYERS) if (layer.from > depth) return layer.from;
    return CORE_DEPTH;
  }

  function drillCost(drill, owned) {
    return Math.ceil(drill.cost * Math.pow(COST_SCALE, owned));
  }

  function upgradeCost(upg, level) {
    return Math.ceil(upg.cost * Math.pow(upg.scale, level));
  }

  // Компактная запись больших чисел: 1.2K, 8.4M, 3.1B, дальше aa, ab, ac...
  //
  // Суффиксов нужно с запасом. Цена бура растёт на 15% за копию, и к паре
  // сотен «Пустотных буров» счёт идёт на 10^24 и выше — на коротком списке
  // это вылезало как «1000ae» вместо нормального разряда.
  const SUFFIX = ['', 'K', 'M', 'B', 'T'];
  for (let i = 0; SUFFIX.length < 40; i++) {
    SUFFIX.push(String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + i % 26));
  }
  function fmt(n) {
    if (typeof n !== 'number' || isNaN(n)) return '0';
    if (!isFinite(n)) return '∞';
    if (n < 1000) return (n < 10 && n % 1 !== 0) ? n.toFixed(1) : Math.floor(n).toString();
    const tier = Math.min(Math.floor(Math.log10(n) / 3), SUFFIX.length - 1);
    const scaled = n / Math.pow(1000, tier);
    return (scaled < 100 ? scaled.toFixed(1) : Math.floor(scaled)) + SUFFIX[tier];
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    if (h) return h + ':' + String(m).padStart(2, '0');
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  return {
    LAYERS, DRILLS, UPGRADES, CORE_DEPTH, CORE_BONUS, OFFLINE_CAP_H,
    layerAt, hardAt, nextLayerFrom, drillCost, upgradeCost, fmt, fmtTime
  };
})();
