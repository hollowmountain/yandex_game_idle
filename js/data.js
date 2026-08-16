// Баланс игры. Все числа для настройки — здесь и только здесь.
const DATA = (() => {

  // Слои породы. from — глубина в метрах, value — руды за метр.
  const LAYERS = [
    { from: 0,     value: 1,    color: '#6b4f3a', dark: '#4c3728', ru: 'Почва',      en: 'Soil'      },
    { from: 60,    value: 2,    color: '#8a6240', dark: '#63462d', ru: 'Глина',      en: 'Clay'      },
    { from: 180,   value: 5,    color: '#63636e', dark: '#45454e', ru: 'Камень',     en: 'Stone'     },
    { from: 450,   value: 12,   color: '#35353c', dark: '#232328', ru: 'Уголь',      en: 'Coal'      },
    { from: 1000,  value: 30,   color: '#8a5f4d', dark: '#5f4135', ru: 'Железо',     en: 'Iron'      },
    { from: 2000,  value: 80,   color: '#b08a2e', dark: '#7d6120', ru: 'Золото',     en: 'Gold'      },
    { from: 3600,  value: 200,  color: '#3f7ca8', dark: '#2b5875', ru: 'Кристаллы',  en: 'Crystals'  },
    { from: 6000,  value: 500,  color: '#3a2b4a', dark: '#281d33', ru: 'Обсидиан',   en: 'Obsidian'  },
    { from: 9000,  value: 1200, color: '#a83c1e', dark: '#752915', ru: 'Магма',      en: 'Magma'     }
  ];

  const CORE_DEPTH = 12000;   // глубина, на которой доступна переплавка
  const CORE_BONUS = 0.25;    // +25% ко всей добыче за каждое ядро
  const COST_SCALE = 1.15;    // удорожание каждой следующей копии бура
  const OFFLINE_CAP_H = 4;    // максимум офлайн-накопления, часов

  // Буры: пассивная добыча в метрах в секунду.
  const DRILLS = [
    { id: 'auger',  icon: '🔩', cost: 15,      rate: 0.2,   unlock: 0,    ru: 'Ручной бур',       en: 'Hand Auger'    },
    { id: 'jack',   icon: '⚒️', cost: 140,     rate: 1.2,   unlock: 60,   ru: 'Отбойник',         en: 'Jackhammer'    },
    { id: 'exca',   icon: '🚜', cost: 1600,    rate: 6,     unlock: 180,  ru: 'Экскаватор',       en: 'Excavator'     },
    { id: 'plasma', icon: '🔥', cost: 22000,   rate: 30,    unlock: 450,  ru: 'Плазменный резак', en: 'Plasma Cutter' },
    { id: 'borer',  icon: '🚂', cost: 3e5,     rate: 160,   unlock: 1000, ru: 'Тоннельный комбайн', en: 'Tunnel Borer' },
    { id: 'grav',   icon: '🛸', cost: 4.5e6,   rate: 900,   unlock: 2000, ru: 'Гравибур',         en: 'Gravity Drill' },
    { id: 'anni',   icon: '⚛️', cost: 7e7,     rate: 5000,  unlock: 3600, ru: 'Аннигилятор',      en: 'Annihilator'   },
    { id: 'rift',   icon: '🌀', cost: 1.2e9,   rate: 30000, unlock: 6000, ru: 'Разлом',           en: 'Rift Engine'   }
  ];

  // Улучшения: множители. max — сколько раз можно купить.
  const UPGRADES = [
    { id: 'click', icon: '⛏️', cost: 100,  scale: 4, max: 20, key: 'upg_click' },
    { id: 'speed', icon: '🛢️', cost: 500,  scale: 5, max: 12, key: 'upg_speed' },
    { id: 'value', icon: '⚖️', cost: 2000, scale: 6, max: 12, key: 'upg_value' }
  ];

  function layerAt(depth) {
    let l = LAYERS[0];
    for (const layer of LAYERS) if (depth >= layer.from) l = layer;
    return l;
  }

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

  // Компактная запись больших чисел: 1.2K, 8.4M, 3.1B...
  const SUFFIX = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae'];
  function fmt(n) {
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
    layerAt, nextLayerFrom, drillCost, upgradeCost, fmt, fmtTime
  };
})();
