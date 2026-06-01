// Web Audio API sound effects — no external files needed
let ctx = null;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return ctx;
}

export function resumeAudio() {
  const c = getCtx();
  if (c.state === 'suspended') c.resume();
}

function playTone(freq, duration, type = 'sine', gain = 0.15) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(g).connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration);
}

function playNoise(duration, gain = 0.08) {
  const c = getCtx();
  const bufferSize = c.sampleRate * duration;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  src.connect(g).connect(c.destination);
  src.start();
}

export function chipBet() {
  playTone(2000, 0.06, 'square', 0.08);
  setTimeout(() => playTone(2500, 0.04, 'square', 0.06), 30);
}

export function cardFlip() {
  playNoise(0.08, 0.06);
}

export function win() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => {
    setTimeout(() => playTone(f, 0.2, 'sine', 0.12), i * 100);
  });
}

export function lose() {
  playTone(400, 0.3, 'sawtooth', 0.08);
  setTimeout(() => playTone(300, 0.4, 'sawtooth', 0.06), 150);
}

export function rouletteRoll() {
  for (let i = 0; i < 8; i++) {
    setTimeout(() => playTone(800 + Math.random() * 400, 0.03, 'square', 0.04), i * 50);
  }
}

export function jackpot() {
  const notes = [523, 659, 784, 880, 1047, 1319, 1568];
  notes.forEach((f, i) => {
    setTimeout(() => playTone(f, 0.25, 'sine', 0.15), i * 120);
  });
}
