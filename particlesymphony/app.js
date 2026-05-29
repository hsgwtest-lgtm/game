// ========================================================================
//  Particle Symphony — Physics-based Generative Music Instrument
//  A PWA where you draw strings, rain particles, and create music
// ========================================================================

(function () {
  'use strict';

  // ── Canvas Setup ──────────────────────────────────────────────────────
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  let W, H, dpr;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ── Configuration ─────────────────────────────────────────────────────
  const CFG = {
    gravity: 0.6,
    bounce: 0.70,
    particleSize: 3,
    trailAlpha: 0.08,     // lower = longer trails (cleared each frame with this alpha)
    volume: 0.6,
    maxParticles: 800,
    particleLife: 600,     // frames
    scale: 'pentatonic',
    instrument: 'bell',
    background: 'space',
  };

  // ── Musical Scales (semitone offsets from C) ──────────────────────────
  const SCALES = {
    pentatonic: [0, 2, 4, 7, 9],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    blues: [0, 3, 5, 6, 7, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  // Base frequency C3 = 130.81 Hz
  const BASE_FREQ = 130.81;

  function noteFreq(noteIndex) {
    const scale = SCALES[CFG.scale];
    const octave = Math.floor(noteIndex / scale.length);
    const degree = noteIndex % scale.length;
    const semitone = scale[degree] + octave * 12;
    return BASE_FREQ * Math.pow(2, semitone / 12);
  }

  // ── Color Palettes ────────────────────────────────────────────────────
  const STRING_COLORS = [
    '#00ffcc', '#ff66ff', '#66aaff', '#ffaa44', '#44ff88',
    '#ff4488', '#88ddff', '#ffcc44', '#aa66ff', '#66ffaa',
    '#ff6644', '#44ccff', '#ffff66', '#ff88aa', '#88ff66'
  ];

  const BG_THEMES = {
    space: { top: '#0a0a1a', mid: '#0d0820', bot: '#0a0a1a', stars: true },
    ocean: { top: '#001a33', mid: '#002244', bot: '#001122', stars: false },
    forest: { top: '#0a1a0a', mid: '#0d200d', bot: '#081808', stars: false },
    minimal: { top: '#0a0a0a', mid: '#0a0a0a', bot: '#0a0a0a', stars: false },
  };

  // ── State ─────────────────────────────────────────────────────────────
  let strings = [];       // { x1, y1, x2, y2, color, noteIndex, glowPhase }
  let particles = [];     // { x, y, vx, vy, life, maxLife, r, color, trail[] }
  let emitters = [];      // { x, y, rate, timer, angle, spread, speed }
  let starfield = [];     // { x, y, r, twinkle, speed }
  let noteFlashes = [];   // { x, y, note, time, color }
  let mode = 'string';    // 'string' | 'emitter' | 'erase'
  let raining = false;
  let drawStart = null;   // { x, y } for current draw
  let drawCurrent = null;
  let hintVisible = true;
  let frameCount = 0;

  // ── Starfield Init ────────────────────────────────────────────────────
  function initStarfield() {
    starfield = [];
    for (let i = 0; i < 150; i++) {
      starfield.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.5 + 0.3,
        twinkle: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.02 + 0.005
      });
    }
  }
  initStarfield();
  window.addEventListener('resize', initStarfield);

  // ── Audio Engine ──────────────────────────────────────────────────────
  let audioCtx = null;
  let masterGain = null;
  let reverbNode = null;
  let compressor = null;

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Compressor to prevent clipping
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 10;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.1;

    // Master gain
    masterGain = audioCtx.createGain();
    masterGain.gain.value = CFG.volume;
    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);

    // Convolution reverb (generate impulse response)
    reverbNode = audioCtx.createConvolver();
    const irLength = audioCtx.sampleRate * 2;
    const irBuffer = audioCtx.createBuffer(2, irLength, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = irBuffer.getChannelData(ch);
      for (let i = 0; i < irLength; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLength, 2.5);
      }
    }
    reverbNode.buffer = irBuffer;

    // Wet/dry mix for reverb
    const reverbGain = audioCtx.createGain();
    reverbGain.gain.value = 0.25;
    reverbNode.connect(reverbGain);
    reverbGain.connect(masterGain);
  }

  function playNote(freq, velocity, stringColor) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const vel = Math.min(velocity * 0.3, 1.0);

    if (CFG.instrument === 'bell') {
      // Bell: sine + harmonics with exponential decay
      const partials = [1, 2.0, 3.0, 4.2, 5.4];
      const gains = [1.0, 0.5, 0.3, 0.15, 0.08];
      partials.forEach((p, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * p;
        gain.gain.setValueAtTime(vel * gains[i] * 0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5 / (i + 1));
        osc.connect(gain);
        gain.connect(masterGain);
        gain.connect(reverbNode);
        osc.start(t);
        osc.stop(t + 2);
      });
    } else if (CFG.instrument === 'pluck') {
      // Pluck: triangle wave with fast decay
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(freq * 6, t);
      filter.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.3);
      gain.gain.setValueAtTime(vel * 0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      gain.connect(reverbNode);
      osc.start(t);
      osc.stop(t + 0.8);
    } else if (CFG.instrument === 'pad') {
      // Pad: soft sine with slow attack/release
      const osc = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc2.type = 'sine';
      osc2.frequency.value = freq * 1.005; // slight detune for richness
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vel * 0.12, t + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(masterGain);
      gain.connect(reverbNode);
      osc.start(t);
      osc2.start(t);
      osc.stop(t + 3);
      osc2.stop(t + 3);
    } else if (CFG.instrument === 'perc') {
      // Percussion: noise burst + pitched sine
      const bufSize = audioCtx.sampleRate * 0.05;
      const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = audioCtx.createBufferSource();
      noise.buffer = noiseBuf;
      const noiseGain = audioCtx.createGain();
      noiseGain.gain.setValueAtTime(vel * 0.15, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      const noiseFilter = audioCtx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = freq * 2;
      noiseFilter.Q.value = 2;
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(masterGain);

      const osc = audioCtx.createOscillator();
      const oscGain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 1.5, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
      oscGain.gain.setValueAtTime(vel * 0.2, t);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(oscGain);
      oscGain.connect(masterGain);
      oscGain.connect(reverbNode);

      noise.start(t);
      noise.stop(t + 0.1);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  }

  // ── Ambient Drone ─────────────────────────────────────────────────────
  let droneOscs = [];
  let droneGain = null;

  function startDrone() {
    if (!audioCtx || droneGain) return;
    droneGain = audioCtx.createGain();
    droneGain.gain.value = 0;
    droneGain.gain.linearRampToValueAtTime(0.03, audioCtx.currentTime + 3);
    droneGain.connect(masterGain);

    const freqs = [65.41, 98.0, 130.81]; // C2, G2, C3
    freqs.forEach(f => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.connect(droneGain);
      osc.start();
      droneOscs.push(osc);
    });
  }

  // ── Physics ───────────────────────────────────────────────────────────
  function spawnParticle(x, y, vx, vy) {
    if (particles.length >= CFG.maxParticles) return;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const hue = 30 + speed * 15; // warm colors: orange → yellow → white
    particles.push({
      x, y, vx, vy,
      life: CFG.particleLife,
      maxLife: CFG.particleLife,
      r: CFG.particleSize * (0.7 + Math.random() * 0.6),
      hue: Math.min(hue, 60),
      sat: 100,
      lit: 55 + speed * 5,
      trail: [],
      lastHitString: -1,    // avoid re-triggering same string
      hitCooldown: 0,
    });
  }

  function lineCircleCollision(x1, y1, x2, y2, cx, cy, cr) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return null;
    let t = ((cx - x1) * dx + (cy - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx, py = y1 + t * dy;
    const distX = cx - px, distY = cy - py;
    const dist = Math.sqrt(distX * distX + distY * distY);
    if (dist < cr) {
      return { px, py, dist, nx: distX / dist, ny: distY / dist, t };
    }
    return null;
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life--;
      if (p.hitCooldown > 0) p.hitCooldown--;

      if (p.life <= 0 || p.y > H + 100 || p.x < -100 || p.x > W + 100) {
        particles.splice(i, 1);
        continue;
      }

      // Trail
      if (CFG.trailAlpha < 0.15) {
        p.trail.push({ x: p.x, y: p.y });
        const maxTrail = Math.floor((1 - CFG.trailAlpha) * 30);
        if (p.trail.length > maxTrail) p.trail.shift();
      }

      // Gravity
      p.vy += CFG.gravity * 0.16;

      // Move
      p.x += p.vx;
      p.y += p.vy;

      // String collision
      for (let j = 0; j < strings.length; j++) {
        if (p.lastHitString === j && p.hitCooldown > 0) continue;
        const s = strings[j];
        const hit = lineCircleCollision(s.x1, s.y1, s.x2, s.y2, p.x, p.y, p.r);
        if (hit) {
          // Reflect velocity off string normal
          const dot = p.vx * hit.nx + p.vy * hit.ny;
          if (dot < 0) { // only bounce if moving toward string
            p.vx -= 2 * dot * hit.nx * CFG.bounce;
            p.vy -= 2 * dot * hit.ny * CFG.bounce;

            // Push out of string
            p.x = hit.px + hit.nx * (p.r + 0.5);
            p.y = hit.py + hit.ny * (p.r + 0.5);

            p.lastHitString = j;
            p.hitCooldown = 8;

            // Trigger sound
            const velocity = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (velocity > 0.5) {
              const freq = noteFreq(s.noteIndex);
              playNote(freq, velocity, s.color);

              // Visual feedback
              s.glowPhase = 1.0;
              noteFlashes.push({
                x: hit.px, y: hit.py,
                freq,
                time: 30,
                color: s.color,
                noteIndex: s.noteIndex
              });

              // Haptic
              if (navigator.vibrate) navigator.vibrate(8);
            }
          }
        }
      }

      // Floor bounce
      if (p.y > H - 5) {
        p.y = H - 5;
        p.vy = -Math.abs(p.vy) * CFG.bounce * 0.5;
        if (Math.abs(p.vy) < 0.5) p.vy = 0;
      }

      // Wall bounce
      if (p.x < 5) { p.x = 5; p.vx = Math.abs(p.vx) * CFG.bounce; }
      if (p.x > W - 5) { p.x = W - 5; p.vx = -Math.abs(p.vx) * CFG.bounce; }

      // Air resistance
      p.vx *= 0.999;
      p.vy *= 0.999;
    }
  }

  function updateEmitters() {
    emitters.forEach(em => {
      em.timer++;
      if (em.timer >= em.rate) {
        em.timer = 0;
        const angle = em.angle + (Math.random() - 0.5) * em.spread;
        const speed = em.speed * (0.8 + Math.random() * 0.4);
        spawnParticle(
          em.x + (Math.random() - 0.5) * 10,
          em.y + (Math.random() - 0.5) * 10,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed
        );
      }
    });
  }

  function updateRain() {
    if (!raining) return;
    const count = Math.ceil(W / 120);
    for (let i = 0; i < count; i++) {
      if (Math.random() < 0.4) {
        spawnParticle(
          Math.random() * W,
          -10,
          (Math.random() - 0.5) * 1.5,
          Math.random() * 1.5 + 0.5
        );
      }
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────
  function drawBackground() {
    const theme = BG_THEMES[CFG.background];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, theme.top);
    grad.addColorStop(0.5, theme.mid);
    grad.addColorStop(1, theme.bot);

    // Trail fade effect
    ctx.globalAlpha = CFG.trailAlpha < 0.15 ? 0.12 + CFG.trailAlpha : 1.0;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    // Stars
    if (theme.stars) {
      starfield.forEach(s => {
        s.twinkle += s.speed;
        const alpha = 0.3 + Math.sin(s.twinkle) * 0.3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fill();
      });
    }
  }

  function drawStrings() {
    strings.forEach(s => {
      // Glow decay
      if (s.glowPhase > 0) s.glowPhase *= 0.92;

      const glowSize = 4 + s.glowPhase * 20;
      ctx.save();
      ctx.shadowColor = s.color;
      ctx.shadowBlur = glowSize;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2 + s.glowPhase * 3;
      ctx.globalAlpha = 0.6 + s.glowPhase * 0.4;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();

      // Second pass for brighter core
      ctx.shadowBlur = glowSize * 0.5;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.restore();

      // Note label
      if (s.glowPhase > 0.1) {
        const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
        ctx.font = '10px monospace';
        ctx.fillStyle = `rgba(255,255,255,${s.glowPhase * 0.8})`;
        ctx.textAlign = 'center';
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const scale = SCALES[CFG.scale];
        const octave = Math.floor(s.noteIndex / scale.length) + 3;
        const semitone = scale[s.noteIndex % scale.length];
        ctx.fillText(noteNames[semitone % 12] + octave, mx, my - 8);
      }
    });
  }

  function drawParticles() {
    particles.forEach(p => {
      const lifeRatio = p.life / p.maxLife;
      const alpha = Math.min(lifeRatio * 2, 1);

      // Trail
      if (p.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(p.trail[0].x, p.trail[0].y);
        for (let i = 1; i < p.trail.length; i++) {
          ctx.lineTo(p.trail[i].x, p.trail[i].y);
        }
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = `hsla(${p.hue},${p.sat}%,${p.lit}%,${alpha * 0.3})`;
        ctx.lineWidth = p.r * 0.8;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Glow
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      grd.addColorStop(0, `hsla(${p.hue},${p.sat}%,${p.lit}%,${alpha * 0.4})`);
      grd.addColorStop(1, `hsla(${p.hue},${p.sat}%,${p.lit}%,0)`);
      ctx.fillStyle = grd;
      ctx.fillRect(p.x - p.r * 4, p.y - p.r * 4, p.r * 8, p.r * 8);

      // Core
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue},${p.sat}%,${Math.min(p.lit + 20, 95)}%,${alpha})`;
      ctx.fill();
    });
  }

  function drawEmitters() {
    emitters.forEach((em, idx) => {
      const pulse = Math.sin(frameCount * 0.08 + idx) * 0.3 + 0.7;
      ctx.save();
      ctx.shadowColor = '#66aaff';
      ctx.shadowBlur = 10 * pulse;

      // Outer ring
      ctx.beginPath();
      ctx.arc(em.x, em.y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(100,170,255,${0.4 * pulse})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner circle
      ctx.beginPath();
      ctx.arc(em.x, em.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(100,170,255,${0.7 * pulse})`;
      ctx.fill();

      // Direction indicator
      const ax = em.x + Math.cos(em.angle) * 18;
      const ay = em.y + Math.sin(em.angle) * 18;
      ctx.beginPath();
      ctx.moveTo(em.x + Math.cos(em.angle) * 8, em.y + Math.sin(em.angle) * 8);
      ctx.lineTo(ax, ay);
      ctx.strokeStyle = `rgba(100,170,255,${0.5 * pulse})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    });
  }

  function drawNoteFlashes() {
    for (let i = noteFlashes.length - 1; i >= 0; i--) {
      const f = noteFlashes[i];
      f.time--;
      if (f.time <= 0) { noteFlashes.splice(i, 1); continue; }
      const alpha = f.time / 30;
      const size = (1 - alpha) * 30 + 10;

      // Expanding ring
      ctx.beginPath();
      ctx.arc(f.x, f.y, size, 0, Math.PI * 2);
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = alpha * 0.5;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Center flash
      const grd = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 15 * alpha);
      grd.addColorStop(0, `rgba(255,255,255,${alpha * 0.8})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(f.x - 20, f.y - 20, 40, 40);
    }
  }

  function drawPreview() {
    if (!drawStart || !drawCurrent) return;
    ctx.save();
    if (mode === 'string') {
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(0,255,204,0.5)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00ffcc';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(drawStart.x, drawStart.y);
      ctx.lineTo(drawCurrent.x, drawCurrent.y);
      ctx.stroke();
    } else if (mode === 'emitter') {
      ctx.strokeStyle = 'rgba(100,170,255,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(drawStart.x, drawStart.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      // Direction arrow
      ctx.beginPath();
      ctx.moveTo(drawStart.x, drawStart.y);
      ctx.lineTo(drawCurrent.x, drawCurrent.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Main Loop ─────────────────────────────────────────────────────────
  function frame() {
    frameCount++;
    drawBackground();
    updateEmitters();
    updateRain();
    updateParticles();
    drawStrings();
    drawParticles();
    drawEmitters();
    drawNoteFlashes();
    drawPreview();
    requestAnimationFrame(frame);
  }

  // ── Input Handling ────────────────────────────────────────────────────
  function getPos(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function isInUI(pos) {
    // Check if touch is in toolbar or topbar region
    const toolbarH = 72;
    const topbarH = 50;
    if (pos.y > H - toolbarH) return true;
    if (pos.y < topbarH && pos.x > W - 60) return true;
    return false;
  }

  function onStart(e) {
    initAudio();
    startDrone();
    if (hintVisible) {
      hintVisible = false;
      document.getElementById('hint').classList.add('hide');
    }

    const pos = getPos(e);
    if (isInUI(pos)) return;

    if (mode === 'erase') {
      eraseAt(pos.x, pos.y);
      return;
    }

    drawStart = pos;
    drawCurrent = pos;
  }

  function onMove(e) {
    if (!drawStart) return;
    e.preventDefault();
    const pos = getPos(e);
    drawCurrent = pos;

    if (mode === 'erase') {
      eraseAt(pos.x, pos.y);
    }
  }

  function onEnd(e) {
    if (!drawStart) return;
    const endPos = drawCurrent || drawStart;

    const dx = endPos.x - drawStart.x;
    const dy = endPos.y - drawStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (mode === 'string') {
      if (dist > 20) {
        // Assign note based on vertical position (higher on screen = higher pitch)
        const avgY = (drawStart.y + endPos.y) / 2;
        const noteRange = SCALES[CFG.scale].length * 3; // 3 octaves
        const noteIndex = Math.floor((1 - avgY / H) * noteRange);
        const clamped = Math.max(0, Math.min(noteRange - 1, noteIndex));

        strings.push({
          x1: drawStart.x, y1: drawStart.y,
          x2: endPos.x, y2: endPos.y,
          color: STRING_COLORS[strings.length % STRING_COLORS.length],
          noteIndex: clamped,
          glowPhase: 0.5
        });
      }
    } else if (mode === 'emitter') {
      const angle = dist > 10 ? Math.atan2(dy, dx) : Math.PI / 2; // default downward
      const speed = dist > 10 ? Math.min(dist * 0.03, 4) : 2;
      emitters.push({
        x: drawStart.x, y: drawStart.y,
        rate: 6, timer: 0,
        angle, spread: 0.6,
        speed
      });
    }

    drawStart = null;
    drawCurrent = null;
  }

  function eraseAt(x, y) {
    // Erase strings near touch point
    for (let i = strings.length - 1; i >= 0; i--) {
      const s = strings[i];
      const hit = lineCircleCollision(s.x1, s.y1, s.x2, s.y2, x, y, 20);
      if (hit) { strings.splice(i, 1); break; }
    }
    // Erase emitters near touch point
    for (let i = emitters.length - 1; i >= 0; i--) {
      const em = emitters[i];
      const d = Math.sqrt((em.x - x) ** 2 + (em.y - y) ** 2);
      if (d < 25) { emitters.splice(i, 1); break; }
    }
  }

  // Pointer events for both mouse and touch
  canvas.addEventListener('mousedown', onStart);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseup', onEnd);
  canvas.addEventListener('mouseleave', () => { drawStart = null; drawCurrent = null; });
  canvas.addEventListener('touchstart', onStart, { passive: true });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onEnd, { passive: true });
  canvas.addEventListener('touchcancel', () => { drawStart = null; drawCurrent = null; });

  // ── UI Controls ───────────────────────────────────────────────────────
  // Mode buttons
  document.querySelectorAll('.tb-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      initAudio(); startDrone();
      document.querySelectorAll('.tb-btn[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
    });
  });

  // Rain toggle
  const btnRain = document.getElementById('btn-rain');
  btnRain.addEventListener('click', () => {
    initAudio(); startDrone();
    raining = !raining;
    btnRain.classList.toggle('active', raining);
  });

  // Burst
  document.getElementById('btn-burst').addEventListener('click', () => {
    initAudio(); startDrone();
    const cx = W / 2, cy = H / 3;
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 2 + Math.random() * 5;
      spawnParticle(
        cx + (Math.random() - 0.5) * 20,
        cy + (Math.random() - 0.5) * 20,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed
      );
    }
  });

  // Clear
  document.getElementById('btn-clear').addEventListener('click', () => {
    strings = [];
    emitters = [];
    particles = [];
    noteFlashes = [];
    raining = false;
    btnRain.classList.remove('active');
  });

  // Preset cycle
  let presetIdx = 0;
  document.getElementById('btn-preset').addEventListener('click', () => {
    initAudio(); startDrone();
    const presets = ['harp', 'rain', 'chaos', 'zen'];
    applyPreset(presets[presetIdx % presets.length]);
    presetIdx++;
  });

  // Settings panel
  const settingsPanel = document.getElementById('settings');
  const settingsOverlay = document.getElementById('settings-overlay');
  document.getElementById('gear-btn').addEventListener('click', () => {
    settingsPanel.classList.toggle('open');
    settingsOverlay.classList.toggle('open');
  });
  settingsOverlay.addEventListener('click', () => {
    settingsPanel.classList.remove('open');
    settingsOverlay.classList.remove('open');
  });

  // Sliders
  function bindSlider(id, valId, key, transform) {
    const sl = document.getElementById(id);
    const vl = document.getElementById(valId);
    sl.addEventListener('input', () => {
      const raw = parseFloat(sl.value);
      const val = transform ? transform(raw) : raw;
      CFG[key] = val;
      vl.textContent = typeof val === 'number' ? (val < 10 ? val.toFixed(2) : Math.round(val)) : val;
      if (key === 'volume' && masterGain) masterGain.gain.value = val;
    });
  }
  bindSlider('sl-gravity', 'v-gravity', 'gravity', v => v / 100);
  bindSlider('sl-bounce', 'v-bounce', 'bounce', v => v / 100);
  bindSlider('sl-psize', 'v-psize', 'particleSize', v => v);
  bindSlider('sl-trail', 'v-trail', 'trailAlpha', v => 0.04 + (v / 50) * 0.2);
  bindSlider('sl-volume', 'v-volume', 'volume', v => v / 100);

  // Scale buttons
  document.querySelectorAll('#scale-btns .s-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#scale-btns .s-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      CFG.scale = btn.dataset.scale;
      // Re-assign string notes based on new scale
      strings.forEach(s => {
        const avgY = (s.y1 + s.y2) / 2;
        const noteRange = SCALES[CFG.scale].length * 3;
        s.noteIndex = Math.max(0, Math.min(noteRange - 1, Math.floor((1 - avgY / H) * noteRange)));
      });
    });
  });

  // Instrument buttons
  document.querySelectorAll('#inst-btns .s-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#inst-btns .s-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      CFG.instrument = btn.dataset.inst;
    });
  });

  // Background buttons
  document.querySelectorAll('#bg-btns .s-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bg-btns .s-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      CFG.background = btn.dataset.bg;
      initStarfield();
    });
  });

  // ── Presets ───────────────────────────────────────────────────────────
  function applyPreset(name) {
    // Clear existing
    strings = [];
    emitters = [];
    particles = [];
    noteFlashes = [];
    raining = false;
    btnRain.classList.remove('active');

    if (name === 'harp') {
      // Diagonal harp strings across the screen
      const count = 12;
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const x = W * 0.1 + t * W * 0.8;
        strings.push({
          x1: x - 20, y1: H * 0.15,
          x2: x + 20, y2: H * 0.75,
          color: STRING_COLORS[i % STRING_COLORS.length],
          noteIndex: i,
          glowPhase: 0
        });
      }
      // Top emitter for rain
      raining = true;
      btnRain.classList.add('active');
      CFG.instrument = 'bell';
    } else if (name === 'rain') {
      // Cascading diagonal strings
      const rows = 5;
      const cols = 4;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const baseX = W * 0.15 + c * (W * 0.7 / (cols - 1));
          const baseY = H * 0.15 + r * (H * 0.6 / (rows - 1));
          const offset = (r % 2 === 0) ? 30 : -30;
          strings.push({
            x1: baseX - 40, y1: baseY - 5,
            x2: baseX + 40, y2: baseY + 5 + offset * 0.2,
            color: STRING_COLORS[(r * cols + c) % STRING_COLORS.length],
            noteIndex: r * cols + c,
            glowPhase: 0
          });
        }
      }
      raining = true;
      btnRain.classList.add('active');
      CFG.instrument = 'pluck';
      CFG.gravity = 0.4;
      document.getElementById('sl-gravity').value = 40;
      document.getElementById('v-gravity').textContent = '0.40';
    } else if (name === 'chaos') {
      // Random strings everywhere
      for (let i = 0; i < 20; i++) {
        const x1 = Math.random() * W * 0.8 + W * 0.1;
        const y1 = Math.random() * H * 0.6 + H * 0.1;
        const angle = Math.random() * Math.PI;
        const len = 40 + Math.random() * 100;
        strings.push({
          x1, y1,
          x2: x1 + Math.cos(angle) * len,
          y2: y1 + Math.sin(angle) * len,
          color: STRING_COLORS[i % STRING_COLORS.length],
          noteIndex: Math.floor(Math.random() * 15),
          glowPhase: 0
        });
      }
      // Multiple emitters
      for (let i = 0; i < 4; i++) {
        emitters.push({
          x: W * (0.2 + i * 0.2),
          y: H * 0.05,
          rate: 4, timer: Math.floor(Math.random() * 4),
          angle: Math.PI / 2 + (Math.random() - 0.5) * 0.8,
          spread: 1.0, speed: 3
        });
      }
      CFG.instrument = 'perc';
      CFG.scale = 'blues';
      document.querySelectorAll('#scale-btns .s-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.scale === 'blues');
      });
      document.querySelectorAll('#inst-btns .s-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.inst === 'perc');
      });
    } else if (name === 'zen') {
      // Few elegant strings with slow particles
      const zenStrings = [
        { x1: W * 0.2, y1: H * 0.3, x2: W * 0.8, y2: H * 0.35 },
        { x1: W * 0.15, y1: H * 0.5, x2: W * 0.85, y2: H * 0.48 },
        { x1: W * 0.25, y1: H * 0.65, x2: W * 0.75, y2: H * 0.7 },
      ];
      zenStrings.forEach((s, i) => {
        strings.push({
          ...s,
          color: ['#00ffcc', '#66aaff', '#aa66ff'][i],
          noteIndex: [0, 4, 7][i], // C, E, G - major chord
          glowPhase: 0
        });
      });
      CFG.gravity = 0.2;
      CFG.bounce = 0.85;
      CFG.instrument = 'pad';
      CFG.scale = 'pentatonic';
      document.getElementById('sl-gravity').value = 20;
      document.getElementById('v-gravity').textContent = '0.20';
      document.getElementById('sl-bounce').value = 85;
      document.getElementById('v-bounce').textContent = '0.85';

      // Gentle center emitter
      emitters.push({
        x: W / 2, y: H * 0.08,
        rate: 15, timer: 0,
        angle: Math.PI / 2,
        spread: 0.4, speed: 1
      });

      document.querySelectorAll('#scale-btns .s-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.scale === 'pentatonic');
      });
      document.querySelectorAll('#inst-btns .s-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.inst === 'pad');
      });
    }
  }

  // Settings panel preset buttons
  document.getElementById('pre-harp').addEventListener('click', () => { initAudio(); startDrone(); applyPreset('harp'); });
  document.getElementById('pre-rain').addEventListener('click', () => { initAudio(); startDrone(); applyPreset('rain'); });
  document.getElementById('pre-chaos').addEventListener('click', () => { initAudio(); startDrone(); applyPreset('chaos'); });
  document.getElementById('pre-zen').addEventListener('click', () => { initAudio(); startDrone(); applyPreset('zen'); });

  // ── Gyroscope (gravity direction on mobile) ───────────────────────────
  if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', e => {
      if (e.gamma != null && e.beta != null) {
        // Subtle gravity tilt based on device orientation
        const tiltX = (e.gamma / 90) * 0.3; // left/right tilt
        particles.forEach(p => {
          p.vx += tiltX * CFG.gravity * 0.1;
        });
      }
    });
  }

  // ── Service Worker Registration ───────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // ── Start ─────────────────────────────────────────────────────────────
  frame();

})();
