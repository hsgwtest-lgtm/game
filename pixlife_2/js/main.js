/**
 * PixLife 2 - Main Game Controller
 * Handles game loop, user input, UI, and PWA setup.
 */

import { World } from './world.js';
import { Renderer } from './renderer.js';
import { Creature } from './creature.js';
import { NeuralNet } from './neural.js';

// World dimensions (pixel art scale)
const WORLD_W = 200;
const WORLD_H = 320;

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.world = new World(WORLD_W, WORLD_H);
    this.renderer = new Renderer(this.canvas, WORLD_W, WORLD_H);

    // Game state
    this.running = false;
    this.speed = 1; // 1x, 2x, 4x
    this.selectedTool = 'food'; // 'food', 'wall', 'water', 'nudge', 'inspect'
    this.selectedCreature = null;

    // Touch tracking
    this.lastTouch = null;
    this.touchStartTime = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    // Performance
    this.lastFrameTime = 0;
    this.frameCount = 0;
    this.fps = 0;
    this.fpsTimer = 0;

    // Auto-save interval
    this.autoSaveInterval = 30000; // 30 seconds
    this.lastSaveTime = 0;

    this.setupUI();
    this.setupInput();
  }

  setupUI() {
    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tool = btn.dataset.tool;
        this.selectTool(tool);
      });
    });

    // Speed buttons
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const speed = parseInt(btn.dataset.speed);
        this.setSpeed(speed);
      });
    });

    // Start button
    document.getElementById('start-btn').addEventListener('click', () => {
      this.start();
    });

    // Resize handler
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => this.renderer.resize(), 200);
    });
  }

  setupInput() {
    const canvas = this.canvas;

    // Mouse events
    canvas.addEventListener('mousedown', (e) => this.onPointerDown(e.clientX, e.clientY, e));
    canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging) this.onPointerMove(e.clientX, e.clientY, e);
    });
    canvas.addEventListener('mouseup', (e) => this.onPointerUp(e.clientX, e.clientY, e));

    // Touch events
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      this.onPointerDown(t.clientX, t.clientY, e);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      this.onPointerMove(t.clientX, t.clientY, e);
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (this.lastTouch) {
        this.onPointerUp(this.lastTouch.x, this.lastTouch.y, e);
      }
    }, { passive: false });
  }

  onPointerDown(sx, sy, e) {
    const pos = this.renderer.screenToWorld(sx, sy);
    this.isDragging = true;
    this.dragStartX = pos.x;
    this.dragStartY = pos.y;
    this.touchStartTime = Date.now();
    this.lastTouch = { x: sx, y: sy };

    // For continuous tools, start applying immediately
    if (this.selectedTool === 'wall' || this.selectedTool === 'water') {
      this.applyTool(pos.x, pos.y);
    }
  }

  onPointerMove(sx, sy, e) {
    const pos = this.renderer.screenToWorld(sx, sy);
    this.lastTouch = { x: sx, y: sy };

    // Continuous application for drawing tools
    if (this.selectedTool === 'wall' || this.selectedTool === 'water') {
      this.applyTool(pos.x, pos.y);
    } else if (this.selectedTool === 'nudge') {
      const dx = pos.x - this.dragStartX;
      const dy = pos.y - this.dragStartY;
      if (Math.hypot(dx, dy) > 2) {
        this.world.nudgeCreatures(pos.x, pos.y, dx * 0.1, dy * 0.1);
        this.dragStartX = pos.x;
        this.dragStartY = pos.y;
      }
    } else if (this.selectedTool === 'food') {
      // Scatter food along drag path
      if (Math.random() < 0.3) {
        this.world.placeFood(pos.x + (Math.random() - 0.5) * 3, pos.y + (Math.random() - 0.5) * 3);
      }
    }
  }

  onPointerUp(sx, sy, e) {
    const pos = this.renderer.screenToWorld(sx, sy);
    const holdTime = Date.now() - this.touchStartTime;
    const dragDist = Math.hypot(pos.x - this.dragStartX, pos.y - this.dragStartY);

    // Tap detection (short hold, minimal drag)
    if (holdTime < 300 && dragDist < 5) {
      this.applyTool(pos.x, pos.y);
    }

    this.isDragging = false;
  }

  applyTool(x, y) {
    switch (this.selectedTool) {
      case 'food':
        for (let i = 0; i < 3; i++) {
          this.world.placeFood(
            x + (Math.random() - 0.5) * 6,
            y + (Math.random() - 0.5) * 6
          );
        }
        break;
      case 'wall':
        this.world.placeObstacle(x, y, 2);
        break;
      case 'water':
        this.world.placeWater(x, y);
        break;
      case 'nudge':
        // Nudge is handled in onPointerMove
        break;
      case 'inspect':
        const creature = this.world.getCreatureAt(x, y);
        if (creature) {
          this.selectedCreature = creature;
          this.showCreatureInfo(creature);
        } else {
          this.selectedCreature = null;
          this.hideCreatureInfo();
        }
        break;
    }
  }

  selectTool(tool) {
    this.selectedTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    this.hideCreatureInfo();
    this.selectedCreature = null;
  }

  setSpeed(speed) {
    this.speed = speed;
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.speed) === speed);
    });
  }

  showCreatureInfo(creature) {
    const panel = document.getElementById('info-panel');
    panel.classList.add('visible');
    this.updateCreatureInfo(creature);
  }

  updateCreatureInfo(creature) {
    if (!creature || !creature.alive) {
      this.hideCreatureInfo();
      return;
    }
    const panel = document.getElementById('info-panel');
    const stateNames = ['探索中', '運搬中', '帰巣中', '休息中', '冒険中'];
    panel.innerHTML = `
      <h3>🔬 生命体 #${creature.id}</h3>
      <div class="stat-row"><span>世代:</span><span>${creature.generation}</span></div>
      <div class="stat-row"><span>サイズ:</span><span>${creature.size}px</span></div>
      <div class="stat-row"><span>エネルギー:</span><span>${Math.round(creature.energy)}/${creature.maxEnergy}</span></div>
      <div class="stat-row"><span>状態:</span><span>${stateNames[creature.state]}</span></div>
      <div class="stat-row"><span>収集量:</span><span>${creature.foodCollected}</span></div>
      <div class="stat-row"><span>年齢:</span><span>${creature.age}</span></div>
      <div class="stat-row"><span>適応度:</span><span>${Math.round(creature.fitness)}</span></div>
    `;
  }

  hideCreatureInfo() {
    document.getElementById('info-panel').classList.remove('visible');
  }

  showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  updateHUD() {
    const stats = this.world.getStats();
    const timeNames = ['🌙', '🌅', '☀️', '☀️', '🌇', '🌙'];
    const timeIdx = Math.floor(stats.timeOfDay * timeNames.length) % timeNames.length;

    document.getElementById('hud-pop').innerHTML = `個体: <span>${stats.population}</span>`;
    document.getElementById('hud-gen').innerHTML = `世代: <span>${stats.generation}</span>`;
    document.getElementById('hud-food').innerHTML = `巣: <span>${stats.nestFood}</span> ${timeNames[timeIdx]}`;
  }

  start() {
    // Hide start screen
    document.getElementById('start-screen').classList.add('hidden');

    // Try to load saved state
    const loaded = this.loadState();
    if (!loaded) {
      this.world.init();
    }

    this.running = true;
    this.selectTool('food');
    this.setSpeed(1);
    this.showToast('タップで餌を配置 🍎');

    this.lastFrameTime = performance.now();
    this.gameLoop(this.lastFrameTime);
  }

  gameLoop(timestamp) {
    if (!this.running) return;

    const delta = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;

    // FPS counter
    this.frameCount++;
    this.fpsTimer += delta;
    if (this.fpsTimer >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTimer = 0;
    }

    // Simulation steps (based on speed)
    const stepsPerFrame = this.speed;
    for (let i = 0; i < stepsPerFrame; i++) {
      this.world.step();
    }

    // Update selected creature info
    if (this.selectedCreature) {
      if (!this.selectedCreature.alive) {
        this.selectedCreature = null;
        this.hideCreatureInfo();
      } else {
        this.updateCreatureInfo(this.selectedCreature);
      }
    }

    // Render
    this.renderer.render(this.world, {
      selectedCreature: this.selectedCreature,
      showPheromones: true
    });

    // Update HUD every few frames
    if (this.world.tick % 10 === 0) {
      this.updateHUD();
    }

    // Auto-save
    if (Date.now() - this.lastSaveTime > this.autoSaveInterval) {
      this.saveState();
      this.lastSaveTime = Date.now();
    }

    requestAnimationFrame((t) => this.gameLoop(t));
  }

  /**
   * Save state to localStorage
   */
  saveState() {
    try {
      const state = {
        tick: this.world.tick,
        nestFood: this.world.nestFood,
        nestX: this.world.nestX,
        nestY: this.world.nestY,
        generation: this.world.generation,
        totalBorn: this.world.totalBorn,
        totalDied: this.world.totalDied,
        creatures: this.world.creatures.map(c => ({
          x: c.x, y: c.y, energy: c.energy, size: c.size,
          age: c.age, foodCollected: c.foodCollected,
          generation: c.generation, carryingFood: c.carryingFood,
          brain: c.brain.serialize()
        })),
        foods: this.world.foods.map(f => ({
          x: f.x, y: f.y, type: f.type, age: f.age
        }))
      };
      localStorage.setItem('pixlife2_save', JSON.stringify(state));
    } catch {
      // Storage full or unavailable
    }
  }

  /**
   * Load state from localStorage
   */
  loadState() {
    try {
      const raw = localStorage.getItem('pixlife2_save');
      if (!raw) return false;
      const state = JSON.parse(raw);

      this.world.tick = state.tick || 0;
      this.world.nestFood = state.nestFood || 0;
      this.world.generation = state.generation || 0;
      this.world.totalBorn = state.totalBorn || 0;
      this.world.totalDied = state.totalDied || 0;

      // Restore creatures
      if (state.creatures && state.creatures.length > 0) {
        this.world.creatures = [];
        for (const cs of state.creatures) {
          const brain = NeuralNet.deserialize(cs.brain);
          const c = new Creature(cs.x, cs.y, brain, cs.generation);
          c.energy = cs.energy;
          c.size = cs.size;
          c.age = cs.age;
          c.foodCollected = cs.foodCollected;
          c.carryingFood = cs.carryingFood;
          c.nestX = this.world.nestX;
          c.nestY = this.world.nestY;
          c.maxEnergy = 100 + (c.size - 1) * 20;
          this.world.creatures.push(c);
        }
      }

      // Restore food
      if (state.foods) {
        this.world.foods = [];
        const FOOD_COLORS = {
          0: [0xe0, 0x5a, 0x5a],
          1: [0xf0, 0xc2, 0x7f],
          2: [0xb0, 0x70, 0xd0],
          3: [0x70, 0xb0, 0x60]
        };
        const FOOD_ENERGY = { 0: 25, 1: 15, 2: 35, 3: 10 };
        for (const fs of state.foods) {
          this.world.foods.push({
            x: fs.x, y: fs.y, type: fs.type,
            energy: FOOD_ENERGY[fs.type] || 15,
            color: FOOD_COLORS[fs.type] || [0xf0, 0xc2, 0x7f],
            age: fs.age || 0
          });
        }
      }

      return this.world.creatures.length > 0;
    } catch {
      return false;
    }
  }
}

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Service worker registration failed
    });
  });
}

// Initialize when DOM is ready
const game = new Game();
