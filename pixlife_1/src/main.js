// ── Main Entry Point ──
(function() {
  'use strict';

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const canvas   = document.getElementById('world');
  const renderer = new Renderer(canvas);
  const world    = new GameWorld(renderer.screenWidth, renderer.screenHeight);
  const input    = new InputHandler(canvas);

  // UI elements
  const splashScreen  = document.getElementById('splash-screen');
  const btnStart      = document.getElementById('btn-start');
  const popCount      = document.getElementById('pop-count');
  const genCount      = document.getElementById('gen-count');
  const nestFoodEl    = document.getElementById('nest-food');
  const timeDisplay   = document.getElementById('time-display');
  const tempSlider    = document.getElementById('temperature');
  const humiditySlider= document.getElementById('humidity');
  const btnDayNight   = document.getElementById('btn-day-night');
  const btnPause      = document.getElementById('btn-pause');
  const btnReset      = document.getElementById('btn-reset');
  const infoPanel     = document.getElementById('info-panel');
  const infoContent   = document.getElementById('info-content');
  const btnCloseInfo  = document.getElementById('btn-close-info');

  const toolButtons = {
    touch: document.getElementById('btn-touch'),
    food:  document.getElementById('btn-food'),
    light: document.getElementById('btn-light'),
    rock:  document.getElementById('btn-rock'),
    spawn: document.getElementById('btn-spawn'),
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

  // ── Single-action tools ──
  canvas.addEventListener('pointerdown', (e) => {
    const tool = input.state.tool;
    if (tool === 'rock') {
      world.spawnRock(e.clientX, e.clientY);
    } else if (tool === 'spawn') {
      world.spawnCreature(e.clientX, e.clientY);
    } else if (tool === 'touch') {
      const creature = world.getCreatureAt(e.clientX, e.clientY);
      if (creature) showCreatureInfo(creature);
    }
  });

  // ── Sliders ──
  tempSlider.addEventListener('input', () => {
    world.temperature = parseInt(tempSlider.value);
  });
  humiditySlider.addEventListener('input', () => {
    world.humidity = parseInt(humiditySlider.value);
  });

  // ── Day / Night toggle ──
  let nightMode = false;
  btnDayNight.addEventListener('click', () => {
    nightMode = !nightMode;
    world.manualNight = nightMode;
    btnDayNight.textContent = nightMode ? '☀️' : '🌙';
  });

  // ── Pause ──
  btnPause.addEventListener('click', () => {
    world.paused = !world.paused;
    btnPause.textContent = world.paused ? '▶️' : '⏸️';
  });

  // ── Reset ──
  btnReset.addEventListener('click', () => {
    world.reset();
    infoPanel.classList.add('hidden');
  });

  // ── Creature info panel ──
  let trackedCreature = null;

  function showCreatureInfo(creature) {
    trackedCreature = creature;
    infoPanel.classList.remove('hidden');
  }

  function updateInfoPanel() {
    if (!trackedCreature || !trackedCreature.alive) {
      trackedCreature = null;
      infoPanel.classList.add('hidden');
      return;
    }
    const c = trackedCreature;
    const ep = Math.floor(c.energy / c.maxEnergy * 100);
    const ec = ep > 30 ? '#70c040' : '#c04020';
    infoContent.innerHTML = `
      <div class="label">生命体 #${c.id}</div>
      <div>世代: ${c.generation} | 年齢: ${Math.floor(c.age)}s</div>
      <div>状態: ${getStateLabel(c.state)}</div>
      <div class="label">エネルギー ${ep}%</div>
      <div class="bar"><div class="bar-fill" style="width:${ep}%;background:${ec}"></div></div>
      <div class="label">感情: ${getEmotionLabel(c.emotion)}</div>
      <div>速度: ${c.speed.toFixed(1)} | サイズ: ${c.dna.size}px</div>
      <div>代謝: ${c.dna.metabolism.toFixed(2)} | 感覚: ${c.dna.senseRange.toFixed(0)}</div>
      <div style="margin-top:4px;color:rgba(240,200,140,.5);font-size:9px">
        脳: ${c.brain.weights.length}シナプス
      </div>
    `;
  }

  function getStateLabel(state) {
    return state === 'carrying' ? '🌿 運搬中' : '🔍 探索中';
  }

  function getEmotionLabel(emotion) {
    switch(emotion) {
      case 'happy':   return '😊 嬉しい';
      case 'hungry':  return '😟 お腹すいた';
      case 'focused': return '🎯 集中';
      case 'sleepy':  return '😴 眠い';
      default:        return '😐 平常';
    }
  }

  btnCloseInfo.addEventListener('click', () => {
    trackedCreature = null;
    infoPanel.classList.add('hidden');
  });

  // ── Resize ──
  window.addEventListener('resize', () => {
    renderer.resize();
    world.resize(renderer.screenWidth, renderer.screenHeight);
  });

  // ── Format time ──
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ── Game loop ──
  let lastTime = 0;
  let started  = false;

  function gameLoop(timestamp) {
    requestAnimationFrame(gameLoop);
    if (!started) return;

    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    input.processFrame(world, dt);
    world.update(dt);

    // Update stats
    popCount.textContent   = world.creatures.length;
    genCount.textContent   = `世代 ${world.maxGeneration}`;
    nestFoodEl.textContent = `🪺 ${world.nestFood}`;
    timeDisplay.textContent = formatTime(world.time);

    if (trackedCreature) updateInfoPanel();

    renderer.render(world, input.state);
  }

  // ── Start ──
  btnStart.addEventListener('click', () => {
    splashScreen.classList.add('hidden');
    started  = true;
    lastTime = performance.now();
    world.reset();
  });

  requestAnimationFrame(gameLoop);
})();
