// ── Main Entry Point ──
(function() {
  'use strict';

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const canvas = document.getElementById('world');
  const renderer = new Renderer(canvas);
  const world = new GameWorld(renderer.width, renderer.height);
  const input = new InputHandler(canvas);

  // UI Elements
  const splashScreen = document.getElementById('splash-screen');
  const btnStart = document.getElementById('btn-start');
  const popCount = document.getElementById('pop-count');
  const genCount = document.getElementById('gen-count');
  const viscositySlider = document.getElementById('viscosity');
  const gravitySlider = document.getElementById('gravity-str');
  const btnReset = document.getElementById('btn-reset');
  const btnPause = document.getElementById('btn-pause');
  const toolButtons = {
    gravity: document.getElementById('btn-gravity'),
    wall:    document.getElementById('btn-wall'),
    feed:    document.getElementById('btn-feed'),
    spawn:   document.getElementById('btn-spawn'),
  };

  // ── Tool selection ──
  function selectTool(toolName) {
    input.setTool(toolName);
    Object.entries(toolButtons).forEach(([name, btn]) => {
      btn.classList.toggle('active', name === toolName);
    });
  }

  Object.entries(toolButtons).forEach(([name, btn]) => {
    btn.addEventListener('click', () => selectTool(name));
  });

  // ── Wall creation callback ──
  input.onWallCreated((x1, y1, x2, y2) => {
    world.addWall(x1, y1, x2, y2);
  });

  // ── Spawn on tap ──
  canvas.addEventListener('pointerdown', (e) => {
    if (input.state.tool === 'spawn') {
      world.spawnEntity(e.clientX, e.clientY);
    }
  });

  // ── Sliders ──
  viscositySlider.addEventListener('input', () => {
    world.viscosity = parseInt(viscositySlider.value);
  });
  gravitySlider.addEventListener('input', () => {
    world.gravityStrength = parseInt(gravitySlider.value);
  });

  // ── Reset ──
  btnReset.addEventListener('click', () => {
    world.reset();
  });

  // ── Pause ──
  btnPause.addEventListener('click', () => {
    world.paused = !world.paused;
    btnPause.textContent = world.paused ? '▶️' : '⏸️';
  });

  // ── Resize ──
  window.addEventListener('resize', () => {
    renderer.resize();
    world.resize(renderer.width, renderer.height);
  });

  // ── Game loop ──
  let lastTime = 0;
  let started = false;

  function gameLoop(timestamp) {
    requestAnimationFrame(gameLoop);
    if (!started) return;

    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    // Process input
    input.processFrame(world, dt);

    // Update world
    world.update(dt);

    // Update UI
    const aliveCount = world.entities.filter(e => e.alive).length;
    popCount.textContent = aliveCount;
    genCount.textContent = `Gen ${world.maxGeneration}`;

    // Render
    renderer.render(world, input.state);
  }

  // ── Start ──
  btnStart.addEventListener('click', () => {
    splashScreen.classList.add('hidden');
    started = true;
    lastTime = performance.now();
    world.reset();
  });

  requestAnimationFrame(gameLoop);
})();
