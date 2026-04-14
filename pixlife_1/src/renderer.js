// ── Renderer: Pixel Art ──
// Renders the world as a low-resolution pixel grid scaled up.
// Uses an offscreen canvas at low res, then draws it scaled up with image-rendering: pixelated.

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;
    this.pixelScale = 3;
    this.width = Math.floor(this.screenWidth / this.pixelScale);
    this.height = Math.floor(this.screenHeight / this.pixelScale);

    // Offscreen pixel buffer
    this.offCanvas = document.createElement('canvas');
    this.offCanvas.width = this.width;
    this.offCanvas.height = this.height;
    this.offCtx = this.offCanvas.getContext('2d');

    this._resize();
  }

  _resize() {
    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.screenWidth * dpr;
    this.canvas.height = this.screenHeight * dpr;
    this.canvas.style.width = this.screenWidth + 'px';
    this.canvas.style.height = this.screenHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;

    this.width = Math.floor(this.screenWidth / this.pixelScale);
    this.height = Math.floor(this.screenHeight / this.pixelScale);
    this.offCanvas.width = this.width;
    this.offCanvas.height = this.height;
    this.offCtx.imageSmoothingEnabled = false;
  }

  resize() {
    this._resize();
  }

  render(world, inputState) {
    const ctx = this.offCtx;
    const w = this.width;
    const h = this.height;

    // ── Sky / Background ──
    this._drawBackground(ctx, w, h, world);

    // ── Ground ──
    this._drawGround(ctx, w, h, world);

    // ── Ambient particles (behind entities) ──
    for (const p of world.particles) {
      if (p.type === 'pollen') {
        ctx.fillStyle = `rgba(255,240,180,${p.life * 0.4})`;
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
      } else if (p.type === 'firefly') {
        const brightness = 0.3 + Math.sin(world.time * 8 + p.x) * 0.3;
        ctx.fillStyle = `rgba(220,255,100,${p.life * brightness})`;
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
        // Glow
        ctx.fillStyle = `rgba(220,255,100,${p.life * brightness * 0.2})`;
        ctx.fillRect(Math.floor(p.x) - 1, Math.floor(p.y) - 1, 3, 3);
      } else if (p.type === 'sparkle') {
        ctx.fillStyle = `rgba(255,220,150,${p.life * 0.7})`;
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
      }
    }

    // ── Light sources ──
    for (const ls of world.lights) {
      this._drawLightSource(ctx, ls, world);
    }

    // ── Rocks ──
    for (const rock of world.rocks) {
      this._drawRock(ctx, rock);
    }

    // ── Food ──
    for (const food of world.foods) {
      this._drawFood(ctx, food, world.time);
    }

    // ── Creature trails ──
    for (const c of world.creatures) {
      if (!c.alive) continue;
      for (const t of c.trail) {
        ctx.fillStyle = `rgba(180,140,100,${t.life * 0.2})`;
        ctx.fillRect(Math.floor(t.x), Math.floor(t.y), 1, 1);
      }
    }

    // ── Creatures ──
    for (const c of world.creatures) {
      if (!c.alive) continue;
      this._drawCreature(ctx, c, world.time);
    }

    // ── Touch indicator ──
    if (inputState.touching && inputState.current) {
      const tx = Math.floor(inputState.current.x / this.pixelScale);
      const ty = Math.floor(inputState.current.y / this.pixelScale);
      const tool = inputState.tool;
      if (tool === 'touch') {
        // Warm glow circle
        const r = 8 + Math.sin(world.time * 5) * 2;
        this._drawPixelCircle(ctx, tx, ty, Math.floor(r), 'rgba(248,200,112,0.15)');
        this._drawPixelCircle(ctx, tx, ty, Math.floor(r * 0.5), 'rgba(248,200,112,0.1)');
      } else if (tool === 'food') {
        ctx.fillStyle = 'rgba(100,200,80,0.3)';
        this._drawPixelCircle(ctx, tx, ty, 5, 'rgba(100,200,80,0.2)');
      } else if (tool === 'light') {
        this._drawPixelCircle(ctx, tx, ty, 10, 'rgba(255,240,180,0.15)');
      }
    }

    // ── Scale up to main canvas ──
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.offCanvas, 0, 0, this.screenWidth, this.screenHeight);
  }

  _drawBackground(ctx, w, h, world) {
    const light = world.ambientLight;

    // Sky gradient - warm tones
    const skyR = Math.floor(42 + light * 80);
    const skyG = Math.floor(26 + light * 60);
    const skyB = Math.floor(14 + light * 40);
    ctx.fillStyle = `rgb(${skyR},${skyG},${skyB})`;
    ctx.fillRect(0, 0, w, h);

    // Stars at night
    if (world.isNight) {
      const starSeed = 12345;
      for (let i = 0; i < 30; i++) {
        const sx = ((starSeed * (i + 1) * 7) % w);
        const sy = ((starSeed * (i + 1) * 13) % Math.floor(h * 0.4));
        const twinkle = Math.sin(world.time * 2 + i * 1.3) * 0.3 + 0.7;
        ctx.fillStyle = `rgba(255,255,220,${twinkle * 0.6})`;
        ctx.fillRect(Math.floor(sx), Math.floor(sy), 1, 1);
      }
    }
  }

  _drawGround(ctx, w, h, world) {
    const groundY = Math.floor(h * 0.75);
    const light = world.ambientLight;

    // Ground layers
    const groundR = Math.floor(60 + light * 40);
    const groundG = Math.floor(45 + light * 35);
    const groundB = Math.floor(20 + light * 15);

    // Grass-like top
    const grassR = Math.floor(80 + light * 60);
    const grassG = Math.floor(100 + light * 60);
    const grassB = Math.floor(30 + light * 20);

    // Draw ground
    ctx.fillStyle = `rgb(${groundR},${groundG},${groundB})`;
    ctx.fillRect(0, groundY + 2, w, h - groundY - 2);

    // Grass pixels on top of ground
    for (let x = 0; x < w; x++) {
      const grassH = Math.floor(Math.sin(x * 0.5) * 1.5 + 2);
      ctx.fillStyle = `rgb(${grassR + (x % 3) * 5},${grassG + (x % 2) * 8},${grassB})`;
      for (let dy = 0; dy < grassH; dy++) {
        ctx.fillRect(x, groundY - dy, 1, 1);
      }
    }

    // Dirt texture
    for (let x = 0; x < w; x += 3) {
      for (let y = groundY + 3; y < h; y += 4) {
        const shade = ((x * 7 + y * 13) % 5) * 3;
        ctx.fillStyle = `rgb(${groundR - shade},${groundG - shade},${groundB - shade})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  _drawRock(ctx, rock) {
    const x = Math.floor(rock.x);
    const y = Math.floor(rock.y);
    const s = rock.size;
    const shade = rock.shade;

    // Rock body
    const baseR = Math.floor(120 * shade);
    const baseG = Math.floor(110 * shade);
    const baseB = Math.floor(100 * shade);

    // Draw chunky rock pixels
    for (let dy = -s; dy <= s; dy++) {
      const rowWidth = Math.floor(s * (1 - Math.abs(dy) / s * 0.3));
      for (let dx = -rowWidth; dx <= rowWidth; dx++) {
        const px = x + dx;
        const py = y + dy;
        const lightShade = dy < 0 ? 15 : -10; // top lighter
        const noise = ((px * 7 + py * 13) % 5) * 3;
        ctx.fillStyle = `rgb(${baseR + lightShade + noise},${baseG + lightShade + noise},${baseB + lightShade + noise})`;
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }

  _drawFood(ctx, food, time) {
    const x = Math.floor(food.x);
    const y = Math.floor(food.y);
    const phase = food.growthPhase;

    if (food.type === 'plant') {
      // Green plant pixel
      const sway = Math.sin(time * 2 + food.x * 0.3) * 0.5;
      const stemH = Math.floor(2 * phase);
      // Stem
      ctx.fillStyle = '#507030';
      for (let i = 0; i < stemH; i++) {
        ctx.fillRect(x + Math.floor(sway * (i / stemH)), y - i, 1, 1);
      }
      // Leaf
      if (phase > 0.5) {
        ctx.fillStyle = '#70a848';
        ctx.fillRect(x - 1, y - stemH, 1, 1);
        ctx.fillRect(x, y - stemH, 1, 1);
        ctx.fillRect(x + 1, y - stemH, 1, 1);
        ctx.fillRect(x, y - stemH - 1, 1, 1);
      }
    } else {
      // Fruit - warm colored berry
      const pulse = Math.sin(time * 3 + food.y * 0.2) * 0.1;
      ctx.fillStyle = `rgb(${200 + Math.floor(pulse * 50)},${80 + Math.floor(pulse * 30)},${40})`;
      ctx.fillRect(x, y, 2, 2);
      // Highlight
      ctx.fillStyle = 'rgba(255,200,100,0.5)';
      ctx.fillRect(x, y, 1, 1);
    }
  }

  _drawCreature(ctx, creature, time) {
    const x = Math.floor(creature.x);
    const y = Math.floor(creature.y);
    const s = creature.dna.size;
    const color = creature.dna.bodyColor;
    const energyRatio = creature.energy / creature.maxEnergy;

    // Parse body color
    const r = parseInt(color.slice(1,3), 16);
    const g = parseInt(color.slice(3,5), 16);
    const b = parseInt(color.slice(5,7), 16);

    // Body bobbing animation
    const bob = Math.floor(Math.sin(time * 4 + creature.id * 1.7) * 0.8);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let dx = -s + 1; dx < s; dx++) {
      ctx.fillRect(x + dx, y + s + 1, 1, 1);
    }

    // Body
    for (let dy = -s; dy <= s; dy++) {
      const rowW = Math.floor(s * Math.sqrt(1 - (dy * dy) / (s * s + 0.1)));
      for (let dx = -rowW; dx <= rowW; dx++) {
        const shade = dy < 0 ? 20 : -15;
        const cr = Math.max(0, Math.min(255, r + shade));
        const cg = Math.max(0, Math.min(255, g + shade));
        const cb = Math.max(0, Math.min(255, b + shade));
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.fillRect(x + dx, y + dy + bob, 1, 1);
      }
    }

    // Eyes (direction-aware)
    const eyeOffsetX = Math.round(Math.cos(creature.angle) * 1);
    const eyeOffsetY = Math.round(Math.sin(creature.angle) * 1);

    if (s >= 3) {
      // Two eyes
      const eyeY = -Math.floor(s * 0.3) + bob;
      const eyeSpacing = Math.max(1, Math.floor(s * 0.5));

      // Eye whites
      ctx.fillStyle = '#f8f0e0';
      ctx.fillRect(x - eyeSpacing + eyeOffsetX, y + eyeY + eyeOffsetY, 1, 1);
      ctx.fillRect(x + eyeSpacing + eyeOffsetX, y + eyeY + eyeOffsetY, 1, 1);

      // Pupils
      ctx.fillStyle = creature.dna.eyeColor;
      const pupilOx = Math.round(Math.cos(creature.angle) * 0.5);
      const pupilOy = Math.round(Math.sin(creature.angle) * 0.5);
      ctx.fillRect(x - eyeSpacing + eyeOffsetX + pupilOx, y + eyeY + eyeOffsetY + pupilOy, 1, 1);
      ctx.fillRect(x + eyeSpacing + eyeOffsetX + pupilOx, y + eyeY + eyeOffsetY + pupilOy, 1, 1);
    } else {
      // Single eye for tiny creatures
      ctx.fillStyle = '#f8f0e0';
      ctx.fillRect(x + eyeOffsetX, y - 1 + bob + eyeOffsetY, 1, 1);
    }

    // Emotion indicator (pixel expression)
    if (creature.emotion === 'happy') {
      // Small smile pixel below eyes
      ctx.fillStyle = '#f8c870';
      ctx.fillRect(x, y + Math.floor(s * 0.4) + bob, 1, 1);
    } else if (creature.emotion === 'hungry') {
      // Open mouth
      ctx.fillStyle = '#804020';
      ctx.fillRect(x, y + Math.floor(s * 0.3) + bob, 1, 1);
    } else if (creature.emotion === 'sleepy') {
      // Z particle
      const zOff = Math.floor(Math.sin(time * 2) * 2);
      ctx.fillStyle = 'rgba(200,200,255,0.5)';
      ctx.fillRect(x + s + 1, y - s - 1 + zOff + bob, 1, 1);
    }

    // Energy indicator (tiny bar above creature, only when not full)
    if (energyRatio < 0.8) {
      const barW = Math.max(3, s * 2);
      const barX = x - Math.floor(barW / 2);
      const barY = y - s - 3 + bob;
      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let bx = 0; bx < barW; bx++) {
        ctx.fillRect(barX + bx, barY, 1, 1);
      }
      // Fill
      const fillW = Math.floor(barW * energyRatio);
      ctx.fillStyle = energyRatio > 0.3 ? '#70c040' : '#c04020';
      for (let bx = 0; bx < fillW; bx++) {
        ctx.fillRect(barX + bx, barY, 1, 1);
      }
    }

    // Generation indicator (tiny colored dot)
    if (creature.generation > 0) {
      const genHue = (creature.generation * 30) % 360;
      ctx.fillStyle = `hsl(${genHue},70%,60%)`;
      ctx.fillRect(x, y - s - 1 + bob, 1, 1);
    }
  }

  _drawLightSource(ctx, ls, world) {
    const x = Math.floor(ls.x);
    const y = Math.floor(ls.y);
    const r = Math.floor(ls.radius * ls.intensity);

    // Draw radial glow as pixel rings
    for (let ring = r; ring > 0; ring -= 2) {
      const alpha = ls.intensity * 0.05 * (1 - ring / r);
      ctx.fillStyle = `rgba(255,240,180,${alpha})`;
      this._drawPixelCircle(ctx, x, y, ring, null, true);
    }

    // Center bright pixel
    ctx.fillStyle = `rgba(255,255,200,${ls.intensity * 0.8})`;
    ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = `rgba(255,255,200,${ls.intensity * 0.4})`;
    ctx.fillRect(x - 1, y, 1, 1);
    ctx.fillRect(x + 1, y, 1, 1);
    ctx.fillRect(x, y - 1, 1, 1);
    ctx.fillRect(x, y + 1, 1, 1);
  }

  _drawPixelCircle(ctx, cx, cy, radius, color, filled) {
    if (color) ctx.fillStyle = color;
    if (filled) {
      for (let dy = -radius; dy <= radius; dy++) {
        const rowW = Math.floor(Math.sqrt(radius * radius - dy * dy));
        for (let dx = -rowW; dx <= rowW; dx++) {
          ctx.fillRect(cx + dx, cy + dy, 1, 1);
        }
      }
    } else {
      // Bresenham circle
      let x = radius, y = 0, err = 1 - radius;
      while (x >= y) {
        ctx.fillRect(cx + x, cy + y, 1, 1);
        ctx.fillRect(cx - x, cy + y, 1, 1);
        ctx.fillRect(cx + x, cy - y, 1, 1);
        ctx.fillRect(cx - x, cy - y, 1, 1);
        ctx.fillRect(cx + y, cy + x, 1, 1);
        ctx.fillRect(cx - y, cy + x, 1, 1);
        ctx.fillRect(cx + y, cy - x, 1, 1);
        ctx.fillRect(cx - y, cy - x, 1, 1);
        y++;
        if (err < 0) {
          err += 2 * y + 1;
        } else {
          x--;
          err += 2 * (y - x) + 1;
        }
      }
    }
  }
}
