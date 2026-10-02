// チップチューン風の効果音とBGM（Web Audio API で合成。音声ファイルなし）

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);   // MIDIノート番号 → 周波数

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.bgmGain = null;
    this.on = true;
    this.bgmOn = true;
    this.last = {};
    this.bgmTimer = null;
    this.bgmStep = 0;
    this.bgmNext = 0;
    this.noiseBuf = null;
    this.mood = 'calm';
  }

  // iOS では最初のタッチの中で AudioContext を作る必要がある
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.on ? 0.9 : 0;
        this.master.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.55; this.sfxGain.connect(this.master);
        this.bgmGain = this.ctx.createGain(); this.bgmGain.gain.value = this.bgmOn ? 0.32 : 0; this.bgmGain.connect(this.master);
        const len = this.ctx.sampleRate * 0.5;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this._startBgm();
    } catch (e) { /* 音が出せなくてもゲームは続ける */ }
  }

  setOn(on) {
    this.on = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.02);
  }
  setBgm(on) {
    this.bgmOn = on;
    if (this.bgmGain) this.bgmGain.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.05);
  }
  setMood(m) { this.mood = m; }

  tone(freq, dur, type = 'square', vol = 0.18, when = 0, slide = 0, dest = null) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest || this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, vol = 0.2, when = 0, cutoff = 1800, dest = null) {
    const c = this.ctx; if (!c || !this.noiseBuf) return;
    const t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfxGain);
    s.start(t); s.stop(t + dur + 0.02);
  }

  play(name) {
    if (!this.ctx || !this.on) return;
    const now = performance.now();
    const gap = { crash: 70, pass: 60, type: 45, tap: 30 }[name] || 0;
    if (gap && now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    switch (name) {
      case 'tap': this.tone(880, 0.05, 'square', 0.12); break;
      case 'back': this.tone(520, 0.05, 'square', 0.12); this.tone(390, 0.07, 'square', 0.1, 0.05); break;
      case 'crash': this.noise(0.14, 0.22, 0, 1400); this.tone(140, 0.12, 'square', 0.08, 0, 0.5); break;
      case 'pass': this.tone(1318, 0.05, 'triangle', 0.14); break;
      case 'type': this.tone(1760, 0.012, 'square', 0.03); break;
      case 'gen': this.tone(NOTE(76), 0.07, 'square', 0.12); this.tone(NOTE(81), 0.1, 'square', 0.12, 0.08); break;
      case 'record':
        [72, 76, 79, 84].forEach((n, i) => this.tone(NOTE(n), 0.09, 'square', 0.13, i * 0.07));
        break;
      case 'clear':
        [67, 72, 76, 79].forEach((n, i) => this.tone(NOTE(n), 0.1, 'square', 0.14, i * 0.09));
        this.tone(NOTE(84), 0.5, 'square', 0.14, 0.38);
        this.tone(NOTE(72), 0.5, 'triangle', 0.18, 0.38);
        break;
      case 'count': this.tone(880, 0.09, 'square', 0.14); break;
      case 'go': this.tone(1320, 0.28, 'square', 0.15); break;
      case 'win':
        [72, 76, 79, 84, 88].forEach((n, i) => this.tone(NOTE(n), 0.12, 'square', 0.13, i * 0.1));
        break;
      case 'lose':
        [67, 63, 60].forEach((n, i) => this.tone(NOTE(n), 0.18, 'triangle', 0.18, i * 0.16));
        break;
      case 'learn': this.tone(NOTE(84), 0.04, 'triangle', 0.08); break;
      case 'teach': this.tone(NOTE(79), 0.06, 'square', 0.1); this.tone(NOTE(86), 0.08, 'square', 0.1, 0.06); break;
      default: break;
    }
  }

  // ── BGM：先読みスケジューラで16分音符を刻む ──
  _startBgm() {
    if (this.bgmTimer || !this.ctx) return;
    this.bgmNext = this.ctx.currentTime + 0.1;
    this.bgmTimer = setInterval(() => this._tick(), 60);
  }

  _tick() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const spb = 60 / 112 / 4;   // 112BPM の16分
    while (this.bgmNext < c.currentTime + 0.25) {
      this._schedule(this.bgmStep, this.bgmNext - c.currentTime);
      this.bgmStep = (this.bgmStep + 1) % 128;
      this.bgmNext += spb;
    }
  }

  _schedule(step, when) {
    if (!this.bgmOn) return;
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    // Am - F - C - G / Am - F - G - E
    const prog = [[57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62], [57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]];
    const ch = prog[bar];
    const dest = this.bgmGain;
    // ベース
    if (s % 4 === 0 || s === 6 || s === 14) this.tone(NOTE(ch[0] - 12), 0.16, 'triangle', 0.32, when, 0, dest);
    // アルペジオ
    if (s % 2 === 0) {
      const n = ch[(s / 2) % 3] + 12 + ((s / 2) % 4 === 3 ? 12 : 0);
      this.tone(NOTE(n), 0.09, 'square', this.mood === 'calm' ? 0.035 : 0.05, when, 0, dest);
    }
    // メロディ（ときどき）
    const mel = [0, -1, -1, 2, -1, 4, -1, 2, 0, -1, -1, -1, 4, -1, 7, -1];
    if (bar % 2 === 1 && mel[s] >= 0) {
      const scale = [69, 71, 72, 74, 76, 79, 81, 84];
      this.tone(NOTE(scale[mel[s] % scale.length]), 0.18, 'square', 0.045, when, 0, dest);
    }
    // ハイハット
    if (s % 4 === 2) this.noise(0.03, 0.05, when, 6000, dest);
  }
}
