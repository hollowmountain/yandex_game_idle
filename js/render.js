// Отрисовка шахты.
//
// Картинок в игре нет и не будет: вся графика собирается процедурно прямо в
// браузере. Это держит сборку в десятках килобайт и даёт мгновенную загрузку,
// что напрямую бьётся с требованиями платформы к весу.
//
// Порода рисуется в два прохода. Первый — бесшовный тайл с гранёными
// фасетками, он даёт мелкую фактуру камня. Второй — крупные пятна в мировых
// координатах, которые ни к какой сетке не привязаны. Без второго прохода
// экран читается как обои: тайл в 256 пикселей укладывается по ширине три
// раза, и глаз мгновенно ловит повтор.
const Render = (() => {

  const TEX = 256;
  const SCREENS_PER_SEC = 0.28; // цель: экран породы примерно за 3.5 секунды

  let cv, ctx, W = 0, H = 0, dpr = 1;
  let bandTop = 0, bandBottom = 0, drillY = 0, layoutAge = 99;
  let windowM = 60;
  let time = 0;

  let chunks = [], sparks = [], dust = [];
  let shake = 0, recoil = 0, glow = 0, bitAngle = 0;
  let lastDepth = 0;

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
  // Стабильный шум по двум целым — для пятен, привязанных к мировой сетке.
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

  function wrapped(x, y, fn) {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        fn(x + dx * TEX, y + dy * TEX);
  }

  function texture(layer) {
    const cached = texCache.get(layer.ru);
    if (cached) return cached;

    const c = document.createElement('canvas');
    c.width = c.height = TEX;
    const g = c.getContext('2d');
    const rnd = mulberry32(seedOf(layer.ru));

    g.fillStyle = layer.color;
    g.fillRect(0, 0, TEX, TEX);

    // Гранёные фасетки. Многоугольник с тёмной расшивкой и бликом по верхней
    // грани читается как скол камня; круги давали ощущение мыльных пузырей.
    for (let i = 0; i < 34; i++) {
      const px = rnd() * TEX, py = rnd() * TEX;
      const n = 5 + Math.floor(rnd() * 3);
      const rad = 14 + rnd() * 24;
      const verts = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.2832 + (rnd() - 0.5) * 0.5;
        const r = rad * (0.55 + rnd() * 0.65);
        verts.push([Math.cos(a) * r, Math.sin(a) * r]);
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

    // крошка
    for (let i = 0; i < 300; i++) {
      g.fillStyle = rgba(mix(layer.color, layer.dark, 0.4 + rnd() * 0.6), 0.3 + rnd() * 0.4);
      const s = 0.8 + rnd() * 2;
      wrapped(rnd() * TEX, rnd() * TEX, (ox, oy) => g.fillRect(ox, oy, s, s));
    }

    // вкрапления минерала — они делают слои узнаваемыми
    const spec = lighten(layer.color, 0.6);
    for (let i = 0; i < 34; i++) {
      g.fillStyle = rgba(spec, 0.35 + rnd() * 0.5);
      const s = 1.2 + rnd() * 2.6;
      wrapped(rnd() * TEX, rnd() * TEX, (ox, oy) => g.fillRect(ox, oy, s, s * (0.5 + rnd())));
    }

    // раскалённые прожилки в глубоких слоях
    if (layer.hot) {
      for (let i = 0; i < 18; i++) {
        const r = 5 + rnd() * 14;
        wrapped(rnd() * TEX, rnd() * TEX, (ox, oy) => {
          const rg = g.createRadialGradient(ox, oy, 0, ox, oy, r);
          rg.addColorStop(0, rgba([255, 200, 110], 0.6 * layer.hot));
          rg.addColorStop(1, rgba([255, 120, 40], 0));
          g.fillStyle = rg;
          g.beginPath(); g.arc(ox, oy, r, 0, 6.2832); g.fill();
        });
      }
    }

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
    bandTop = hud ? hud.getBoundingClientRect().bottom : 0;
    bandBottom = panel ? panel.getBoundingClientRect().top : H;
    if (!(bandBottom > bandTop + 80)) { bandTop = 0; bandBottom = H; }
    drillY = bandTop + (bandBottom - bandTop) * 0.54;
  }

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
        col: rgba(mix(layer.color, layer.dark, Math.random() * 0.6), 1)
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
    for (let i = chunks.length - 1; i >= 0; i--) {
      const p = chunks[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.24; p.rot += p.vrot;
      p.life -= dt * 1.3;
      if (p.life <= 0) chunks.splice(i, 1);
    }
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

      const off = -(topM * pxPerM) % TEX;
      ctx.translate(0, off);
      ctx.fillStyle = ctx.createPattern(texture(layer), 'repeat');
      ctx.fillRect(0, y0 - off - TEX, W, (y1 - y0) + TEX * 2);
      ctx.translate(0, -off);

      // Второй проход: крупные пятна в мировых координатах. Сетка привязана
      // к метрам, а не к тайлу, поэтому повтор не читается.
      const cellPx = 190;
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

  function drawShaft(topM, pxPerM) {
    const sw = Math.min(W * 0.42, 190);
    const sx = (W - sw) / 2;

    // Пробитый ствол. Не чёрная дыра: к забою он теплеет от света бура,
    // иначе верх экрана выглядит вырезанным прямоугольником.
    const g = ctx.createLinearGradient(0, bandTop, 0, drillY);
    g.addColorStop(0, rgba([14, 11, 17], 0.97));
    g.addColorStop(0.65, rgba([26, 19, 22], 0.9));
    g.addColorStop(1, rgba([54, 34, 24], 0.82));
    ctx.fillStyle = g;
    ctx.fillRect(sx, 0, sw, drillY);

    ctx.save();
    ctx.beginPath(); ctx.rect(sx, 0, sw, drillY); ctx.clip();

    // фактура стен: скол по краям ствола
    const every = windowM / 3;
    const first = Math.ceil(topM / every) * every;
    for (let m = first - every * 3; m < topM + windowM; m += every / 4) {
      const y = (m - topM) * pxPerM;
      if (y < -20 || y > drillY) continue;
      const h = hash2(Math.round(m * 7), 3);
      ctx.fillStyle = rgba([0, 0, 0], 0.25 + h * 0.3);
      const w = 4 + h * 12;
      ctx.fillRect(sx, y, w, 6 + h * 10);
      ctx.fillRect(sx + sw - w, y + 5, w, 5 + h * 9);
    }

    // кромки
    const edge = 18;
    const le = ctx.createLinearGradient(sx, 0, sx + edge, 0);
    le.addColorStop(0, rgba([0, 0, 0], 0.6)); le.addColorStop(1, rgba([0, 0, 0], 0));
    ctx.fillStyle = le; ctx.fillRect(sx, 0, edge, drillY);
    const re = ctx.createLinearGradient(sx + sw, 0, sx + sw - edge, 0);
    re.addColorStop(0, rgba([0, 0, 0], 0.6)); re.addColorStop(1, rgba([0, 0, 0], 0));
    ctx.fillStyle = re; ctx.fillRect(sx + sw - edge, 0, edge, drillY);

    ctx.fillStyle = rgba([255, 255, 255], 0.08);
    ctx.fillRect(sx, 0, 1.5, drillY);
    ctx.fillRect(sx + sw - 1.5, 0, 1.5, drillY);

    // Крепь. Шаг задан в метрах и привязан к размеру кадра, поэтому на любой
    // глубине по экрану ползёт одинаковое их число — без этого на быстрых
    // слоях картинка превращается в мельтешение.
    for (let m = first; m < topM + windowM; m += every) {
      const y = (m - topM) * pxPerM;
      if (y > drillY) break;
      ctx.fillStyle = rgba([58, 46, 38], 0.92);
      ctx.fillRect(sx + 3, y, sw - 6, 6);
      ctx.fillStyle = rgba([96, 78, 62], 0.75);
      ctx.fillRect(sx + 3, y, sw - 6, 1.6);
      ctx.fillStyle = rgba([22, 17, 15], 0.92);
      ctx.fillRect(sx + 6, y - 9, 6, 9);
      ctx.fillRect(sx + sw - 12, y - 9, 6, 9);
    }

    // труба вдоль стены — задаёт вертикальный ритм и масштаб
    ctx.fillStyle = rgba([40, 34, 44], 0.85);
    ctx.fillRect(sx + 13, 0, 5, drillY);
    ctx.fillStyle = rgba([120, 108, 130], 0.3);
    ctx.fillRect(sx + 13, 0, 1.5, drillY);
    for (let m = first; m < topM + windowM; m += every / 2) {
      const y = (m - topM) * pxPerM;
      if (y > drillY) break;
      ctx.fillStyle = rgba([64, 55, 70], 0.9);
      ctx.fillRect(sx + 11, y, 9, 4);
    }

    ctx.restore();
    return { sx, sw };
  }

  function drawDrill(hot) {
    const bob = Math.sin(time * 2.2) * 1.4;
    const y = drillY + recoil * 9 + bob;

    ctx.save();
    ctx.translate(W / 2, y);
    ctx.scale(1.55, 1.55);   // машина должна читаться, а не теряться в кадре

    // шланг к поверхности: сегментами, а не палкой
    const hoseTop = (bandTop - y) / 1.55;
    ctx.strokeStyle = rgba([44, 38, 50], 0.95);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.quadraticCurveTo(Math.sin(time * 1.5) * 6, (hoseTop - 34) * 0.5, 0, hoseTop);
    ctx.stroke();
    ctx.strokeStyle = rgba([88, 78, 100], 0.5);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    for (let i = -40; i > hoseTop; i -= 13) {
      ctx.fillStyle = rgba([58, 50, 66], 0.9);
      ctx.fillRect(-4, i, 8, 3);
    }

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

    // предупреждающая полоса
    ctx.fillStyle = '#ffa62b';
    ctx.fillRect(-19, -21, 38, 5);
    ctx.fillStyle = rgba([26, 16, 19], 0.6);
    for (let i = -19; i < 19; i += 9) ctx.fillRect(i, -21, 4.5, 5);

    // заклёпки и фара
    ctx.fillStyle = rgba([38, 32, 46], 0.85);
    ctx.beginPath(); ctx.arc(-13, -30, 1.8, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(13, -30, 1.8, 0, 6.2832); ctx.fill();
    ctx.fillStyle = rgba([255, 226, 160], 0.5 + glow * 0.5);
    ctx.beginPath(); ctx.arc(0, -28, 3.2, 0, 6.2832); ctx.fill();

    // боковые поршни ходят в такт отдаче
    const pist = recoil * 5;
    ctx.fillStyle = '#67606f';
    ctx.fillRect(-25, -30 + pist, 6, 18);
    ctx.fillRect(19, -30 + pist, 6, 18);
    ctx.fillStyle = rgba([150, 142, 160], 0.45);
    ctx.fillRect(-25, -30 + pist, 1.6, 18);
    ctx.fillRect(19, -30 + pist, 1.6, 18);

    // долото: конус с винтовой навивкой, которая крутится
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
      ctx.moveTo(-16, yy);
      ctx.lineTo(16, yy - SKEW);
      ctx.lineTo(16, yy - SKEW + 3.6);
      ctx.lineTo(-16, yy + 3.6);
      ctx.closePath();
      ctx.fillStyle = rgba([80, 38, 8], 0.5);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-16, yy + 3.6);
      ctx.lineTo(16, yy - SKEW + 3.6);
      ctx.lineTo(16, yy - SKEW + 4.9);
      ctx.lineTo(-16, yy + 4.9);
      ctx.closePath();
      ctx.fillStyle = rgba([255, 214, 150], 0.24);
      ctx.fill();
    }
    ctx.restore();

    // раскалённое остриё
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
      const a = Math.max(0, p.life) * 0.9;
      ctx.globalAlpha = a * 0.35;
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
    ctx.globalCompositeOperation = 'lighter';
    for (const p of sparks) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = '#ffd489';
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
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

    step(dt);
    ctx.clearRect(0, 0, W, H);

    const pxPerM = H / windowM;
    // Выше нулевой отметки породы нет, и кадр там оставался прозрачным —
    // в начале игры пол-экрана зияло пустотой. Прижимаем камеру к поверхности.
    const topM = Math.max(0, depth - drillY / pxPerM);
    const layer = DATA.layerAt(depth);

    ctx.save();
    if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    drawRock(topM, pxPerM);
    drawShaft(topM, pxPerM);

    // свет от бура, разлитый по забою
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
  }

  return { init, draw, burst, resize, relayout };
})();
