// 効果音とBGMを Web Audio でその場で合成する（音声ファイルなし）。

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.musicGain = null;
    this.song = null;
    this.songT = 0;
    this.nextBeat = 0;
    this.beat = 0;
    this.lastPlay = {};
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicOn ? 0.22 : 0;
      this.musicGain.connect(this.master);
      // 無音を一度鳴らして iOS のロックを外す
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.master); s.start(0);
    } catch (e) { this.ctx = null; }
  }

  setSfx(on) { this.sfxOn = on; }
  setMusic(on) {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.1);
  }

  _tone(freq, dur, type = 'square', vol = 0.2, slide = 0, delay = 0, dest = null) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, vol = 0.2, delay = 0, hp = 800) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = hp;
    const g = c.createGain();
    g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t);
  }

  play(name) {
    if (!this.ctx || !this.sfxOn) return;
    const now = this.ctx.currentTime;
    // 同じ音の連打をまびく
    if (this.lastPlay[name] && now - this.lastPlay[name] < 0.04) return;
    this.lastPlay[name] = now;
    switch (name) {
      case 'click': this._tone(880, 0.05, 'square', 0.12, 1.5); break;
      case 'tick': this._tone(1320, 0.03, 'square', 0.08); break;
      case 'deny': this._tone(180, 0.12, 'square', 0.12, 0.7); break;
      case 'back': this._tone(660, 0.06, 'square', 0.1, 0.6); break;
      case 'paint': this._tone(520 + Math.random() * 300, 0.04, 'triangle', 0.06, 1.6); break;
      case 'shoot': this._tone(900, 0.09, 'square', 0.1, 0.4); this._noise(0.06, 0.05, 0, 2000); break;
      case 'hit': this._tone(300, 0.2, 'sawtooth', 0.14, 0.3); this._noise(0.12, 0.12, 0, 1200); break;
      case 'bomb': this._noise(0.35, 0.25, 0, 200); this._tone(120, 0.3, 'triangle', 0.2, 0.5); break;
      case 'item': this._tone(988, 0.06, 'square', 0.1); this._tone(1319, 0.08, 'square', 0.1, 1, 0.06); break;
      case 'count': this._tone(660, 0.12, 'square', 0.14); break;
      case 'go': this._tone(990, 0.3, 'square', 0.16); this._tone(1320, 0.3, 'square', 0.1, 1, 0.05); break;
      case 'whistle': this._tone(1560, 0.35, 'square', 0.12, 0.98); break;
      case 'win': [0, 4, 7, 12, 16].forEach((n, i) => this._tone(NOTE(72 + n), 0.16, 'square', 0.13, 1, i * 0.1)); break;
      case 'lose': [7, 3, 0, -5].forEach((n, i) => this._tone(NOTE(67 + n), 0.22, 'triangle', 0.15, 1, i * 0.16)); break;
      case 'unlock': [0, 7, 12, 19, 24].forEach((n, i) => this._tone(NOTE(76 + n), 0.12, 'square', 0.1, 1, i * 0.07)); break;
      case 'levelup': [0, 4, 7, 12].forEach((n, i) => this._tone(NOTE(79 + n), 0.09, 'square', 0.1, 1, i * 0.06)); break;
      case 'card': this._tone(660, 0.05, 'triangle', 0.12, 2); break;
      case 'emote': this._tone(1175, 0.06, 'square', 0.08); this._tone(1568, 0.08, 'square', 0.08, 1, 0.05); break;
      case 'join': [0, 5, 9].forEach((n, i) => this._tone(NOTE(74 + n), 0.1, 'square', 0.1, 1, i * 0.08)); break;
      case 'learn': this._tone(NOTE(84 + Math.floor(Math.random() * 5) * 2), 0.04, 'triangle', 0.05); break;
      default: break;
    }
  }

  // ── BGM（とても小さなシーケンサー）──
  playSong(key) {
    if (this.song === key) return;
    this.song = key;
    this.beat = 0;
    if (this.ctx) this.nextBeat = this.ctx.currentTime + 0.1;
  }

  update() {
    if (!this.ctx || !this.song || !this.musicOn) return;
    const song = SONGS[this.song];
    if (!song) return;
    const spb = 60 / song.bpm / 2;   // 8分音符
    while (this.nextBeat < this.ctx.currentTime + 0.15) {
      const b = this.beat % song.len;
      const t = this.nextBeat - this.ctx.currentTime;
      for (const tr of song.tracks) {
        const n = tr.notes[b % tr.notes.length];
        if (n === null || n === undefined) continue;
        if (tr.type === 'noise') this._noiseAt(t, tr.vol, n);
        else this._tone(NOTE(n), spb * (tr.dur || 0.9), tr.type, tr.vol, 1, Math.max(0, t), this.musicGain);
      }
      this.beat++;
      this.nextBeat += spb;
    }
  }

  _noiseAt(delay, vol, hp) {
    const c = this.ctx;
    const t = c.currentTime + Math.max(0, delay);
    const n = Math.floor(c.sampleRate * 0.05);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = hp;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(this.musicGain);
    s.start(t);
  }
}

// 曲（数字は MIDI ノート、null は休み）
const _ = null;
const SONGS = {
  home: {
    bpm: 112, len: 32,
    tracks: [
      { type: 'square', vol: 0.06, dur: 0.7, notes: [72, _, 76, _, 79, _, 76, _, 74, _, 77, _, 81, _, 77, _, 72, _, 76, _, 79, _, 84, _, 83, _, 79, _, 74, _, 71, _] },
      { type: 'triangle', vol: 0.12, dur: 0.9, notes: [48, _, 48, _, 55, _, 55, _, 50, _, 50, _, 57, _, 57, _, 48, _, 48, _, 55, _, 55, _, 43, _, 43, _, 50, _, 47, _] },
      { type: 'noise', vol: 0.05, notes: [_, _, 6000, _, _, _, 6000, _] },
    ],
  },
  train: {
    bpm: 128, len: 16,
    tracks: [
      { type: 'square', vol: 0.045, dur: 0.5, notes: [67, 70, 74, 70, 67, 70, 74, 77, 65, 69, 72, 69, 65, 69, 72, 76] },
      { type: 'triangle', vol: 0.12, dur: 0.9, notes: [43, _, 43, _, 43, _, 46, _, 41, _, 41, _, 41, _, 45, _] },
      { type: 'noise', vol: 0.04, notes: [9000, _, 4000, _, 9000, _, 4000, 9000] },
    ],
  },
  battle: {
    bpm: 150, len: 32,
    tracks: [
      { type: 'square', vol: 0.05, dur: 0.6, notes: [76, _, 76, 79, _, 76, 74, _, 72, _, 72, 74, _, 76, 79, _, 81, _, 81, 79, _, 77, 76, _, 74, _, 76, 72, _, 71, 69, _] },
      { type: 'triangle', vol: 0.13, dur: 0.8, notes: [45, 45, 57, 45, 45, 57, 45, 57, 41, 41, 53, 41, 41, 53, 41, 53, 43, 43, 55, 43, 43, 55, 43, 55, 40, 40, 52, 40, 44, 44, 56, 44] },
      { type: 'noise', vol: 0.06, notes: [3000, _, 9000, _, 3000, 3000, 9000, _] },
    ],
  },
};
