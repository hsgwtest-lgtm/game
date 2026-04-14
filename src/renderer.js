// ── Renderer ──
// Draws entities as organic metaball-like shapes, nutrients, walls, decay.

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._resize();
    this._bgGradient = null;
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.width = w;
    this.height = h;
    this._bgGradient = null;
  }

  resize() {
    this._resize();
  }

  render(world, inputState) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // ── Background ──
    if (!this._bgGradient) {
      this._bgGradient = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w,h)*0.7);
      this._bgGradient.addColorStop(0, '#0e1230');
      this._bgGradient.addColorStop(1, '#060610');
    }
    ctx.fillStyle = this._bgGradient;
    ctx.fillRect(0, 0, w, h);

    // ── Grid (subtle) ──
    ctx.strokeStyle = 'rgba(100,120,255,0.03)';
    ctx.lineWidth = 0.5;
    const gridSize = 40;
    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // ── Walls ──
    ctx.strokeStyle = 'rgba(180,200,255,0.5)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (const wall of world.physics.walls) {
      ctx.beginPath();
      ctx.moveTo(wall.a.x, wall.a.y);
      ctx.lineTo(wall.b.x, wall.b.y);
      ctx.stroke();
    }
    // Wall being drawn
    if (inputState.drawingWall && inputState.wallStart) {
      ctx.strokeStyle = 'rgba(180,200,255,0.3)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(inputState.wallStart.x, inputState.wallStart.y);
      ctx.lineTo(inputState.current.x, inputState.current.y);
      ctx.stroke();
    }

    // ── Decay particles ──
    for (const p of world.decayParticles) {
      ctx.globalAlpha = p.life * 0.7;
      ctx.fillStyle = `hsl(30, 60%, 50%)`;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.radius * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── Nutrients ──
    for (const n of world.nutrients) {
      const glow = 0.5 + Math.sin(world.time * 3 + n.pos.x * 0.05) * 0.2;
      ctx.globalAlpha = 0.7 + glow * 0.3;
      ctx.fillStyle = `hsl(${n.hue}, 80%, 55%)`;
      ctx.beginPath();
      ctx.arc(n.pos.x, n.pos.y, n.radius, 0, Math.PI * 2);
      ctx.fill();
      // glow
      ctx.globalAlpha = 0.15;
      ctx.beginPath();
      ctx.arc(n.pos.x, n.pos.y, n.radius * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── Entities ──
    for (const e of world.entities) {
      if (!e.alive) continue;
      this._drawEntity(ctx, e, world.time);
    }

    // ── Touch indicator ──
    if (inputState.touching && inputState.current) {
      const mode = inputState.tool;
      if (mode === 'gravity') {
        ctx.strokeStyle = 'rgba(102,255,102,0.3)';
        ctx.lineWidth = 2;
        const r = 40 + Math.sin(world.time * 4) * 8;
        ctx.beginPath();
        ctx.arc(inputState.current.x, inputState.current.y, r, 0, Math.PI * 2);
        ctx.stroke();
        // Spiral lines
        for (let i = 0; i < 3; i++) {
          const a = world.time * 3 + i * Math.PI * 2 / 3;
          ctx.beginPath();
          ctx.moveTo(
            inputState.current.x + Math.cos(a) * r,
            inputState.current.y + Math.sin(a) * r
          );
          ctx.lineTo(
            inputState.current.x + Math.cos(a) * (r * 0.4),
            inputState.current.y + Math.sin(a) * (r * 0.4)
          );
          ctx.stroke();
        }
      } else if (mode === 'feed') {
        ctx.fillStyle = 'rgba(102,255,102,0.15)';
        ctx.beginPath();
        ctx.arc(inputState.current.x, inputState.current.y, 30, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawEntity(ctx, entity, time) {
    const nodes = entity.nodes;
    const g = entity.gene;
    const center = entity.core.pos;
    const energyRatio = entity.energy / entity.maxEnergy;

    // ── Organic body shape (metaball-like) ──
    // Draw filled organic body using cardinal spline through petal nodes
    if (nodes.length > 2) {
      const petalNodes = nodes.slice(1); // skip core

      ctx.beginPath();
      // Use smooth curve through petal positions
      const pts = petalNodes.map(n => n.pos);
      this._drawSmoothCurve(ctx, pts, true);

      // Gradient fill
      const r = entity.getRadius();
      const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, r * 1.3);
      const baseHue = g.hue;
      const sat = 60 + energyRatio * 30;
      const lit = 35 + energyRatio * 20;
      grad.addColorStop(0, `hsla(${baseHue}, ${sat}%, ${lit + 15}%, 0.9)`);
      grad.addColorStop(0.6, `hsla(${baseHue}, ${sat}%, ${lit}%, 0.7)`);
      grad.addColorStop(1, `hsla(${baseHue}, ${sat}%, ${lit - 10}%, 0.3)`);
      ctx.fillStyle = grad;
      ctx.fill();

      // Outline
      ctx.strokeStyle = `hsla(${baseHue}, ${sat + 10}%, ${lit + 20}%, 0.5)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // ── Springs (internal structure, subtle) ──
    ctx.strokeStyle = `hsla(${g.hue}, 40%, 50%, 0.15)`;
    ctx.lineWidth = 0.8;
    for (const s of entity.springs) {
      if (s.broken) continue;
      ctx.beginPath();
      ctx.moveTo(s.a.pos.x, s.a.pos.y);
      ctx.lineTo(s.b.pos.x, s.b.pos.y);
      ctx.stroke();
    }

    // ── Core (nucleus) ──
    const pulse = Math.sin(time * g.pulseFreq * Math.PI * 2 + entity._phaseOffset);
    const coreR = 3 + pulse * 1 + energyRatio * 3;
    const coreGrad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, coreR * 2);
    coreGrad.addColorStop(0, `hsla(${g.hue + 30}, 90%, 80%, 0.9)`);
    coreGrad.addColorStop(1, `hsla(${g.hue + 30}, 90%, 60%, 0)`);
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(center.x, center.y, coreR * 2, 0, Math.PI * 2);
    ctx.fill();

    // ── Energy bar (tiny) ──
    if (energyRatio < 0.9) {
      const barW = 16;
      const barH = 2;
      const bx = center.x - barW / 2;
      const by = center.y - entity.getRadius() - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(bx, by, barW, barH);
      const eColor = energyRatio > 0.3 ? `hsl(${120 * energyRatio}, 80%, 50%)` : 'hsl(0, 80%, 50%)';
      ctx.fillStyle = eColor;
      ctx.fillRect(bx, by, barW * energyRatio, barH);
    }
  }

  _drawSmoothCurve(ctx, pts, closed) {
    if (pts.length < 2) return;
    const n = pts.length;
    if (closed) {
      ctx.moveTo(
        (pts[n-1].x + pts[0].x) / 2,
        (pts[n-1].y + pts[0].y) / 2
      );
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        const mx = (pts[i].x + pts[next].x) / 2;
        const my = (pts[i].y + pts[next].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.closePath();
    } else {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < n - 1; i++) {
        const mx = (pts[i].x + pts[i+1].x) / 2;
        const my = (pts[i].y + pts[i+1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[n-1].x, pts[n-1].y);
    }
  }
}
