// Отрисовка шахты.
//
// Картинок в игре нет и не будет: вся графика собирается процедурно прямо в
// браузере. Это держит сборку в десятках килобайт и даёт мгновенную загрузку,
// что напрямую бьётся с требованиями платформы к весу.
//
// Порода рисуется в два прохода. Первый — бесшовный тайл, свой для каждого
// характера породы. Второй — крупные пятна, рудные жилы, друзы и пустоты в
// мировых координатах, ни к какой сетке не привязанные. Без второго прохода
// экран читается как обои: тайл в 256 пикселей укладывается по ширине три
// раза, и глаз мгновенно ловит повтор.
const Render = (() => {

  const TEX = 256;
  const SCREENS_PER_SEC = 0.28; // цель: экран породы примерно за 3.5 секунды

  let cv, ctx, W = 0, H = 0, dpr = 1;
  let bandTop = 0, bandBottom = 0, drillY = 0, colW = 0, layoutAge = 99;
  let windowM = 60;
  let time = 0;

  let chunks = [], sparks = [], dust = [], shards = [];
  let shake = 0, recoil = 0, glow = 0, bitAngle = 0, flash = 0, flashCol = null;
  let banner = null;
  let lastDepth = 0, lastLayer = null;
  let smashed = new Set();   // друзы, которые бур уже разбил

  const texCache = new Map();
  let blobDark = null, blobLight = null;

  /* ---------- мелкая математика ---------- */

  function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(c, a) { const v = Array.isArray(c) ? c : hex(c); return 'rgba(' + (v[0] | 0) + ',' + (v[1] | 0) + ',' + (v[2] | 0) + ',' + a + ')'; }
  function mix(a, b, t) {
    const A = Array.isArray(a) ? a : hex(a), B = Array.isArray(b) ? b : hex(b);
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
  }
  const lighten = (c, t) => mix(c, [255, 255, 255], t);

  // Детерминированный генератор: текстура обязана быть одинаковой в каждой
  // сессии, иначе порода перекрашивается после перезагрузки.
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function seedOf(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // Стабильный шум по двум целым — для всего, что привязано к мировой сетке.
  function hash2(x, y) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }

  /* ---------- заготовки ---------- */

  // Мягкое пятно рисуем один раз в спрайт: радиальный градиент на каждый вызов
  // — самая дорогая операция канваса, а пятен в кадре десятки.
  function makeBlob(col, alpha) {
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rg.addColorStop(0, rgba(col, alpha));
    rg.addColorStop(0.55, rgba(col, alpha * 0.45));
    rg.addColorStop(1, rgba(col, 0));
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    return c;
  }

  /* ---------- текстуры породы ---------- */

  // Каждая фигура рисуется девять раз со сдвигом на тайл, чтобы бесшовно
  // переходить через край.
  function wrapped(x, y, fn) {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        fn(x + dx * TEX, y + dy * TEX);
  }

  function facet(g, layer, rnd, px, py, rad, sides, elong) {
    const n = sides || 5 + Math.floor(rnd() * 3);
    const verts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.2832 + (rnd() - 0.5) * 0.5;
      const r = rad * (0.55 + rnd() * 0.65);
      verts.push([Math.cos(a) * r, Math.sin(a) * r * (elong || 1)]);
    }
    const sh = rnd();
    const col = sh < 0.55 ? mix(layer.color, layer.dark, 0.2 + sh * 1.1)
                          : lighten(layer.color, (sh - 0.55) * 0.42);
    wrapped(px, py, (ox, oy) => {
      g.beginPath();
      verts.forEach((v, k) => k ? g.lineTo(ox + v[0], oy + v[1]) : g.moveTo(ox + v[0], oy + v[1]));
      g.closePath();
      g.fillStyle = rgba(col, 0.8);
      g.fill();
      g.strokeStyle = rgba(layer.dark, 0.55);
      g.lineWidth = 1.2;
      g.stroke();
      g.strokeStyle = rgba(lighten(layer.color, 0.45), 0.3);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(ox + verts[0][0], oy + verts[0][1]);
      g.lineTo(ox + verts[1][0], oy + verts[1][1]);
      g.stroke();
    });
  }

  function crumbs(g, layer, rnd, n) {
    for (let i = 0; i < (n || 300); i++) {
      g.fillStyle = rgba(mix(layer.color, layer.dark, 0.4 + rnd() * 0.6), 0.3 + rnd() * 0.4);
      const s = 0.8 + rnd() * 2;
      wrapped(rnd() * TEX, rnd() * TEX, (ox, oy) => g.fillRect(ox, oy, s, s));
    }
  }

  function flecks(g, layer, rnd, n) {
    for (let i = 0; i < (n || 30); i++) {
      g.fillStyle = rgba(layer.vein, 0.3 + rnd() * 0.45);
      const s = 1.2 + rnd() * 2.4;
      wrapped(rnd() * TEX, rnd() * TEX, (ox, oy) => g.fillRect(ox, oy, s, s * (0.5 + rnd())));
    }
  }

  const PAINT = {
    // Рыхлая земля: окатанные комья и корешки.
    soil(g, layer, rnd) {
      for (let i = 0; i < 40; i++) {
        const r = 8 + rnd() * 22;
        g.fillStyle = rgba(rnd() < 0.5 ? mix(layer.color, layer.dark, 0.3 + rnd() * 0.6)
                                       : lighten(layer.color, rnd() * 0.16), 0.65);
        wrapped(rnd() * TEX, rnd() * TEX, (ox, oy) => {
          g.beginPath(); g.ellipse(ox, oy, r, r * (0.6 + rnd() * 0.5), rnd() * 3, 0, 6.2832); g.fill();
        });
      }
      g.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        let x = rnd() * TEX, y = rnd() * TEX, a = rnd() * 6.2832;
        g.strokeStyle = rgba(mix(layer.dark, [40, 28, 16], 0.5), 0.5);
        g.lineWidth = 0.8 + rnd() * 1.4;
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 4; s++) {
          a += (rnd() - 0.5) * 1.4;
          x += Math.cos(a) * (6 + rnd() * 12); y += Math.sin(a) * (6 + rnd() * 12);
          g.lineTo(x, y);
        }
        g.stroke();
      }
      crumbs(g, layer, rnd, 260); flecks(g, layer, rnd, 18);
    },

    // Глина: гладкие горизонтальные натёки, почти без сколов.
    clay(g, layer, rnd) {
      for (let i = 0; i < 26; i++) {
        const y = rnd() * TEX, h = 5 + rnd() * 16;
        g.fillStyle = rgba(rnd() < 0.5 ? mix(layer.color, layer.dark, 0.25 + rnd() * 0.5)
                                       : lighten(layer.color, rnd() * 0.14), 0.5);
        for (let d = -1; d <= 1; d++) {
          g.beginPath();
          g.moveTo(-4, y + d * TEX);
          for (let x = 0; x <= TEX + 4; x += 16) g.lineTo(x, y + d * TEX + Math.sin(x * 0.05 + i) * 4);
          g.lineTo(TEX + 4, y + d * TEX + h);
          for (let x = TEX + 4; x >= 0; x -= 16) g.lineTo(x, y + d * TEX + h + Math.sin(x * 0.05 + i) * 4);
          g.closePath(); g.fill();
        }
      }
      crumbs(g, layer, rnd, 200); flecks(g, layer, rnd, 16);
    },

    stone(g, layer, rnd) {
      for (let i = 0; i < 34; i++) facet(g, layer, rnd, rnd() * TEX, rnd() * TEX, 14 + rnd() * 24);
      crumbs(g, layer, rnd); flecks(g, layer, rnd, 30);
    },

    // Уголь: плитчатые пласты с зеркальными сколами.
    coal(g, layer, rnd) {
      for (let i = 0; i < 30; i++) {
        const y = rnd() * TEX, h = 3 + rnd() * 11, x = rnd() * TEX, w = 40 + rnd() * 90;
        const sh = rnd();
        g.fillStyle = rgba(sh < 0.6 ? mix(layer.color, layer.dark, sh) : lighten(layer.color, 0.28), 0.85);
        wrapped(x, y, (ox, oy) => {
          g.beginPath();
          g.moveTo(ox, oy); g.lineTo(ox + w, oy - 2); g.lineTo(ox + w, oy + h - 2); g.lineTo(ox, oy + h);
          g.closePath(); g.fill();
          g.fillStyle = rgba([255, 255, 255], 0.09);
          g.fillRect(ox, oy, w, 1.2);
          g.fillStyle = rgba(sh < 0.6 ? mix(layer.color, layer.dark, sh) : lighten(layer.color, 0.28), 0.85);
        });
      }
      crumbs(g, layer, rnd, 240); flecks(g, layer, rnd, 22);
    },

    // Рудный слой: камень, прошитый металлическими прожилками.
    metal(g, layer, rnd) {
      for (let i = 0; i < 30; i++) facet(g, layer, rnd, rnd() * TEX, rnd() * TEX, 13 + rnd() * 22);
      g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        let x = rnd() * TEX, y = rnd() * TEX, a = rnd() * 6.2832;
        const pts = [[x, y]];
        for (let s = 0; s < 5; s++) {
          a += (rnd() - 0.5) * 1.3;
          x += Math.cos(a) * (9 + rnd() * 16); y += Math.sin(a) * (9 + rnd() * 16);
          pts.push([x, y]);
        }
        wrapped(0, 0, (ox, oy) => {
          g.strokeStyle = rgba(layer.vein, 0.3);
          g.lineWidth = 1.4 + rnd() * 1.6;
          g.beginPath();
          pts.forEach((p, k) => k ? g.lineTo(p[0] + ox, p[1] + oy) : g.moveTo(p[0] + ox, p[1] + oy));
          g.stroke();
          g.strokeStyle = rgba(lighten(layer.vein, 0.5), 0.35);
          g.lineWidth = 0.8;
          g.stroke();
        });
      }
      crumbs(g, layer, rnd); flecks(g, layer, rnd, 34);
    },

    // Кристаллы: вытянутые призмы, сросшиеся друзами.
    crystal(g, layer, rnd) {
      for (let i = 0; i < 22; i++) facet(g, layer, rnd, rnd() * TEX, rnd() * TEX, 12 + rnd() * 18);
      for (let i = 0; i < 30; i++) {
        const px = rnd() * TEX, py = rnd() * TEX;
        const L = 10 + rnd() * 26, w = 3 + rnd() * 6, a = rnd() * 6.2832;
        const ca = Math.cos(a), sa = Math.sin(a);
        const P = (dx, dy) => [dx * ca - dy * sa, dx * sa + dy * ca];
        const v = [P(0, -L), P(w, -L * 0.35), P(w * 0.7, L * 0.5), P(-w * 0.7, L * 0.5), P(-w, -L * 0.35)];
        wrapped(px, py, (ox, oy) => {
          g.beginPath();
          v.forEach((p, k) => k ? g.lineTo(ox + p[0], oy + p[1]) : g.moveTo(ox + p[0], oy + p[1]));
          g.closePath();
          g.fillStyle = rgba(layer.vein, 0.28 + rnd() * 0.3);
          g.fill();
          g.strokeStyle = rgba(lighten(layer.vein, 0.6), 0.55);
          g.lineWidth = 1;
          g.stroke();
        });
      }
      crumbs(g, layer, rnd, 200);
    },

    // Обсидиан: острые сколы стекла с резким контрастом.
    glass(g, layer, rnd) {
      for (let i = 0; i < 44; i++) {
        const px = rnd() * TEX, py = rnd() * TEX, r = 10 + rnd() * 28;
        const v = [];
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * 6.2832 + rnd() * 1.1;
          v.push([Math.cos(a) * r * (0.5 + rnd()), Math.sin(a) * r * (0.5 + rnd())]);
        }
        const sh = rnd();
        wrapped(px, py, (ox, oy) => {
          g.beginPath();
          v.forEach((p, k) => k ? g.lineTo(ox + p[0], oy + p[1]) : g.moveTo(ox + p[0], oy + p[1]));
          g.closePath();
          g.fillStyle = rgba(sh < 0.55 ? mix(layer.color, layer.dark, sh * 1.4)
                                       : lighten(layer.color, (sh - 0.55) * 0.7), 0.85);
          g.fill();
          g.strokeStyle = rgba(lighten(layer.vein, 0.2), 0.3);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(ox + v[0][0], oy + v[0][1]); g.lineTo(ox + v[1][0], oy + v[1][1]);
          g.stroke();
        });
      }
      crumbs(g, layer, rnd, 160); flecks(g, layer, rnd, 26);
    },

    // Магма: текучие потёки и раскалённые карманы.
    magma(g, layer, rnd) {
      for (let i = 0; i < 30; i++) {
        const y = rnd() * TEX, h = 6 + rnd() * 22;
        g.fillStyle = rgba(mix(layer.color, layer.dark, 0.2 + rnd() * 0.8), 0.6);
        for (let d = -1; d <= 1; d++) {
          g.beginPath();
          g.moveTo(-4, y + d * TEX);
          for (let x = 0; x <= TEX + 4; x += 12) g.lineTo(x, y + d * TEX + Math.sin(x * 0.07 + i * 2) * 6);
          g.lineTo(TEX + 4, y + d * TEX + h);
          for (let x = TEX + 4; x >= 0; x -= 12) g.lineTo(x, y + d * TEX + h + Math.sin(x * 0.07 + i * 2) * 6);
          g.closePath(); g.fill();
        }
      }
      for (let i = 0; i < 22; i++) {
        const r = 6 + rnd() * 17;
        wrapped(rnd() * TEX, rnd() * TEX, (ox, oy) => {
          const rg = g.createRadialGradient(ox, oy, 0, ox, oy, r);
          rg.addColorStop(0, rgba(lighten(layer.vein, 0.35), 0.75 * layer.hot));
          rg.addColorStop(0.5, rgba(layer.vein, 0.4 * layer.hot));
          rg.addColorStop(1, rgba([255, 110, 30], 0));
          g.fillStyle = rg;
          g.beginPath(); g.arc(ox, oy, r, 0, 6.2832); g.fill();
        });
      }
      crumbs(g, layer, rnd, 180);
    }
  };

  function texture(layer) {
    const cached = texCache.get(layer.ru);
    if (cached) return cached;

    const c = document.createElement('canvas');
    c.width = c.height = TEX;
    const g = c.getContext('2d');
    const rnd = mulberry32(seedOf(layer.ru));

    g.fillStyle = layer.color;
    g.fillRect(0, 0, TEX, TEX);
    (PAINT[layer.style] || PAINT.stone)(g, layer, rnd);

    texCache.set(layer.ru, c);
    return c;
  }

  /* ---------- жизненный цикл ---------- */

  function init() {
    cv = document.getElementById('shaft');
    ctx = cv.getContext('2d');
    blobDark = makeBlob([0, 0, 0], 0.5);
    blobLight = makeBlob([255, 236, 205], 0.16);
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layoutAge = 99;
  }

  // Бур обязан стоять в полосе между HUD и панелью покупок. Раньше он
  // ставился на 62% высоты окна и на высоких экранах с длинным списком буров
  // уезжал под панель — игрок видел шахту вообще без бура.
  function relayout() {
    const hud = document.getElementById('hud');
    const panel = document.getElementById('panel');
    const app = document.getElementById('app');
    bandTop = hud ? hud.getBoundingClientRect().bottom : 0;
    bandBottom = panel ? panel.getBoundingClientRect().top : H;
    if (!(bandBottom > bandTop + 80)) { bandTop = 0; bandBottom = H; }
    drillY = bandTop + (bandBottom - bandTop) * 0.54;

    // Шахта и бур меряются по колонке интерфейса, а не по всему канвасу:
    // канвас на десктопе растянут во всё окно, и привязка к нему делала
    // тоннель ниткой посреди огромного поля породы.
    colW = app ? app.getBoundingClientRect().width : W;
    if (!(colW > 100)) colW = W;
  }

  // Ширина ствола и, следом, размер машины и крупность породы. Всё меряется
  // по колонке интерфейса: канвас на десктопе растянут во всё окно, и привязка
  // к нему превращала шахту в нитку посреди огромного поля камня.
  const shaftWidth = () => Math.min(colW * 0.5, 340);
  // Тайл породы тоже подрастает: одинаковая крупность камня на телефоне и на
  // мониторе означает, что на мониторе он выглядит мелкой галькой.
  const texScale = () => Math.max(1, Math.min(colW / 375, 1.75));

  /* ---------- эффекты ---------- */

  function burst(power) {
    const x = W / 2, y = drillY + 40;
    const layer = DATA.layerAt(lastDepth);

    const n = Math.min(6 + Math.floor(power), 14);
    for (let i = 0; i < n; i++) {
      chunks.push({
        x, y,
        vx: (Math.random() - 0.5) * 5,
        vy: -Math.random() * 4 - 1.2,
        rot: Math.random() * 6.28, vrot: (Math.random() - 0.5) * 0.55,
        size: 3 + Math.random() * 5,
        life: 1,
        col: rgba(Math.random() < 0.25 ? layer.vein
                                       : mix(layer.color, layer.dark, Math.random() * 0.6), 1)
      });
    }
    for (let i = 0; i < 10; i++) {
      sparks.push({
        x, y,
        vx: (Math.random() - 0.5) * 7,
        vy: -Math.random() * 4.5 - 0.5,
        life: 1, size: 1.2 + Math.random() * 2
      });
    }
    puff(x, y, 4);

    shake = Math.min(shake + 3.6, 10);
    recoil = 1;
    glow = 1;
  }

  // Разбитая друза: звонкий разлёт осколков цвета жилы.
  function shatter(layer) {
    const x = W / 2, y = drillY + 34;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.2832, s = 2 + Math.random() * 6;
      shards.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5,
        rot: Math.random() * 6.28, vrot: (Math.random() - 0.5) * 0.7,
        size: 3 + Math.random() * 6, life: 1,
        col: layer.vein
      });
    }
    for (let i = 0; i < 14; i++) {
      sparks.push({
        x, y,
        vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 6,
        life: 1, size: 1.4 + Math.random() * 2.4
      });
    }
    shake = Math.min(shake + 6, 13);
    flash = 0.55; flashCol = layer.vein;
  }

  function puff(x, y, n) {
    for (let i = 0; i < n; i++) {
      dust.push({
        x: x + (Math.random() - 0.5) * 40, y,
        vx: (Math.random() - 0.5) * 1.3,
        vy: -0.35 - Math.random() * 0.8,
        r: 10 + Math.random() * 22,
        life: 1
      });
    }
  }

  function step(dt) {
    const grav = (arr, g, fade) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        p.x += p.vx; p.y += p.vy; p.vy += g; p.rot += p.vrot || 0;
        p.life -= dt * fade;
        if (p.life <= 0) arr.splice(i, 1);
      }
    };
    grav(chunks, 0.24, 1.3);
    grav(shards, 0.2, 1.05);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.vx *= 0.97;
      p.life -= dt * 2.5;
      if (p.life <= 0) sparks.splice(i, 1);
    }
    for (let i = dust.length - 1; i >= 0; i--) {
      const p = dust[i];
      p.x += p.vx; p.y += p.vy; p.r += dt * 18;
      p.life -= dt * 0.8;
      if (p.life <= 0) dust.splice(i, 1);
    }
    shake = Math.max(0, shake - dt * 26);
    recoil = Math.max(0, recoil - dt * 5.5);
    glow = Math.max(0, glow - dt * 2.2);
    flash = Math.max(0, flash - dt * 1.7);
    if (banner) { banner.t -= dt * 0.42; if (banner.t <= 0) banner = null; }
  }

  /* ---------- мир: жилы, друзы, пустоты ---------- */

  // Всё ниже живёт в мировых координатах и потому никогда не повторяется
  // на экране, в отличие от тайла.

  function worldFeatures(topM, bottomM, pxPerM, layer) {
    const cellM = windowM * 0.55;
    const i0 = Math.floor(topM / cellM) - 1;
    const i1 = Math.ceil(bottomM / cellM) + 1;
    const toY = m => (m - topM) * pxPerM;

    for (let i = i0; i <= i1; i++) {
      const kind = hash2(i, 4242);

      // Рудная жила: пологая волна поперёк экрана. Амплитуда маленькая, а
      // длина волны в разы больше ширины пятна — иначе получается зигзаг
      // кардиограммы, а не прожилка в камне.
      if (kind > 0.62) {
        const y0 = toY((i + hash2(i, 11) * 0.7) * cellM);
        if (y0 < -80 || y0 > H + 80) continue;
        const amp = 5 + hash2(i, 12) * 14;
        const wl = 190 + hash2(i, 13) * 260;
        const ph = hash2(i, 16) * 6.2832;
        const thick = 2.5 + hash2(i, 14) * 5;
        const at = x => y0 + Math.sin(x / wl * 6.2832 + ph) * amp
                           + Math.sin(x / (wl * 0.34) * 6.2832 + ph * 2) * amp * 0.26;
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? rgba(lighten(layer.vein, 0.6), 0.42) : rgba(layer.vein, 0.5);
          ctx.lineWidth = pass ? thick * 0.32 : thick;
          ctx.beginPath();
          for (let x = -20; x <= W + 20; x += 7) {
            x === -20 ? ctx.moveTo(x, at(x)) : ctx.lineTo(x, at(x));
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // друза: гроздь кристаллов у стены
      if (kind > 0.3 && kind < 0.45) {
        const cy = toY((i + hash2(i, 21) * 0.8) * cellM);
        const side = hash2(i, 22) > 0.5 ? 1 : -1;
        const cx = W / 2 + side * (W * 0.28 + hash2(i, 23) * W * 0.12);
        const key = 'd' + i;
        if (!smashed.has(key)) {
          ctx.save();
          ctx.translate(cx, cy);
          for (let k = 0; k < 7; k++) {
            const a = -1.57 + (hash2(i, 30 + k) - 0.5) * 2.4;
            const L = 14 + hash2(i, 40 + k) * 30;
            const w = 4 + hash2(i, 50 + k) * 7;
            ctx.save(); ctx.rotate(a);
            ctx.beginPath();
            ctx.moveTo(0, -L); ctx.lineTo(w, -L * 0.3); ctx.lineTo(w * 0.6, L * 0.25);
            ctx.lineTo(-w * 0.6, L * 0.25); ctx.lineTo(-w, -L * 0.3);
            ctx.closePath();
            ctx.fillStyle = rgba(layer.vein, 0.45);
            ctx.fill();
            ctx.strokeStyle = rgba(lighten(layer.vein, 0.6), 0.7);
            ctx.lineWidth = 1.2; ctx.stroke();
            ctx.restore();
          }
          const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 46);
          rg.addColorStop(0, rgba(layer.vein, 0.22));
          rg.addColorStop(1, rgba(layer.vein, 0));
          ctx.fillStyle = rg;
          ctx.beginPath(); ctx.arc(0, 0, 46, 0, 6.2832); ctx.fill();
          ctx.restore();

          // бур дошёл до друзы — разбиваем
          if (Math.abs(cy - drillY) < 26 && Math.abs(cx - W / 2) < W * 0.34) {
            smashed.add(key);
            shatter(layer);
          }
        }
      }
    }
  }

  // Пустоты. Через них бур проходит насквозь: породы нет, видно тёмный свод
  // со сталактитами. Встречаются заметно реже жил, чтобы оставаться событием.
  function cavities(topM, bottomM, pxPerM, layer) {
    const spanM = windowM * 2.4;
    const i0 = Math.floor(topM / spanM) - 1;
    const i1 = Math.ceil(bottomM / spanM) + 1;

    for (let i = i0; i <= i1; i++) {
      if (hash2(i, 909) < 0.62) continue;
      const top = (i + hash2(i, 910) * 0.6) * spanM;
      // Полость — это узкая щель, а не провал в полэкрана: на большой высоте
      // она читается как конец мира, а не как пустота внутри породы.
      const hM = spanM * (0.04 + hash2(i, 911) * 0.075);
      const y0 = (top - topM) * pxPerM, y1 = (top + hM - topM) * pxPerM;
      if (y1 < -40 || y0 > H + 40) continue;

      const wob = hash2(i, 912);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-30, y0 + 10 * wob);
      ctx.quadraticCurveTo(W * 0.3, y0 - 16, W * 0.62, y0 + 6);
      ctx.quadraticCurveTo(W * 0.9, y0 + 18, W + 30, y0 + 4);
      ctx.lineTo(W + 30, y1 - 4);
      ctx.quadraticCurveTo(W * 0.7, y1 + 18, W * 0.36, y1 - 3);
      ctx.quadraticCurveTo(W * 0.12, y1 - 14, -30, y1 + 6);
      ctx.closePath();
      ctx.clip();

      // Дальняя стена — это та же порода, только глубоко в тени. Заливать
      // полость чёрным нельзя: получается дыра в текстуре, а не помещение.
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, rgba(mix(layer.dark, [0, 0, 0], 0.72), 0.97));
      g.addColorStop(0.45, rgba(mix(layer.dark, [0, 0, 0], 0.55), 0.93));
      g.addColorStop(1, rgba(mix(layer.dark, [0, 0, 0], 0.68), 0.96));
      ctx.fillStyle = g;
      ctx.fillRect(-30, y0 - 30, W + 60, y1 - y0 + 60);

      const k = texScale();
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.scale(k, k);
      ctx.translate(0, -(topM * pxPerM / k) % TEX);
      ctx.fillStyle = ctx.createPattern(texture(layer), 'repeat');
      ctx.fillRect(-30 / k, (y0 - 30) / k - TEX, (W + 60) / k, (y1 - y0 + 90) / k + TEX * 2);
      ctx.restore();

      // сталактиты и сталагмиты
      for (let k = 0; k < 11; k++) {
        const hx = hash2(i, 920 + k), hl = hash2(i, 940 + k);
        const x = hx * W;
        const L = Math.min(10 + hl * 34, (y1 - y0) * 0.55);
        ctx.fillStyle = rgba(mix(layer.dark, [0, 0, 0], 0.35), 0.95);
        ctx.beginPath();
        ctx.moveTo(x - 6 - hl * 4, y0); ctx.lineTo(x + 6 + hl * 4, y0); ctx.lineTo(x, y0 + L);
        ctx.closePath(); ctx.fill();
        if (hl > 0.45) {
          const L2 = Math.min(8 + hx * 24, (y1 - y0) * 0.45);
          ctx.beginPath();
          ctx.moveTo(x - 7, y1); ctx.lineTo(x + 7, y1); ctx.lineTo(x + (hx - 0.5) * 6, y1 - L2);
          ctx.closePath(); ctx.fill();
        }
      }

      // подсветка снизу, чтобы свод читался объёмным
      const lg = ctx.createRadialGradient(W / 2, y1, 0, W / 2, y1, W * 0.7);
      lg.addColorStop(0, rgba(layer.hot ? layer.vein : [120, 130, 160], 0.14));
      lg.addColorStop(1, rgba([0, 0, 0], 0));
      ctx.fillStyle = lg;
      ctx.fillRect(-30, y0 - 30, W + 60, y1 - y0 + 60);
      ctx.restore();
    }
  }

  /* ---------- части картинки ---------- */

  function drawRock(topM, pxPerM) {
    const bottomM = topM + windowM;

    for (const layer of DATA.LAYERS) {
      const to = DATA.nextLayerFrom(layer.from);
      if (to < topM || layer.from > bottomM) continue;

      const y0 = (Math.max(layer.from, topM) - topM) * pxPerM;
      const y1 = (Math.min(to, bottomM) - topM) * pxPerM;

      ctx.save();
      ctx.beginPath(); ctx.rect(0, y0, W, y1 - y0); ctx.clip();

      // Тайл кладём в увеличенном масштабе, поэтому и прокрутку, и границы
      // пересчитываем в тех же увеличенных единицах.
      const k = texScale();
      ctx.save();
      ctx.scale(k, k);
      const off = -(topM * pxPerM / k) % TEX;
      ctx.translate(0, off);
      ctx.fillStyle = ctx.createPattern(texture(layer), 'repeat');
      ctx.fillRect(0, y0 / k - off - TEX, W / k, (y1 - y0) / k + TEX * 2);
      ctx.restore();

      // Крупные пятна в мировых координатах: сетка привязана к метрам, а не к
      // тайлу, поэтому повтор не читается.
      const cellPx = 190 * k;
      const cellM = cellPx / pxPerM;
      const i0 = Math.floor(topM / cellM) - 1;
      const i1 = Math.ceil(bottomM / cellM) + 1;
      const cols = Math.max(2, Math.round(W / cellPx));
      for (let i = i0; i <= i1; i++) {
        for (let j = 0; j < cols; j++) {
          const h1 = hash2(i * 31 + j, 17), h2 = hash2(j * 71 + i, 91), h3 = hash2(i + j * 13, 55);
          if (h3 < 0.35) continue;
          const size = cellPx * (0.9 + h3 * 1.5);
          const x = (j + h1) * (W / cols) - size / 2;
          const y = (i + h2 * 0.8) * cellM * pxPerM - topM * pxPerM - size / 2;
          if (y > y1 || y + size < y0) continue;
          ctx.globalAlpha = 0.5 + h1 * 0.4;
          ctx.drawImage(h2 > 0.5 ? blobDark : blobLight, x, y, size, size);
        }
      }
      ctx.globalAlpha = 1;

      worldFeatures(Math.max(layer.from, topM), Math.min(to, bottomM), pxPerM, layer);
      cavities(Math.max(layer.from, topM), Math.min(to, bottomM), pxPerM, layer);
      ctx.restore();

      // затемнение к низу слоя — глубина читается даже внутри одного слоя
      const sh = ctx.createLinearGradient(0, y0, 0, y1);
      sh.addColorStop(0, rgba([0, 0, 0], 0));
      sh.addColorStop(1, rgba([0, 0, 0], 0.3));
      ctx.fillStyle = sh;
      ctx.fillRect(0, y0, W, y1 - y0);

      // граница слоёв
      if (layer.from >= topM && layer.from <= bottomM) {
        const y = (layer.from - topM) * pxPerM;
        ctx.fillStyle = rgba([0, 0, 0], 0.45); ctx.fillRect(0, y - 3, W, 4);
        ctx.fillStyle = rgba(lighten(layer.color, 0.4), 0.55); ctx.fillRect(0, y + 1, W, 1.5);
      }
    }
  }

  // Ствол собирается на отдельном холсте и только потом переносится в кадр.
  // Так к нему можно применить маску и растворить края в породе: рисуя прямо
  // в кадр, ствол упирался в резкую вертикальную границу и читался как
  // вырезанный прямоугольник, а не как пробитый в камне тоннель.
  let shaftCv = null, shaftCtx = null, shaftW = 0, shaftH = 0;

  function drawShaft(topM, pxPerM, layer) {
    const sw = shaftWidth();
    const sx = (W - sw) / 2;
    const sh = Math.max(2, drillY);

    const cw = Math.ceil(sw * dpr), ch = Math.ceil(sh * dpr);
    if (!shaftCv || shaftW !== cw || shaftH !== ch) {
      shaftCv = document.createElement('canvas');
      shaftCv.width = cw; shaftCv.height = ch;
      shaftW = cw; shaftH = ch;
      shaftCtx = shaftCv.getContext('2d');
    }
    const g = shaftCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, sw, sh);

    // Ствол — это дыра в текущей породе, поэтому и цвет берётся от неё.
    // Фиксированный тёплый оттенок смотрелся коричневым коробом посреди синего
    // кристаллического слоя. К забою тоннель всё равно теплеет от света бура,
    // но теплеет именно эта порода, а не абстрактный бурый.
    const deep = mix(layer.dark, [0, 0, 0], 0.8);
    const midc = mix(layer.dark, [0, 0, 0], 0.62);
    const warm = mix(mix(layer.dark, [0, 0, 0], 0.42), [140, 84, 46], 0.5);
    const vg = g.createLinearGradient(0, 0, 0, sh);
    vg.addColorStop(0, rgba(deep, 0.97));
    vg.addColorStop(0.62, rgba(midc, 0.93));
    vg.addColorStop(1, rgba(warm, 0.86));
    g.fillStyle = vg;
    g.fillRect(0, 0, sw, sh);

    const every = windowM / 3;
    const first = Math.ceil(topM / every) * every;

    // фактура стен
    for (let m = first - every * 3; m < topM + windowM; m += every / 4) {
      const y = (m - topM) * pxPerM;
      if (y < -20 || y > sh) continue;
      const h = hash2(Math.round(m * 7), 3);
      g.fillStyle = rgba([0, 0, 0], 0.25 + h * 0.3);
      const w = 4 + h * 12;
      g.fillRect(0, y, w, 6 + h * 10);
      g.fillRect(sw - w, y + 5, w, 5 + h * 9);
    }

    const edge = 22;
    const le = g.createLinearGradient(0, 0, edge, 0);
    le.addColorStop(0, rgba([0, 0, 0], 0.55)); le.addColorStop(1, rgba([0, 0, 0], 0));
    g.fillStyle = le; g.fillRect(0, 0, edge, sh);
    const re = g.createLinearGradient(sw, 0, sw - edge, 0);
    re.addColorStop(0, rgba([0, 0, 0], 0.55)); re.addColorStop(1, rgba([0, 0, 0], 0));
    g.fillStyle = re; g.fillRect(sw - edge, 0, edge, sh);

    // Крепь. Шаг в метрах привязан к размеру кадра, поэтому на любой глубине
    // по экрану ползёт одинаковое их число — иначе на быстрых слоях
    // картинка превращается в мельтешение.
    for (let m = first; m < topM + windowM; m += every) {
      const y = (m - topM) * pxPerM;
      if (y > sh) break;
      g.fillStyle = rgba([58, 46, 38], 0.92);
      g.fillRect(3, y, sw - 6, 6);
      g.fillStyle = rgba([96, 78, 62], 0.75);
      g.fillRect(3, y, sw - 6, 1.6);
      g.fillStyle = rgba([22, 17, 15], 0.92);
      g.fillRect(6, y - 9, 6, 9);
      g.fillRect(sw - 12, y - 9, 6, 9);
    }

    // труба вдоль стены — задаёт вертикальный ритм и масштаб
    g.fillStyle = rgba([40, 34, 44], 0.85);
    g.fillRect(13, 0, 5, sh);
    g.fillStyle = rgba([120, 108, 130], 0.3);
    g.fillRect(13, 0, 1.5, sh);
    for (let m = first; m < topM + windowM; m += every / 2) {
      const y = (m - topM) * pxPerM;
      if (y > sh) break;
      g.fillStyle = rgba([64, 55, 70], 0.9);
      g.fillRect(11, y, 9, 4);
    }

    // Маска. destination-in оставляет от ствола только то, что попало под
    // градиент, поэтому боковины плавно уходят в ноль вместе со всем, что на
    // них нарисовано, — и с крепью, и с трубой.
    // Растворение должно смягчить кромку, а не съесть тоннель: на широком
    // размытии от ствола оставалась еле заметная тень.
    const fade = Math.min(sw * 0.2, 52) / sw;
    g.globalCompositeOperation = 'destination-in';
    const mg = g.createLinearGradient(0, 0, sw, 0);
    mg.addColorStop(0, 'rgba(0,0,0,0)');
    mg.addColorStop(fade, 'rgba(0,0,0,1)');
    mg.addColorStop(1 - fade, 'rgba(0,0,0,1)');
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = mg;
    g.fillRect(0, 0, sw, sh);

    // Низ тоже нельзя обрубать: у забоя ствол должен растворяться в породе,
    // а не заканчиваться горизонтальной линией под буром.
    g.globalCompositeOperation = 'destination-out';
    const bf = Math.min(56, sh * 0.22);   // на низких экранах хвост короче
    const bg = g.createLinearGradient(0, sh - bf, 0, sh);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = bg;
    g.fillRect(0, sh - bf, sw, bf);
    g.globalCompositeOperation = 'source-over';

    ctx.drawImage(shaftCv, 0, 0, cw, ch, sx, 0, sw, sh);
  }

  // Трос. Рисуется в экранных координатах от верхней кромки кадра, а не внутри
  // масштаба бура: раньше он обрывался на середине шахты, а кольца стояли
  // ровным столбиком и не следовали за изгибом.
  function drawCable(tipY) {
    const N = 30;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const sway = Math.sin(t * Math.PI) * Math.sin(time * 1.25 + t * 3.6) * 5.5;
      pts.push([W / 2 + sway, -30 + (tipY + 30) * t]);
    }
    const path = () => {
      ctx.beginPath();
      pts.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    };
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = '#221d2b'; ctx.lineWidth = 11; path(); ctx.stroke();
    ctx.strokeStyle = '#3b3348'; ctx.lineWidth = 7.5; path(); ctx.stroke();
    ctx.strokeStyle = rgba([168, 158, 190], 0.28); ctx.lineWidth = 2; path(); ctx.stroke();

    // кольца ставим по касательной к тросу
    for (let i = 2; i < N - 1; i += 3) {
      const p = pts[i], q = pts[i + 1];
      const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      ctx.save();
      ctx.translate(p[0], p[1]); ctx.rotate(a);
      ctx.fillStyle = '#4c4360';
      ctx.fillRect(-2.6, -7, 5.2, 14);
      ctx.fillStyle = rgba([180, 170, 205], 0.3);
      ctx.fillRect(-2.6, -7, 5.2, 2);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawDrill(hot) {
    const bob = Math.sin(time * 2.2) * 1.4;
    const y = drillY + recoil * 9 + bob;
    // Машина занимает постоянную долю ствола — примерно треть его ширины.
    // Так она одинаково читается и на телефоне, и на широком мониторе.
    const S = Math.max(1.55, shaftWidth() / 111);

    drawCable(y - 36 * S);

    ctx.save();
    ctx.translate(W / 2, y);
    ctx.scale(S, S);   // машина должна читаться, а не теряться в кадре

    // корпус
    const bg = ctx.createLinearGradient(-19, 0, 19, 0);
    bg.addColorStop(0, '#514b5d');
    bg.addColorStop(0.3, '#d4cee0');
    bg.addColorStop(0.62, '#9d96a8');
    bg.addColorStop(1, '#443f4e');
    ctx.fillStyle = bg;
    ctx.fillRect(-19, -36, 38, 32);

    ctx.fillStyle = rgba([28, 23, 34], 0.8);
    ctx.fillRect(-19, -36, 38, 4.5);
    ctx.fillRect(-19, -12, 38, 3.5);

    ctx.fillStyle = '#ffa62b';
    ctx.fillRect(-19, -21, 38, 5);
    ctx.fillStyle = rgba([26, 16, 19], 0.6);
    for (let i = -19; i < 19; i += 9) ctx.fillRect(i, -21, 4.5, 5);

    ctx.fillStyle = rgba([38, 32, 46], 0.85);
    ctx.beginPath(); ctx.arc(-13, -30, 1.8, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(13, -30, 1.8, 0, 6.2832); ctx.fill();
    ctx.fillStyle = rgba([255, 226, 160], 0.5 + glow * 0.5);
    ctx.beginPath(); ctx.arc(0, -28, 3.2, 0, 6.2832); ctx.fill();

    const pist = recoil * 5;
    ctx.fillStyle = '#67606f';
    ctx.fillRect(-25, -30 + pist, 6, 18);
    ctx.fillRect(19, -30 + pist, 6, 18);
    ctx.fillStyle = rgba([150, 142, 160], 0.45);
    ctx.fillRect(-25, -30 + pist, 1.6, 18);
    ctx.fillRect(19, -30 + pist, 1.6, 18);

    // долото
    ctx.beginPath();
    ctx.moveTo(-15, -6); ctx.lineTo(15, -6); ctx.lineTo(0, 34); ctx.closePath();
    const bit = ctx.createLinearGradient(-15, 0, 15, 0);
    bit.addColorStop(0, '#a45a15');
    bit.addColorStop(0.38, '#ffc978');
    bit.addColorStop(1, '#954c15');
    ctx.fillStyle = bit;
    ctx.fill();

    // Навивка идёт под наклоном: горизонтальные полосы превращали конус в улей,
    // а винтовая линия сразу читается как буровое долото.
    ctx.save();
    ctx.clip();
    const SKEW = 7;
    for (let i = 0; i < 7; i++) {
      const t = (bitAngle * 0.16 + i / 7) % 1;
      const yy = -8 + t * 44;
      ctx.beginPath();
      ctx.moveTo(-16, yy); ctx.lineTo(16, yy - SKEW);
      ctx.lineTo(16, yy - SKEW + 3.6); ctx.lineTo(-16, yy + 3.6);
      ctx.closePath();
      ctx.fillStyle = rgba([80, 38, 8], 0.5);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-16, yy + 3.6); ctx.lineTo(16, yy - SKEW + 3.6);
      ctx.lineTo(16, yy - SKEW + 4.9); ctx.lineTo(-16, yy + 4.9);
      ctx.closePath();
      ctx.fillStyle = rgba([255, 214, 150], 0.24);
      ctx.fill();
    }
    ctx.restore();

    const heat = Math.max(glow, hot * 0.55);
    if (heat > 0.01) {
      const rg = ctx.createRadialGradient(0, 30, 0, 0, 30, 30);
      rg.addColorStop(0, rgba([255, 232, 165], 0.9 * heat));
      rg.addColorStop(0.35, rgba([255, 145, 55], 0.5 * heat));
      rg.addColorStop(1, rgba([255, 90, 20], 0));
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(0, 30, 30, 0, 6.2832); ctx.fill();
    }

    ctx.restore();
  }

  function drawParticles() {
    for (const p of dust) {
      ctx.globalAlpha = Math.max(0, p.life) * 0.32;
      ctx.drawImage(blobLight, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;
    for (const p of chunks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.8);
      ctx.restore();
    }
    for (const p of shards) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.5, p.size * 0.5); ctx.lineTo(-p.size * 0.5, p.size * 0.5);
      ctx.closePath();
      ctx.fillStyle = rgba(p.col, 0.85);
      ctx.fill();
      ctx.strokeStyle = rgba(lighten(p.col, 0.6), 0.8);
      ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of sparks) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = '#ffd489';
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // Смена слоя — главное событие в игре. Вспышка цветом нового слоя плюс его
  // имя во весь экран: игрок должен заметить, что порода сменилась.
  function drawBanner() {
    if (!banner) return;
    const t = banner.t;
    const a = t > 0.75 ? (1 - t) * 4 : Math.min(1, t / 0.35);
    const rise = (1 - t) * 16;
    // Держим баннер в верхней трети: ниже он налезает на буровую машину.
    const y = bandTop + (bandBottom - bandTop) * 0.16 - rise;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '700 11px "Segoe UI", Roboto, system-ui, sans-serif';
    ctx.fillStyle = rgba(banner.tint, 0.85);
    ctx.fillText(banner.kicker.toUpperCase(), W / 2, y - 26);

    ctx.font = '800 30px "Segoe UI", Roboto, system-ui, sans-serif';
    ctx.lineWidth = 5;
    ctx.strokeStyle = rgba([10, 8, 12], 0.75);
    ctx.strokeText(banner.name, W / 2, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(banner.name, W / 2, y);

    const lw = 44 * a;
    ctx.fillStyle = rgba(banner.tint, 0.8);
    ctx.fillRect(W / 2 - lw / 2, y + 24, lw, 2.5);
    ctx.restore();
  }

  /* ---------- кадр ---------- */

  function draw(depth, dt, rate) {
    if (!ctx) return;
    time += dt;
    if (++layoutAge > 12) { layoutAge = 0; relayout(); }

    // Масштаб подстраивается под скорость: без этого на глубоких слоях, где
    // проходка идёт тысячами метров в секунду, порода была бы сплошной мазнёй.
    const want = Math.max(40, (rate || 0) / SCREENS_PER_SEC);
    windowM += (want - windowM) * Math.min(1, dt * 0.7);

    if (rate > 0 && depth > lastDepth && Math.random() < dt * 7) puff(W / 2, drillY + 38, 1);
    bitAngle += dt * (4 + Math.min(rate / windowM, 3) * 12);
    lastDepth = depth;

    const layer = DATA.layerAt(depth);
    if (lastLayer && layer !== lastLayer) {
      banner = { name: layer[I18N.lang] || layer.ru, kicker: I18N.t('new_layer'), tint: layer.vein, t: 1 };
      flash = 0.8; flashCol = layer.vein;
      shake = Math.max(shake, 7);
      smashed.clear();     // друзы привязаны к индексу ячейки, он общий для слоёв
    }
    lastLayer = layer;

    step(dt);
    ctx.clearRect(0, 0, W, H);

    const pxPerM = H / windowM;
    // Выше нулевой отметки породы нет, и кадр там оставался прозрачным —
    // в начале игры пол-экрана зияло пустотой. Прижимаем камеру к поверхности.
    const topM = Math.max(0, depth - drillY / pxPerM);

    ctx.save();
    if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    drawRock(topM, pxPerM);
    drawShaft(topM, pxPerM, layer);

    const lg = ctx.createRadialGradient(W / 2, drillY + 20, 0, W / 2, drillY + 20, W * 0.6);
    lg.addColorStop(0, rgba([255, 178, 92], 0.2 + glow * 0.16));
    lg.addColorStop(1, rgba([255, 150, 60], 0));
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);

    drawDrill(layer.hot || 0);
    drawParticles();
    ctx.restore();

    if (layer.hot) {
      const hg = ctx.createLinearGradient(0, bandBottom, 0, drillY);
      hg.addColorStop(0, rgba([255, 90, 20], 0.18 * layer.hot));
      hg.addColorStop(1, rgba([255, 90, 20], 0));
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, W, H);
    }

    const v = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.2, W / 2, H * 0.5, H * 0.82);
    v.addColorStop(0, rgba([0, 0, 0], 0));
    v.addColorStop(1, rgba([0, 0, 0], 0.55));
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    if (flash > 0.005) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(flashCol || '#ffffff', flash * 0.32);
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }

    drawBanner();
  }

  return { init, draw, burst, resize, relayout };
})();
