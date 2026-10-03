// 和風チップチューンの効果音とBGM（Web Audio API でその場で合成。音声ファイルなし）

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
        this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.5; this.sfxGain.connect(this.master);
        this.bgmGain = this.ctx.createGain(); this.bgmGain.gain.value = this.bgmOn ? 0.3 : 0; this.bgmGain.connect(this.master);
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
    if (this.bgmGain) this.bgmGain.gain.setTargetAtTime(on ? 0.3 : 0, this.ctx.currentTime, 0.05);
  }
  setMood(m) { this.mood = m; }

  tone(freq, dur, type = 'square', vol = 0.16, when = 0, slide = 0, dest = null, attack = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + Math.max(0, when);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    if (attack > 0) {
      g.gain.setValueAtTime(0.0008, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
    } else g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest || this.sfxGain);
    o.start(t); o.stop(t + dur + 0.03);
  }

  noise(dur, vol = 0.2, when = 0, cutoff = 1800, dest = null, type = 'lowpass') {
    const c = this.ctx; if (!c || !this.noiseBuf) return;
    const t = c.currentTime + Math.max(0, when);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfxGain);
    s.start(t); s.stop(t + dur + 0.03);
  }

  // 琴のようなはじく音
  koto(n, when, vol, dest) {
    this.tone(NOTE(n), 0.32, 'triangle', vol, when, 0, dest);
    this.tone(NOTE(n + 12), 0.08, 'square', vol * 0.25, when, 0, dest);
  }

  play(name) {
    if (!this.ctx || !this.on) return;
    const now = performance.now();
    const gap = { hop: 40, fall: 60, hit: 70, coin: 50, tap: 30, type: 45, tick: 40 }[name] || 0;
    if (gap && now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    switch (name) {
      case 'tap': this.tone(1046, 0.05, 'square', 0.1); break;
      case 'back': this.tone(660, 0.05, 'square', 0.1); this.tone(494, 0.07, 'square', 0.09, 0.05); break;
      case 'hop': this.tone(520, 0.05, 'triangle', 0.07, 0, 1.6); break;
      case 'bump': this.noise(0.05, 0.12, 0, 600); break;
      case 'fall': this.tone(700, 0.35, 'triangle', 0.12, 0, 0.25); break;
      case 'hit': this.noise(0.14, 0.2, 0, 1200); this.tone(160, 0.12, 'square', 0.08, 0, 0.5); break;
      case 'coin': this.tone(NOTE(88), 0.05, 'square', 0.09); this.tone(NOTE(93), 0.12, 'square', 0.09, 0.05); break;
      case 'key': [76, 81, 86].forEach((n, i) => this.tone(NOTE(n), 0.08, 'triangle', 0.13, i * 0.06)); break;
      case 'door': this.noise(0.25, 0.12, 0, 500); this.tone(110, 0.2, 'triangle', 0.12); break;
      case 'goal': [74, 79, 83, 86].forEach((n, i) => this.koto(n, i * 0.07, 0.12)); break;
      case 'type': this.tone(1568, 0.012, 'square', 0.025); break;
      case 'tick': this.tone(NOTE(84), 0.03, 'triangle', 0.06); break;
      case 'gen': this.koto(79, 0, 0.1); this.koto(86, 0.08, 0.1); break;
      case 'learn': this.tone(NOTE(86), 0.04, 'triangle', 0.07); this.tone(NOTE(91), 0.05, 'triangle', 0.06, 0.04); break;
      case 'record': [74, 79, 83, 88].forEach((n, i) => this.koto(n, i * 0.07, 0.12)); break;
      case 'medal':
        [67, 71, 74, 79].forEach((n, i) => this.koto(n, i * 0.1, 0.13));
        this.tone(NOTE(86), 0.7, 'square', 0.1, 0.42);
        this.tone(NOTE(79), 0.7, 'triangle', 0.16, 0.42);
        this.noise(0.5, 0.08, 0.42, 7000, null, 'highpass');
        break;
      case 'count': this.tone(880, 0.08, 'square', 0.12); break;
      case 'go': this.tone(1320, 0.25, 'square', 0.13); break;
      case 'win': [72, 76, 79, 84, 88].forEach((n, i) => this.koto(n, i * 0.09, 0.13)); break;
      case 'lose': [67, 64, 60].forEach((n, i) => this.tone(NOTE(n), 0.2, 'triangle', 0.16, i * 0.15)); break;
      case 'teach': this.tone(NOTE(81), 0.05, 'square', 0.08); this.tone(NOTE(88), 0.07, 'square', 0.08, 0.05); break;
      case 'fix': this.tone(NOTE(76), 0.06, 'square', 0.09); this.tone(NOTE(72), 0.08, 'square', 0.08, 0.06); break;
      case 'drum': this.tone(90, 0.2, 'sine', 0.3, 0, 0.5); this.noise(0.06, 0.1, 0, 300); break;
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
    const bpm = this.mood === 'train' ? 104 : 92;
    const spb = 60 / bpm / 4;
    while (this.bgmNext < c.currentTime + 0.25) {
      this._schedule(this.bgmStep, this.bgmNext - c.currentTime);
      this.bgmStep = (this.bgmStep + 1) % 128;
      this.bgmNext += spb;
    }
  }

  _schedule(step, when) {
    if (!this.bgmOn) return;
    const dest = this.bgmGain;
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    // 陽音階（D E G A B）で、なつかしい和の雰囲気
    const roots = [50, 50, 55, 52, 50, 57, 55, 50];
    const r = roots[bar];
    // 太鼓
    if (s === 0 || s === 10) this.tone(NOTE(r - 12), 0.22, 'sine', 0.36, when, 0.6, dest);
    if (s === 8 && bar % 2 === 1) this.noise(0.05, 0.08, when, 2500, dest);
    // 琴の分散和音
    const yo = [62, 64, 67, 69, 71, 74, 76, 79];
    if (s % 2 === 0) {
      const pat = [0, 2, 4, 2, 5, 4, 2, 1];
      const n = yo[(pat[(s / 2) % 8] + (bar % 4)) % yo.length];
      this.koto(n, when, this.mood === 'train' ? 0.05 : 0.04, dest);
    }
    // 笛のメロディ（ときどき）
    const mel = [
      [74, -1, -1, 76, 79, -1, 76, -1, 74, -1, 71, -1, 69, -1, -1, -1],
      [71, -1, 74, -1, 76, -1, -1, 79, 81, -1, 79, -1, 76, -1, -1, -1],
    ];
    if (bar % 2 === 1) {
      const m = mel[(bar >> 1) % 2][s];
      if (m > 0) this.tone(NOTE(m), 0.42, 'triangle', 0.06, when, 0, dest, 0.04);
    }
    // 鈴
    if (s === 4 && bar % 4 === 0) this.tone(NOTE(98), 0.25, 'sine', 0.04, when, 0, dest);
  }
}
