// チップチューンの効果音とBGM（Web Audio API でその場で合成。音声ファイルなし）

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
    this.mood = 'title';
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
        this.bgmGain = this.ctx.createGain(); this.bgmGain.gain.value = this.bgmOn ? 0.26 : 0; this.bgmGain.connect(this.master);
        const len = this.ctx.sampleRate * 0.5;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this._startBgm();
    } catch (e) { /* 音が出せなくても遊べる */ }
  }

  setOn(on) {
    this.on = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.02);
  }
  setBgm(on) {
    this.bgmOn = on;
    if (this.bgmGain) this.bgmGain.gain.setTargetAtTime(on ? 0.26 : 0, this.ctx.currentTime, 0.05);
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

  arp(notes, step, vol = 0.1, type = 'square', when = 0, dur = 0.09) {
    notes.forEach((n, i) => this.tone(NOTE(n), dur, type, vol, when + i * step));
  }

  play(name) {
    if (!this.ctx || !this.on) return;
    const now = performance.now();
    const gap = { tap: 30, place: 25, erase: 30, paint: 25, tick: 40, cross: 60, step: 40 }[name] || 0;
    if (gap && now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    switch (name) {
      case 'tap': this.tone(1046, 0.04, 'square', 0.09); break;
      case 'back': this.tone(660, 0.05, 'square', 0.09); this.tone(494, 0.07, 'square', 0.08, 0.05); break;
      case 'place': this.tone(NOTE(72), 0.04, 'square', 0.1); this.tone(NOTE(79), 0.05, 'square', 0.08, 0.035); break;
      case 'erase': this.noise(0.08, 0.14, 0, 1400); this.tone(NOTE(60), 0.08, 'square', 0.06, 0, 0.5); break;
      case 'paint': this.tone(NOTE(84), 0.05, 'triangle', 0.12); break;
      case 'undo': this.tone(NOTE(76), 0.05, 'square', 0.07); this.tone(NOTE(72), 0.06, 'square', 0.07, 0.05); break;
      case 'toggle': this.tone(NOTE(79), 0.04, 'square', 0.08); break;
      case 'error': this.tone(NOTE(50), 0.12, 'square', 0.1); this.tone(NOTE(47), 0.16, 'square', 0.1, 0.1); break;
      case 'tick': this.tone(NOTE(88), 0.025, 'triangle', 0.06); break;
      case 'step': this.noise(0.03, 0.05, 0, 900); break;
      case 'gen': this.tone(NOTE(76), 0.05, 'triangle', 0.1); this.tone(NOTE(83), 0.06, 'triangle', 0.09, 0.06); break;
      case 'card': this.arp([72, 76, 79], 0.04, 0.07, 'square', 0, 0.06); break;
      case 'newchamp': this.arp([79, 84, 88], 0.06, 0.09, 'square', 0, 0.1); break;
      case 'cross': this.arp([84, 91], 0.05, 0.09, 'square', 0, 0.08); break;
      case 'record':
        this.arp([72, 76, 79, 84], 0.07, 0.1, 'square', 0, 0.12);
        this.tone(NOTE(88), 0.35, 'triangle', 0.14, 0.28);
        break;
      case 'level':
        this.arp([67, 72, 76, 79], 0.09, 0.1, 'square', 0, 0.12);
        this.arp([84, 84, 84], 0.11, 0.1, 'square', 0.4, 0.08);
        this.tone(NOTE(88), 0.6, 'square', 0.1, 0.76);
        this.tone(NOTE(76), 0.6, 'triangle', 0.15, 0.76);
        this.noise(0.4, 0.06, 0.76, 7000, null, 'highpass');
        break;
      case 'move':
        this.arp([72, 79, 76, 84, 79, 88], 0.07, 0.09, 'square', 0, 0.1);
        this.tone(NOTE(91), 0.5, 'triangle', 0.13, 0.45);
        break;
      case 'hatch':
        this.noise(0.08, 0.16, 0, 3000, null, 'highpass');
        this.noise(0.08, 0.14, 0.14, 3000, null, 'highpass');
        this.arp([72, 76, 79, 84], 0.08, 0.1, 'triangle', 0.3, 0.14);
        break;
      case 'start': this.arp([60, 64, 67, 72], 0.05, 0.1, 'square', 0, 0.08); break;
      case 'go': this.tone(NOTE(84), 0.22, 'square', 0.11); break;
      case 'win': this.arp([72, 76, 79, 84, 88], 0.09, 0.11, 'square', 0, 0.14); break;
      case 'save': this.arp([76, 81], 0.06, 0.08, 'triangle', 0, 0.08); break;
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
    const bpm = this.mood === 'fast' ? 132 : this.mood === 'build' ? 112 : 96;
    const spb = 60 / bpm / 4;
    while (this.bgmNext < c.currentTime + 0.25) {
      this._schedule(this.bgmStep, this.bgmNext - c.currentTime);
      this.bgmStep = (this.bgmStep + 1) % 256;
      this.bgmNext += spb;
    }
  }

  _schedule(step, when) {
    if (!this.bgmOn) return;
    const dest = this.bgmGain;
    const bar = Math.floor(step / 16) % 16, s = step % 16;
    const mood = this.mood;
    // コード進行（C - Am - F - G を2周、2周目は少し変化）
    const prog = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50], [48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50],
      [41, 45, 48], [43, 47, 50], [40, 43, 47], [45, 48, 52], [41, 45, 48], [43, 47, 50], [48, 52, 55], [48, 52, 55]];
    const ch = prog[bar];
    // ベース
    if (s === 0 || s === 8 || (mood !== 'lab' && s === 12)) this.tone(NOTE(ch[0] - 12), 0.22, 'triangle', 0.32, when, 0, dest);
    if (mood === 'fast' && (s === 4 || s === 12)) this.noise(0.04, 0.07, when, 4000, dest, 'highpass');
    if (mood !== 'lab' && s === 8) this.noise(0.05, 0.06, when, 1800, dest);
    // 分散和音（ピコピコ）
    if (s % 2 === 0) {
      const pat = [0, 1, 2, 1, 0, 2, 1, 2];
      const n = ch[pat[(s / 2) % 8]] + 12 + (s >= 8 ? 12 : 0);
      this.tone(NOTE(n), 0.07, 'square', mood === 'lab' ? 0.028 : 0.035, when, 0, dest);
    }
    // メロディ（ゆっくり・ときどき）
    const mel = [
      [76, -1, -1, -1, 79, -1, 76, -1, 74, -1, -1, -1, 72, -1, -1, -1],
      [72, -1, 74, -1, 76, -1, -1, -1, 79, -1, 81, -1, 79, -1, -1, -1],
      [77, -1, -1, 76, 74, -1, 72, -1, 74, -1, -1, -1, -1, -1, -1, -1],
      [71, -1, 72, -1, 74, -1, 79, -1, 77, -1, 76, -1, 74, -1, -1, -1],
    ];
    if (mood !== 'title' || bar >= 8) {
      const m = mel[bar % 4][s];
      if (m > 0 && (bar % 8) < 6) this.tone(NOTE(m), 0.32, 'square', 0.035, when, 0, dest, 0.02);
    }
  }
}
