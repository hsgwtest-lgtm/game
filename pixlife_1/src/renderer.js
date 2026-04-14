// ── Renderer: Pixel Art ──
// Renders the world at low resolution scaled up 3× for crisp pixel art.
// New in v2: pheromone trail overlay, ant nest, carrying-state creature.

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.pixelScale = 3;

    this.offCanvas = document.createElement('canvas');
    this.offCtx    = this.offCanvas.getContext('2d');

    this._resize();
  }

  _resize() {
    this.screenWidth  = window.innerWidth;
    this.screenHeight = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width  = this.screenWidth  * dpr;
    this.canvas.height = this.screenHeight * dpr;
    this.canvas.style.width  = this.screenWidth  + 'px';
    this.canvas.style.height = this.screenHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;

    this.width  = Math.floor(this.screenWidth  / this.pixelScale);
    this.height = Math.floor(this.screenHeight / this.pixelScale);
    this.offCanvas.width  = this.width;
    this.offCanvas.height = this.height;
    this.offCtx.imageSmoothingEnabled = false;
  }

  resize() { this._resize(); }

  render(world, inputState) {
    const ctx = this.offCtx;
    const w = this.width, h = this.height;

    // Background / sky
    this._drawBackground(ctx, w, h, world);
    // Ground
    this._drawGround(ctx, w, h, world);
    // Pheromone trails (subtle warm overlay)
    this._drawPheromones(ctx, world);
    // Ambient particles (behind entities)
    this._drawParticles(ctx, world);
    // Light sources
    for (const ls of world.lights) this._drawLightSource(ctx, ls, world);
    // Rocks
    for (const rock of world.rocks) this._drawRock(ctx, rock);
    // Nest
    if (world.nest) this._drawNest(ctx, world.nest, world);
    // Food
    for (const food of world.foods) this._drawFood(ctx, food, world.time);
    // Creature trails
    for (const c of world.creatures) {
      if (!c.alive) continue;
      for (const t of c.trail) {
        ctx.fillStyle = `rgba(180,140,100,${t.life * 0.18})`;
        ctx.fillRect(Math.floor(t.x), Math.floor(t.y), 1, 1);
      }
    }
    // Creatures
    for (const c of world.creatures) {
      if (c.alive) this._drawCreature(ctx, c, world.time);
    }
    // Touch indicator
    this._drawTouchIndicator(ctx, world, inputState);

    // Scale up to main canvas
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.offCanvas, 0, 0, this.screenWidth, this.screenHeight);
  }

  // ── Background / sky ──
  _drawBackground(ctx, w, h, world) {
    const light = world.ambientLight;
    ctx.fillStyle = `rgb(${Math.floor(42 + light * 80)},${Math.floor(26 + light * 60)},${Math.floor(14 + light * 40)})`;
    ctx.fillRect(0, 0, w, h);

    if (world.isNight) {
      const seed = 12345;
      for (let i = 0; i < 30; i++) {
        const sx = (seed * (i + 1) * 7) % w;
        const sy = (seed * (i + 1) * 13) % Math.floor(h * 0.4);
        const tw = Math.sin(world.time * 2 + i * 1.3) * 0.3 + 0.7;
        ctx.fillStyle = `rgba(255,255,220,${tw * 0.6})`;
        ctx.fillRect(Math.floor(sx), Math.floor(sy), 1, 1);
      }
    }
  }

  // ── Ground ──
  _drawGround(ctx, w, h, world) {
    const groundY = Math.floor(h * 0.75);
    const light = world.ambientLight;
    const groundR = Math.floor(60 + light * 40);
    const groundG = Math.floor(45 + light * 35);
    const groundB = Math.floor(20 + light * 15);
    const grassR  = Math.floor(80 + light * 60);
    const grassG  = Math.floor(100 + light * 60);
    const grassB  = Math.floor(30 + light * 20);

    ctx.fillStyle = `rgb(${groundR},${groundG},${groundB})`;
    ctx.fillRect(0, groundY + 2, w, h - groundY - 2);

    for (let x = 0; x < w; x++) {
      const gH = Math.floor(Math.sin(x * 0.5) * 1.5 + 2);
      ctx.fillStyle = `rgb(${grassR + (x % 3) * 5},${grassG + (x % 2) * 8},${grassB})`;
      for (let dy = 0; dy < gH; dy++) ctx.fillRect(x, groundY - dy, 1, 1);
    }

    for (let x = 0; x < w; x += 3) {
      for (let y = groundY + 3; y < h; y += 4) {
        const shade = ((x * 7 + y * 13) % 5) * 3;
        ctx.fillStyle = `rgb(${groundR - shade},${groundG - shade},${groundB - shade})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  // ── Pheromone trails ──
  _drawPheromones(ctx, world) {
    const ps = world.pheroSize;
    const gw = world.pheroWidth;
    const gh = world.pheroHeight;
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        const val = world.pheromones[cy * gw + cx];
        if (val < 0.04) continue;
        const px = cx * ps;
        const py = cy * ps;
        // Warm amber trail
        ctx.fillStyle = `rgba(210,160,50,${val * 0.28})`;
        ctx.fillRect(px, py, ps, ps);
      }
    }
  }

  // ── Nest (ant mound) ──
  _drawNest(ctx, nest, world) {
    const nx = Math.floor(nest.x);
    const ny = Math.floor(nest.y);
    const r  = nest.radius;
    const pulse = 0.88 + Math.sin(nest.pulseTimer * 1.5) * 0.08;
    const light = world.ambientLight;

    // Earthen mound shape
    for (let dy = -Math.floor(r * 0.75); dy <= Math.floor(r * 0.45); dy++) {
      const ellH = r * 0.75 + r * 0.45;
      const normY = (dy + r * 0.75) / ellH;
      const rowW  = Math.floor(r * Math.sqrt(Math.max(0, normY * (2 - normY))));
      for (let dx = -rowW; dx <= rowW; dx++) {
        const depth = normY;
        const base  = Math.floor(65 + (1 - depth) * 25 + light * 15);
        const noise = ((nx + dx) * 7 + (ny + dy) * 13) % 9;
        ctx.fillStyle = `rgb(${base + noise},${Math.floor(base * 0.68) + noise / 2},${Math.floor(base * 0.35) + noise / 3})`;
        ctx.fillRect(nx + dx, ny + dy, 1, 1);
      }
    }

    // Dark entrance tunnel
    ctx.fillStyle = '#0c0805';
    ctx.fillRect(nx - 2, ny - 1, 5, 2);
    ctx.fillStyle = '#18100a';
    ctx.fillRect(nx - 1, ny,  3, 1);
    // Entrance highlight
    ctx.fillStyle = 'rgba(180,130,60,0.5)';
    ctx.fillRect(nx - 2, ny - 2, 5, 1);

    // Stored-food sparkle dots orbiting inside mound
    const storedDots = Math.min(nest.foodStored, 16);
    if (storedDots > 0) {
      for (let i = 0; i < storedDots; i++) {
        const a  = (i / 16) * Math.PI * 2 + nest.pulseTimer * 0.25;
        const fr = Math.floor(r * 0.42 * pulse);
        const fx = nx + Math.floor(Math.cos(a) * fr);
        const fy = ny + Math.floor(Math.sin(a) * fr * 0.55 + 1);
        ctx.fillStyle = `rgba(248,210,100,${0.45 + pulse * 0.35})`;
        ctx.fillRect(fx, fy, 1, 1);
      }
    }

    // Nest label area indicator: faint ring
    ctx.fillStyle = `rgba(220,170,80,${0.05 + Math.sin(nest.pulseTimer * 0.8) * 0.03})`;
    this._drawPixelCircle(ctx, nx, ny, r + 2, null, true);
  }

  // ── Ambient particles ──
  _drawParticles(ctx, world) {
    for (const p of world.particles) {
      if (p.type === 'pollen') {
        ctx.fillStyle = `rgba(255,240,180,${p.life * 0.4})`;
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
      } else if (p.type === 'firefly') {
        const bright = 0.3 + Math.sin(world.time * 8 + p.x) * 0.3;
        ctx.fillStyle = `rgba(220,255,100,${p.life * bright})`;
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
        ctx.fillStyle = `rgba(220,255,100,${p.life * bright * 0.2})`;
        ctx.fillRect(Math.floor(p.x) - 1, Math.floor(p.y) - 1, 3, 3);
      } else if (p.type === 'sparkle') {
        ctx.fillStyle = `rgba(255,220,150,${p.life * 0.7})`;
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
      }
    }
  }

  // ── Rock ──
  _drawRock(ctx, rock) {
    const x = Math.floor(rock.x), y = Math.floor(rock.y), s = rock.size;
    const shade = rock.shade;
    const bR = Math.floor(120 * shade), bG = Math.floor(110 * shade), bB = Math.floor(100 * shade);
    for (let dy = -s; dy <= s; dy++) {
      const rowW = Math.floor(s * (1 - Math.abs(dy) / s * 0.3));
      for (let dx = -rowW; dx <= rowW; dx++) {
        const ls = dy < 0 ? 15 : -10;
        const n  = ((x + dx) * 7 + (y + dy) * 13) % 5 * 3;
        ctx.fillStyle = `rgb(${bR + ls + n},${bG + ls + n},${bB + ls + n})`;
        ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
  }

  // ── Food ──
  _drawFood(ctx, food, time) {
    const x = Math.floor(food.x), y = Math.floor(food.y);
    const ph = food.growthPhase;
    if (food.type === 'plant') {
      const sway = Math.sin(time * 2 + food.x * 0.3) * 0.5;
      const stemH = Math.floor(2 * ph);
      ctx.fillStyle = '#507030';
      for (let i = 0; i < stemH; i++) ctx.fillRect(x + Math.floor(sway * (i / stemH)), y - i, 1, 1);
      if (ph > 0.5) {
        ctx.fillStyle = '#70a848';
        ctx.fillRect(x - 1, y - stemH, 1, 1);
        ctx.fillRect(x,     y - stemH, 1, 1);
        ctx.fillRect(x + 1, y - stemH, 1, 1);
        ctx.fillRect(x,     y - stemH - 1, 1, 1);
      }
    } else {
      const pulse = Math.sin(time * 3 + food.y * 0.2) * 0.1;
      ctx.fillStyle = `rgb(${200 + Math.floor(pulse * 50)},${80 + Math.floor(pulse * 30)},40)`;
      ctx.fillRect(x, y, 2, 2);
      ctx.fillStyle = 'rgba(255,200,100,0.5)';
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // ── Creature ──
  _drawCreature(ctx, creature, time) {
    const x = Math.floor(creature.x), y = Math.floor(creature.y);
    const s = creature.dna.size;
    const col = creature.dna.bodyColor;
    const energyRatio = creature.energy / creature.maxEnergy;

    const r = parseInt(col.slice(1,3), 16);
    const g = parseInt(col.slice(3,5), 16);
    const b = parseInt(col.slice(5,7), 16);

    const bob = Math.floor(Math.sin(time * 4 + creature.id * 1.7) * 0.8);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let dx = -s + 1; dx < s; dx++) ctx.fillRect(x + dx, y + s + 1, 1, 1);

    // Body (circle)
    for (let dy = -s; dy <= s; dy++) {
      const rowW = Math.floor(s * Math.sqrt(1 - (dy * dy) / (s * s + 0.1)));
      for (let dx = -rowW; dx <= rowW; dx++) {
        const sh = dy < 0 ? 20 : -15;
        ctx.fillStyle = `rgb(${Math.max(0,Math.min(255,r+sh))},${Math.max(0,Math.min(255,g+sh))},${Math.max(0,Math.min(255,b+sh))})`;
        ctx.fillRect(x + dx, y + dy + bob, 1, 1);
      }
    }

    // Eyes (direction-aware)
    const eyeOx = Math.round(Math.cos(creature.angle));
    const eyeOy = Math.round(Math.sin(creature.angle));
    if (s >= 3) {
      const eyeY  = -Math.floor(s * 0.3) + bob;
      const eyeS  = Math.max(1, Math.floor(s * 0.5));
      ctx.fillStyle = '#f8f0e0';
      ctx.fillRect(x - eyeS + eyeOx, y + eyeY + eyeOy, 1, 1);
      ctx.fillRect(x + eyeS + eyeOx, y + eyeY + eyeOy, 1, 1);
      ctx.fillStyle = creature.dna.eyeColor;
      const pox = Math.round(Math.cos(creature.angle) * 0.5);
      const poy = Math.round(Math.sin(creature.angle) * 0.5);
      ctx.fillRect(x - eyeS + eyeOx + pox, y + eyeY + eyeOy + poy, 1, 1);
      ctx.fillRect(x + eyeS + eyeOx + pox, y + eyeY + eyeOy + poy, 1, 1);
    } else {
      ctx.fillStyle = '#f8f0e0';
      ctx.fillRect(x + eyeOx, y - 1 + bob + eyeOy, 1, 1);
    }

    // Emotion indicators
    if (creature.emotion === 'happy') {
      ctx.fillStyle = '#f8c870';
      ctx.fillRect(x, y + Math.floor(s * 0.4) + bob, 1, 1);
    } else if (creature.emotion === 'hungry') {
      ctx.fillStyle = '#804020';
      ctx.fillRect(x, y + Math.floor(s * 0.3) + bob, 1, 1);
    } else if (creature.emotion === 'sleepy') {
      const zo = Math.floor(Math.sin(time * 2) * 2);
      ctx.fillStyle = 'rgba(200,200,255,0.5)';
      ctx.fillRect(x + s + 1, y - s - 1 + zo + bob, 1, 1);
    }

    // Carried food pixel (above head when in carrying state)
    if (creature.state === 'carrying') {
      const fc = creature.carryingFood;
      if (fc) {
        ctx.fillStyle = fc.type === 'fruit' ? '#d04830' : '#70a848';
      } else {
        ctx.fillStyle = '#70a848';
      }
      ctx.fillRect(x, y - s - 2 + bob, 1, 1);
      // Tiny highlight
      ctx.fillStyle = 'rgba(255,255,180,0.5)';
      ctx.fillRect(x, y - s - 2 + bob, 1, 1);
    }

    // Energy bar (only when low)
    if (energyRatio < 0.8) {
      const barW = Math.max(3, s * 2);
      const barX = x - Math.floor(barW / 2);
      const barY = y - s - 3 + bob;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let bx = 0; bx < barW; bx++) ctx.fillRect(barX + bx, barY, 1, 1);
      const fillW = Math.floor(barW * energyRatio);
      ctx.fillStyle = energyRatio > 0.3 ? '#70c040' : '#c04020';
      for (let bx = 0; bx < fillW; bx++) ctx.fillRect(barX + bx, barY, 1, 1);
    }

    // Generation dot
    if (creature.generation > 0) {
      ctx.fillStyle = `hsl(${(creature.generation * 30) % 360},70%,60%)`;
      ctx.fillRect(x, y - s - 1 + bob, 1, 1);
    }
  }

  // ── Light source ──
  _drawLightSource(ctx, ls, world) {
    const x = Math.floor(ls.x), y = Math.floor(ls.y);
    const r = Math.floor(ls.radius * ls.intensity);
    for (let ring = r; ring > 0; ring -= 2) {
      ctx.fillStyle = `rgba(255,240,180,${ls.intensity * 0.05 * (1 - ring / r)})`;
      this._drawPixelCircle(ctx, x, y, ring, null, true);
    }
    ctx.fillStyle = `rgba(255,255,200,${ls.intensity * 0.8})`;
    ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = `rgba(255,255,200,${ls.intensity * 0.4})`;
    ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1);
    ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1);
  }

  // ── Touch indicator ──
  _drawTouchIndicator(ctx, world, inputState) {
    if (!inputState.touching || !inputState.current) return;
    const tx = Math.floor(inputState.current.x / this.pixelScale);
    const ty = Math.floor(inputState.current.y / this.pixelScale);
    const tool = inputState.tool;
    if (tool === 'touch') {
      const rr = 8 + Math.sin(world.time * 5) * 2;
      this._drawPixelCircle(ctx, tx, ty, Math.floor(rr), 'rgba(248,200,112,0.15)');
      this._drawPixelCircle(ctx, tx, ty, Math.floor(rr * 0.5), 'rgba(248,200,112,0.1)');
    } else if (tool === 'food') {
      ctx.fillStyle = 'rgba(100,200,80,0.3)';
      this._drawPixelCircle(ctx, tx, ty, 5, 'rgba(100,200,80,0.2)');
    } else if (tool === 'light') {
      this._drawPixelCircle(ctx, tx, ty, 10, 'rgba(255,240,180,0.15)');
    }
  }

  // ── Pixel circle helper ──
  _drawPixelCircle(ctx, cx, cy, radius, color, filled) {
    if (color) ctx.fillStyle = color;
    if (filled) {
      for (let dy = -radius; dy <= radius; dy++) {
        const rw = Math.floor(Math.sqrt(radius * radius - dy * dy));
        for (let dx = -rw; dx <= rw; dx++) ctx.fillRect(cx + dx, cy + dy, 1, 1);
      }
    } else {
      let x = radius, y = 0, err = 1 - radius;
      while (x >= y) {
        ctx.fillRect(cx + x, cy + y, 1, 1); ctx.fillRect(cx - x, cy + y, 1, 1);
        ctx.fillRect(cx + x, cy - y, 1, 1); ctx.fillRect(cx - x, cy - y, 1, 1);
        ctx.fillRect(cx + y, cy + x, 1, 1); ctx.fillRect(cx - y, cy + x, 1, 1);
        ctx.fillRect(cx + y, cy - x, 1, 1); ctx.fillRect(cx - y, cy - x, 1, 1);
        y++;
        if (err < 0) { err += 2 * y + 1; } else { x--; err += 2 * (y - x) + 1; }
      }
    }
  }
}
