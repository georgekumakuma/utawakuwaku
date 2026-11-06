// 紙吹雪（正解・ハイスコアの演出）。動きを減らす設定の端末では何もしない。

let canvas = null, g = null, parts = [], raf = 0;

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function ensure() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  g = canvas.getContext('2d');
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);
}

function step() {
  g.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => p.life > 0 && p.y < innerHeight + 40);
  for (const p of parts) {
    p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985;
    p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 1;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.globalAlpha = Math.min(1, p.life / 40);
    g.fillStyle = p.color;
    if (p.shape === 0) g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    else { g.beginPath(); g.arc(0, 0, p.s / 3, 0, 6.283); g.fill(); }
    g.restore();
  }
  if (parts.length) raf = requestAnimationFrame(step);
  else { raf = 0; g.clearRect(0, 0, innerWidth, innerHeight); }
}

export function confetti({ x = innerWidth / 2, y = innerHeight / 2, count = 90, spread = 1, colors } = {}) {
  if (reduceMotion()) return;
  ensure();
  const cs = getComputedStyle(document.documentElement);
  const palette = colors || [cs.getPropertyValue('--amb-1'), cs.getPropertyValue('--amb-2'), cs.getPropertyValue('--amb-3'), '#ffd166', '#ffffff'].map(c => c.trim()).filter(Boolean);
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1 * spread;
    const v = 7 + Math.random() * 9;
    parts.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
      s: 6 + Math.random() * 8, color: palette[i % palette.length], life: 110 + Math.random() * 60, shape: Math.random() < 0.7 ? 0 : 1
    });
  }
  if (!raf) raf = requestAnimationFrame(step);
}
