// Отрисовка шахты. Никаких картинок — только фигуры, чтобы сборка была лёгкой.
const Render = (() => {

  const WINDOW_M = 60;      // сколько метров породы видно на экране
  const DRILL_Y = 0.62;     // где по высоте стоит бур

  let cv, ctx, W = 0, H = 0, dpr = 1;
  let particles = [];
  let shake = 0;

  function init() {
    cv = document.getElementById('shaft');
    ctx = cv.getContext('2d');
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
  }

  // Псевдослучайное, но стабильное значение для клетки породы —
  // чтобы крапинки не «кипели» при прокрутке.
  function hash(x, y) {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }

  function burst(power) {
    const x = W / 2, y = H * DRILL_Y + 14;
    const n = Math.min(6 + Math.floor(power / 2), 16);
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 3.4,
        vy: -Math.random() * 3.2 - 0.8,
        life: 1,
        size: 1.5 + Math.random() * 2.5
      });
    }
    shake = Math.min(shake + 2.5, 7);
  }

  function draw(depth, dt) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const pxPerM = H / WINDOW_M;
    const topM = depth - H * DRILL_Y / pxPerM;   // метр в верхней кромке экрана

    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.save();
    ctx.translate(sx, sy);

    // ---- слои породы ----
    const bottomM = topM + WINDOW_M;
    for (const layer of DATA.LAYERS) {
      const nextFrom = DATA.nextLayerFrom(layer.from);
      if (nextFrom < topM || layer.from > bottomM) continue;
      const y0 = (Math.max(layer.from, topM) - topM) * pxPerM;
      const y1 = (Math.min(nextFrom, bottomM) - topM) * pxPerM;
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, layer.color);
      g.addColorStop(1, layer.dark);
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, W, y1 - y0);
    }

    // ---- крапинки породы ----
    const cell = 22;
    const startRow = Math.floor(topM * pxPerM / cell) - 1;
    const rows = Math.ceil(H / cell) + 2;
    const cols = Math.ceil(W / cell) + 1;
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    for (let r = 0; r < rows; r++) {
      const row = startRow + r;
      const y = row * cell - topM * pxPerM;
      for (let c = 0; c < cols; c++) {
        const h = hash(c, row);
        if (h > 0.62) {
          const px = c * cell + h * cell * 0.7;
          const py = y + hash(row, c) * cell * 0.7;
          ctx.fillRect(px, py, 2 + h * 3, 2 + h * 2);
        }
      }
    }

    // ---- уже пройденный ствол ----
    const shaftW = Math.min(W * 0.34, 130);
    const shaftX = (W - shaftW) / 2;
    const drillY = H * DRILL_Y;
    const gg = ctx.createLinearGradient(0, 0, 0, drillY);
    gg.addColorStop(0, 'rgba(10,8,12,.92)');
    gg.addColorStop(1, 'rgba(10,8,12,.55)');
    ctx.fillStyle = gg;
    ctx.fillRect(shaftX, 0, shaftW, drillY);
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fillRect(shaftX, 0, 2, drillY);
    ctx.fillRect(shaftX + shaftW - 2, 0, 2, drillY);

    // ---- бур ----
    ctx.save();
    ctx.translate(W / 2, drillY);
    ctx.fillStyle = '#c9c4d2';
    ctx.fillRect(-11, -34, 22, 26);
    ctx.fillStyle = '#8d8496';
    ctx.fillRect(-11, -34, 22, 5);
    ctx.beginPath();               // остриё
    ctx.moveTo(-11, -8);
    ctx.lineTo(11, -8);
    ctx.lineTo(0, 16);
    ctx.closePath();
    ctx.fillStyle = '#ffa62b';
    ctx.fill();
    ctx.restore();

    // ---- искры ----
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.16;
      p.life -= dt * 1.6;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = '#ffce7a';
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---- виньетка ----
    const v = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.25, W / 2, H * 0.5, H * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    shake = Math.max(0, shake - dt * 22);
  }

  return { init, draw, burst, resize };
})();
