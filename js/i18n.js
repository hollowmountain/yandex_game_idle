// Все тексты игры в одном месте. Добавить язык = добавить ключ в DICT.
const I18N = (() => {
  const DICT = {
    ru: {
      depth: 'Глубина', ore: 'Руда', dig: 'КОПАТЬ',
      tab_drills: 'Буры', tab_upgrades: 'Улучшения', tab_core: 'Ядро',
      ok: 'Продолжить',
      per_sec: 'м/с', meters: 'м',
      hardness: 'твёрдость ×{n}',
      owned: 'шт',
      buy_locked: 'Копай глубже',
      boost_x2: '×2 добыча',
      boost_x2_on: '×2 · {time}',
      boost_offline: 'Удвоить {amount}',
      upg_click_name: 'Крепче кирка',
      upg_click_desc: 'Удваивает добычу за нажатие',
      upg_speed_name: 'Смазка буров',
      upg_speed_desc: 'Все буры +25% к скорости',
      upg_value_name: 'Сортировка породы',
      upg_value_desc: 'Руды с метра +20%',
      core_title: 'Переплавка ядра',
      core_desc: 'Дойди до {depth} м, чтобы переплавить ядро. Прогресс сбросится, но каждое ядро даёт +{bonus}% ко всей добыче навсегда.',
      core_ready: 'Переплавить ядро',
      core_have: 'Ядер собрано: {n} · бонус +{bonus}%',
      core_locked: 'До ядра осталось {left} м',
      welcome_title: 'С возвращением',
      welcome_text: 'Пока тебя не было, буры прошли {depth} м и добыли {ore} руды.',
      reset_title: 'Ядро переплавлено',
      reset_text: 'Ты начинаешь заново, но теперь вся добыча идёт с бонусом +{bonus}%.',
      lang_code: 'RU'
    },
    en: {
      depth: 'Depth', ore: 'Ore', dig: 'DIG',
      tab_drills: 'Drills', tab_upgrades: 'Upgrades', tab_core: 'Core',
      ok: 'Continue',
      per_sec: 'm/s', meters: 'm',
      hardness: 'hardness ×{n}',
      owned: 'x',
      buy_locked: 'Dig deeper',
      boost_x2: '×2 output',
      boost_x2_on: '×2 · {time}',
      boost_offline: 'Double {amount}',
      upg_click_name: 'Harder Pick',
      upg_click_desc: 'Doubles ore per tap',
      upg_speed_name: 'Drill Grease',
      upg_speed_desc: 'All drills +25% speed',
      upg_value_name: 'Ore Sorting',
      upg_value_desc: '+20% ore per meter',
      core_title: 'Core Smelting',
      core_desc: 'Reach {depth} m to smelt the core. Progress resets, but every core grants +{bonus}% to all output forever.',
      core_ready: 'Smelt the core',
      core_have: 'Cores collected: {n} · bonus +{bonus}%',
      core_locked: '{left} m left to the core',
      welcome_title: 'Welcome back',
      welcome_text: 'While you were away the drills went {depth} m deep and mined {ore} ore.',
      reset_title: 'Core smelted',
      reset_text: 'You start over, but every bit of output now carries a +{bonus}% bonus.',
      lang_code: 'EN'
    }
  };

  let lang = 'ru';

  function detect(sdkLang) {
    const raw = sdkLang || navigator.language || 'ru';
    return raw.slice(0, 2) === 'ru' ? 'ru' : 'en';
  }

  function t(key, vars) {
    let s = (DICT[lang] && DICT[lang][key]) || DICT.ru[key] || key;
    if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
    return s;
  }

  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
  }

  return {
    t, apply,
    get lang() { return lang; },
    set(l) { lang = DICT[l] ? l : 'ru'; apply(); },
    detect,
    toggle() { I18N.set(lang === 'ru' ? 'en' : 'ru'); return lang; }
  };
})();
