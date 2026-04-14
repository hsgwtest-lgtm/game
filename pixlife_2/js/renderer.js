/**
 * PixLife 2 - Pixel Art Renderer
 * Renders the world with warm pixel aesthetics, day/night cycle, and effects.
 */

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} worldWidth
   * @param {number} worldHeight
   */
  constructor(canvas, worldWidth, worldHeight) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: false });
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    // Internal pixel buffer
    this.imageData = null;
    this.pixels = null;

    this.resize();

    // Camera
    this.camX = 0;
    this.camY = 0;
    this.scale = 1;

    // Warm color palette
    this.bgColors = {
      day: [42, 40, 60],
      dusk: [50, 30, 45],
      night: [15, 15, 30],
      dawn: [55, 35, 50]
    };

    // Nest glow animation
    this.nestGlow = 0;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();

    // Calculate scale to fit world, with integer scaling for pixel-perfect look
    const scaleX = rect.width / this.worldWidth;
    const scaleY = rect.height / this.worldHeight;
    this.scale = Math.max(1, Math.floor(Math.min(scaleX, scaleY)));

    const renderW = this.worldWidth;
    const renderH = this.worldHeight;

    this.canvas.width = renderW;
    this.canvas.height = renderH;
    this.canvas.style.imageRendering = 'pixelated';

    this.imageData = this.ctx.createImageData(renderW, renderH);
    this.pixels = new Uint8Array(this.imageData.data.buffer);
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (sx - rect.left) / rect.width * this.worldWidth;
    const y = (sy - rect.top) / rect.height * this.worldHeight;
    return { x, y };
  }

  /**
   * Get background color based on time of day
   * @param {number} timeOfDay 0-1
   * @returns {number[]} [r, g, b]
   */
  getBackgroundColor(timeOfDay) {
    // Smooth transitions between day phases
    const t = timeOfDay;
    let r, g, b;

    if (t < 0.2) {
      // Night → Dawn
      const p = t / 0.2;
      r = this.lerp(this.bgColors.night[0], this.bgColors.dawn[0], p);
      g = this.lerp(this.bgColors.night[1], this.bgColors.dawn[1], p);
      b = this.lerp(this.bgColors.night[2], this.bgColors.dawn[2], p);
    } else if (t < 0.4) {
      // Dawn → Day
      const p = (t - 0.2) / 0.2;
      r = this.lerp(this.bgColors.dawn[0], this.bgColors.day[0], p);
      g = this.lerp(this.bgColors.dawn[1], this.bgColors.day[1], p);
      b = this.lerp(this.bgColors.dawn[2], this.bgColors.day[2], p);
    } else if (t < 0.7) {
      // Day
      [r, g, b] = this.bgColors.day;
    } else if (t < 0.85) {
      // Day → Dusk
      const p = (t - 0.7) / 0.15;
      r = this.lerp(this.bgColors.day[0], this.bgColors.dusk[0], p);
      g = this.lerp(this.bgColors.day[1], this.bgColors.dusk[1], p);
      b = this.lerp(this.bgColors.day[2], this.bgColors.dusk[2], p);
    } else {
      // Dusk → Night
      const p = (t - 0.85) / 0.15;
      r = this.lerp(this.bgColors.dusk[0], this.bgColors.night[0], p);
      g = this.lerp(this.bgColors.dusk[1], this.bgColors.night[1], p);
      b = this.lerp(this.bgColors.dusk[2], this.bgColors.night[2], p);
    }

    return [Math.floor(r), Math.floor(g), Math.floor(b)];
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Set a pixel in the buffer
   */
  setPixel(x, y, r, g, b, a = 255) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || x >= this.worldWidth || y < 0 || y >= this.worldHeight) return;
    const idx = (y * this.worldWidth + x) * 4;
    if (a < 255) {
      // Alpha blend
      const invA = 1 - a / 255;
      this.pixels[idx] = Math.floor(r * (a / 255) + this.pixels[idx] * invA);
      this.pixels[idx + 1] = Math.floor(g * (a / 255) + this.pixels[idx + 1] * invA);
      this.pixels[idx + 2] = Math.floor(b * (a / 255) + this.pixels[idx + 2] * invA);
      this.pixels[idx + 3] = 255;
    } else {
      this.pixels[idx] = r;
      this.pixels[idx + 1] = g;
      this.pixels[idx + 2] = b;
      this.pixels[idx + 3] = 255;
    }
  }

  /**
   * Draw a filled circle
   */
  fillCircle(cx, cy, radius, r, g, b, a = 255) {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= r2) {
          this.setPixel(cx + dx, cy + dy, r, g, b, a);
        }
      }
    }
  }

  /**
   * Main render function
   * @param {import('./world.js').World} world
   * @param {object} options
   */
  render(world, options = {}) {
    const w = this.worldWidth;
    const h = this.worldHeight;
    const pixels = this.pixels;

    // Background
    const [bgR, bgG, bgB] = this.getBackgroundColor(world.timeOfDay);
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      pixels[idx] = bgR;
      pixels[idx + 1] = bgG;
      pixels[idx + 2] = bgB;
      pixels[idx + 3] = 255;
    }

    // Render ground texture (subtle noise)
    if (world.tick % 60 === 0 || !this._groundNoise) {
      this._groundNoise = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        this._groundNoise[i] = Math.floor(Math.random() * 6);
      }
    }
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      const noise = this._groundNoise[i];
      pixels[idx] += noise;
      pixels[idx + 1] += noise;
      pixels[idx + 2] += noise;
    }

    // Render obstacles
    for (let i = 0; i < w * h; i++) {
      if (world.obstacles[i] === 1) {
        const idx = i * 4;
        pixels[idx] = 80;
        pixels[idx + 1] = 70;
        pixels[idx + 2] = 65;
        pixels[idx + 3] = 255;
      } else if (world.obstacles[i] === 2) {
        const idx = i * 4;
        pixels[idx] = 40;
        pixels[idx + 1] = 80;
        pixels[idx + 2] = 120;
        pixels[idx + 3] = 255;
      }
    }

    // Render pheromones (subtle glow)
    if (options.showPheromones !== false) {
      for (let i = 0; i < w * h; i++) {
        const forage = world.pheromones[0][i];
        const retPhero = world.pheromones[1][i];
        if (forage > 0.01 || retPhero > 0.01) {
          const idx = i * 4;
          // Forage pheromone: warm orange tint
          if (forage > 0.01) {
            const intensity = Math.min(forage * 60, 40);
            pixels[idx] = Math.min(255, pixels[idx] + intensity);
            pixels[idx + 1] = Math.min(255, pixels[idx + 1] + intensity * 0.5);
          }
          // Return pheromone: cool blue tint
          if (retPhero > 0.01) {
            const intensity = Math.min(retPhero * 50, 35);
            pixels[idx + 1] = Math.min(255, pixels[idx + 1] + intensity * 0.3);
            pixels[idx + 2] = Math.min(255, pixels[idx + 2] + intensity);
          }
        }
      }
    }

    // Render nest with warm glow
    this.nestGlow = (this.nestGlow + 0.03) % (Math.PI * 2);
    const glowIntensity = 0.6 + Math.sin(this.nestGlow) * 0.2;
    const nestR = world.nestRadius;

    // Nest glow (outer)
    for (let dy = -nestR - 4; dy <= nestR + 4; dy++) {
      for (let dx = -nestR - 4; dx <= nestR + 4; dx++) {
        const px = world.nestX + dx;
        const py = world.nestY + dy;
        const dist = Math.hypot(dx, dy);
        if (dist < nestR + 4 && px >= 0 && px < w && py >= 0 && py < h) {
          const fade = 1 - dist / (nestR + 4);
          const glow = fade * glowIntensity * 30;
          const idx = (py * w + px) * 4;
          pixels[idx] = Math.min(255, pixels[idx] + glow * 1.2);
          pixels[idx + 1] = Math.min(255, pixels[idx + 1] + glow * 0.7);
          pixels[idx + 2] = Math.min(255, pixels[idx + 2] + glow * 0.3);
        }
      }
    }

    // Nest body
    for (let dy = -nestR; dy <= nestR; dy++) {
      for (let dx = -nestR; dx <= nestR; dx++) {
        if (dx * dx + dy * dy <= nestR * nestR) {
          const px = world.nestX + dx;
          const py = world.nestY + dy;
          if (px >= 0 && px < w && py >= 0 && py < h) {
            const dist = Math.hypot(dx, dy) / nestR;
            const r = Math.floor(120 - dist * 30);
            const g = Math.floor(80 - dist * 20);
            const b = Math.floor(50 - dist * 15);
            this.setPixel(px, py, r, g, b);
          }
        }
      }
    }

    // Nest center
    this.setPixel(world.nestX, world.nestY, 180, 140, 80);
    this.setPixel(world.nestX + 1, world.nestY, 160, 120, 70);
    this.setPixel(world.nestX, world.nestY + 1, 160, 120, 70);

    // Render food
    for (const food of world.foods) {
      const fx = Math.floor(food.x);
      const fy = Math.floor(food.y);
      const [fr, fg, fb] = food.color;
      // Pulsating glow
      const foodGlow = 0.7 + Math.sin(world.tick * 0.05 + food.x * 0.3) * 0.3;
      this.setPixel(fx, fy, Math.floor(fr * foodGlow), Math.floor(fg * foodGlow), Math.floor(fb * foodGlow));
      // Sometimes show a tiny sparkle
      if (food.age < 100 && world.tick % 20 < 5) {
        this.setPixel(fx + 1, fy, Math.min(255, fr + 60), Math.min(255, fg + 60), Math.min(255, fb + 60), 150);
      }
    }

    // Render creatures
    for (const creature of world.creatures) {
      if (!creature.alive) continue;
      const cx = Math.floor(creature.x);
      const cy = Math.floor(creature.y);
      const [cr, cg, cb, ca] = creature.getColor();

      if (creature.size === 1) {
        // 1 pixel creature
        this.setPixel(cx, cy, cr, cg, cb, ca);
      } else if (creature.size === 2) {
        // 2x2 creature
        this.setPixel(cx, cy, cr, cg, cb, ca);
        this.setPixel(cx + 1, cy, cr - 10, cg - 10, cb - 10, ca);
        this.setPixel(cx, cy + 1, cr - 10, cg - 10, cb - 10, ca);
        this.setPixel(cx + 1, cy + 1, cr - 20, cg - 20, cb - 20, ca);
      } else {
        // Larger creatures: filled circle with shading
        const r = Math.floor(creature.size / 2);
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy <= r * r) {
              const shade = 1 - Math.hypot(dx, dy) / (r + 1) * 0.3;
              this.setPixel(
                cx + dx, cy + dy,
                Math.floor(cr * shade),
                Math.floor(cg * shade),
                Math.floor(cb * shade),
                ca
              );
            }
          }
        }
      }

      // Show carrying indicator (small bright pixel above)
      if (creature.carryingFood) {
        this.setPixel(cx, cy - creature.size - 1, 255, 220, 100);
      }

      // Show low energy indicator
      if (creature.energy < 15) {
        if (world.tick % 10 < 5) {
          this.setPixel(cx, cy - creature.size - 1, 255, 50, 50);
        }
      }
    }

    // Highlight selected creature
    if (options.selectedCreature) {
      const sc = options.selectedCreature;
      if (sc.alive) {
        const r = Math.max(3, sc.size + 2);
        // Draw selection ring
        for (let angle = 0; angle < Math.PI * 2; angle += 0.3) {
          const px = Math.floor(sc.x + Math.cos(angle) * r);
          const py = Math.floor(sc.y + Math.sin(angle) * r);
          this.setPixel(px, py, 255, 255, 200, 150);
        }
      }
    }

    // Day/night ambient lighting overlay
    const nightFactor = this.getNightFactor(world.timeOfDay);
    if (nightFactor > 0.05) {
      for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        pixels[idx] = Math.floor(pixels[idx] * (1 - nightFactor * 0.3));
        pixels[idx + 1] = Math.floor(pixels[idx + 1] * (1 - nightFactor * 0.4));
        pixels[idx + 2] = Math.min(255, Math.floor(pixels[idx + 2] * (1 - nightFactor * 0.1) + nightFactor * 8));
      }
    }

    // Put the pixel buffer onto the canvas
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  /**
   * Get how "night" it is (0 = full day, 1 = full night)
   */
  getNightFactor(timeOfDay) {
    if (timeOfDay < 0.2) return 1 - timeOfDay / 0.2;
    if (timeOfDay < 0.75) return 0;
    return (timeOfDay - 0.75) / 0.25;
  }
}
