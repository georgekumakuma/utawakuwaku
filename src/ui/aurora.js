// オーロラ背景: 色の帯をゆっくり動かすキャンバス描画
// - 小さなキャンバスに放射グラデーションを描き、CSS で拡大して柔らかく見せる（軽い）
// - きらめく粒子は別のキャンバスに等倍で描く
// - energy（再生中 1 / 停止中 0.35）で動きの速さと明るさが変わり、pulse() で曲の切り替わりを演出

import { fromHex } from '../core/color.js';

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Aurora {
  constructor(host, { particles = 46, intensity = 1 } = {}) {
    this.host = host;
    this.intensity = intensity;
    this.field = document.createElement('canvas');
    this.field.className = 'aurora-field';
    this.sparks = document.createElement('canvas');
    this.sparks.className = 'aurora-sparks';
    host.append(this.field, this.sparks);
    this.fg = this.field.getContext('2d');
    this.sg = this.sparks.getContext('2d');
    this.colors = [[124, 92, 255], [46, 211, 198], [255, 92, 138]];
    this.target = this.colors.map(c => c.slice());
    this.energy = 0.35;
    this.energyTarget = 0.35;
    this.pulseAmt = 0;
    this.t = Math.random() * 1000;
    this.raf = 0;
    this.running = false;
    this.animate = true;
    this.blobs = Array.from({ length: 6 }, (_, i) => ({
      fx: 0.07 + Math.random() * 0.09, fy: 0.05 + Math.random() * 0.08,
      px: Math.random() * 6.28, py: Math.random() * 6.28,
      r: 0.45 + Math.random() * 0.35, c: i % 3
    }));
    this.parts = Array.from({ length: particles }, () => this.newPart(true));
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(host);
    this.resize();
  }

  newPart(randomY = false) {
    return {
      x: Math.random(), y: randomY ? Math.random() : 1.05,
      v: 0.012 + Math.random() * 0.03, r: 0.6 + Math.random() * 1.8,
      tw: Math.random() * 6.28, drift: (Math.random() - 0.5) * 0.02
    };
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.field.width = 160;
    this.field.height = Math.max(60, Math.round(160 * h / w));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.sparks.width = Math.round(w * dpr);
    this.sparks.height = Math.round(h * dpr);
    this.dpr = dpr;
    if (!this.running) this.draw(0);
  }

  setColors(hexes) {
    const list = (hexes && hexes.length ? hexes : ['#7c5cff', '#2ed3c6', '#ff5c8a']).map(fromHex);
    this.target = [0, 1, 2].map(i => list[i % list.length]);
    if (!this.running) { this.colors = this.target.map(c => c.slice()); this.draw(0); }
  }

  setEnergy(e) { this.energyTarget = e; }
  pulse() { this.pulseAmt = 1; }

  start({ animate = true } = {}) {
    this.animate = animate && !reduceMotion();
    if (!this.animate) { this.running = false; this.colors = this.target.map(c => c.slice()); this.draw(0); return; }
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() { this.stop(); this.ro.disconnect(); this.field.remove(); this.sparks.remove(); }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!document.hidden) this.draw(dt);
    this.raf = requestAnimationFrame(this.frame);
  }

  draw(dt) {
    // 色・エネルギーをなめらかに追従
    const k = 1 - Math.pow(0.02, dt);
    this.colors = this.colors.map((c, i) => c.map((v, j) => v + (this.target[i][j] - v) * k));
    this.energy += (this.energyTarget - this.energy) * (1 - Math.pow(0.1, dt));
    this.pulseAmt *= Math.pow(0.25, dt);
    this.t += dt * (0.35 + this.energy * 0.9 + this.pulseAmt * 2.5);

    const g = this.fg, W = this.field.width, H = this.field.height;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#06070b';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const bright = (0.32 + this.energy * 0.3 + this.pulseAmt * 0.35) * this.intensity;
    for (const b of this.blobs) {
      const x = (0.5 + 0.42 * Math.sin(this.t * b.fx * 6.28 + b.px)) * W;
      const y = (0.5 + 0.38 * Math.cos(this.t * b.fy * 6.28 + b.py)) * H;
      const r = b.r * Math.max(W, H) * (1 + this.pulseAmt * 0.25 + Math.sin(this.t * 0.7 + b.px) * 0.06);
      const [cr, cg, cb] = this.colors[b.c];
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${cr | 0},${cg | 0},${cb | 0},${bright})`);
      grad.addColorStop(0.55, `rgba(${cr | 0},${cg | 0},${cb | 0},${bright * 0.35})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }

    // 粒子
    const s = this.sg, SW = this.sparks.width, SH = this.sparks.height;
    s.clearRect(0, 0, SW, SH);
    const speed = 0.25 + this.energy * 0.9 + this.pulseAmt * 3;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.y -= p.v * dt * speed;
      p.x += p.drift * dt;
      p.tw += dt * (1.5 + this.energy * 2);
      if (p.y < -0.05) this.parts[i] = this.newPart();
      const a = (0.25 + 0.55 * (0.5 + 0.5 * Math.sin(p.tw))) * (0.4 + this.energy * 0.6);
      const [cr, cg, cb] = this.colors[i % 3];
      s.fillStyle = `rgba(${Math.min(255, cr + 90) | 0},${Math.min(255, cg + 90) | 0},${Math.min(255, cb + 90) | 0},${a})`;
      s.beginPath();
      s.arc(p.x * SW, p.y * SH, p.r * this.dpr, 0, 6.283);
      s.fill();
    }
  }
}
