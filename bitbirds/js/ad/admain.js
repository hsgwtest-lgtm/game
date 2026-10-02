// 15秒広告（縦 1080×1920）。本物のゲームエンジン・学習データで各シーンを再生する。
// 「● 録画して保存」で canvas と音をそのまま動画ファイルに書き出せる。

import { PixelRenderer } from '../gfx/pixel.js';
import { World3D } from '../world/world3d.js';
import { Sound } from '../core/audio.js';
import { C, text, mini, panel, dim } from '../ui/widgets.js';
import { drawLogo } from '../screens/title.js';
import { BIG_CHICK, CHICK, PROF, ICON, colors } from '../gfx/sprites.js';
import { rgb } from '../gfx/fb.js';
import { STAGES, FAMILIES, WORLD, PAL, PLAYER_LOOK, NET } from '../core/config.js';
import { Session, Bird, N_IN } from '../sim/flight.js';
import { MLP, b64ToF32 } from '../ml/nn.js';
import { Flock } from '../ml/ga.js';
import { RNG } from '../core/rng.js';
import { DEMO_GENOME } from '../game/demo.js';
import { drawBrain, drawStick, drawChart } from '../ui/viz.js';
import { AD_HISTORY, AD_LOSS } from './addata.js';

const W = 1080, H = 1920, K = 6;          // 仮想 180×320 ピクセル
const DUR = 15;
const BASE = b64ToF32(DEMO_GENOME);

function variants(n, seed, pm, sg) {
  const r = new RNG(seed), out = [];
  for (let i = 0; i < n; i++) {
    const g = new Float32Array(BASE);
    if (i) for (let p = 0; p < g.length; p++) if (r.float() < pm) g[p] += r.gauss() * sg;
    out.push(g);
  }
  return out;
}

// 1つのコースを何羽かで飛ばす（ゲーム本編と同じシミュレーション）
class Flight {
  constructor(app, stIdx, seed, genomes, o = {}) {
    this.app = app;
    this.st = STAGES[stIdx];
    this.s = new Session(this.st, seed, { maxDist: 1e9 });
    const r = new RNG(seed ^ 77);
    this.nets = [];
    genomes.forEach((g, i) => {
      const net = new MLP(N_IN, NET.hid, NET.out, g);
      const b = new Bird({ x: r.range(-(o.spread ?? 2), o.spread ?? 2), y: WORLD.START_Y + r.range(-1.2, 1.2) });
      if (o.z0) { b.z = b.pz = o.z0; }
      b.ctrl = (bb) => net.forward(bb.inp, bb.out);
      b.net = net;
      const fam = o.look || FAMILIES[(o.famOf ? o.famOf(i) : i) % 10];
      b.look = { color: fam.color, dark: fam.dark, scale: o.scale ?? 0.75 };
      this.s.add(b);
      this.nets.push(net);
    });
    this.acc = 0;
    this.goalShown = false;
    app.world.setTheme(o.theme ?? this.st.theme);
    app.world.setGoal(o.goal ? -this.st.goal : null);
    app.world.setCamMode(o.cam ?? 0);
    app.world.clearParticles();
    app.world.snapCamera(this.s.birds[0]);
  }
  update(dt) {
    const app = this.app, w = app.world;
    this.acc += dt;
    while (this.acc >= WORLD.DT) {
      this.acc -= WORLD.DT;
      if (!this.s.done) this.s.step();
      for (const e of this.s.drain()) {
        const b = e.bird;
        if (e.type === 'crash') { w.burst(b.x, b.y, b.z, b.look.color, 12); app.sound.play('crash'); }
        else if (e.type === 'pass' && b === this.s.leader) { app.sound.play('pass'); w.sparkle(b.x, b.y, b.z, w.theme.frame, 6); }
      }
    }
    const s = this.s, lead = s.leader;
    if (!this.goalShown && lead && lead.dist >= this.st.goal) {
      this.goalShown = true; this.goalT = 0;
      w.sparkle(lead.x, lead.y, lead.z, 0xfee761, 18);
      app.sound.play('clear');
    }
    if (this.goalShown) this.goalT += dt;
    w.update(dt, { birds: s.birds, course: s.course, alpha: Math.min(1, this.acc / WORLD.DT), focus: lead || s.birds[0], T: s.T, aspect: app.px.aspect });
  }
}

// ── テロップ ──
function band(fb, y, h) {
  fb.rect(0, y, 180, h, C.ink);
  fb.rect(0, y + h, 180, 1, C.cyan);
}
function big(fb, str, y, color, scale = 2) {
  text(fb, str, 90, y, color, { align: 'center', outline: C.ink, scale });
}
function pop(t, t0) { return t >= t0; }

const SCENES = [
  { // 1. つかみ：第1世代はほぼ全滅
    t0: 0, t1: 2.6,
    enter(app) {
      const f = new Flock({ size: 40, seed: 4 }).initRandom();
      this.f = new Flight(app, 0, 1004, f.members.map(m => m.genome), { z0: -12, scale: 0.7 });
      app.sound.setMood('race');
    },
    update(app, dt) { this.f.update(dt); },
    draw(app, fb, t) {
      band(fb, 10, 50);
      big(fb, 'AIは どうやって', 14, C.white);
      if (pop(t, 0.35)) big(fb, '学ぶの？', 36, C.yellow);
      const alive = this.f.s.aliveCount;
      fb.rect(0, 262, 180, 34, C.ink);
      text(fb, '第1世代', 8, 266, C.cyan, { scale: 1, bold: true });
      text(fb, `のこり ${alive}/40羽`, 172, 266, alive < 15 ? C.red : C.white, { align: 'right' });
      text(fb, 'でたらめな脳では ぶつかるだけ', 90, 280, C.silver, { align: 'center' });
    },
  },
  { // 2. 進化：世代を重ねて上達（実際の学習記録）
    t0: 2.6, t1: 5.8,
    enter(app) { this.f = new Flight(app, 0, 5001, variants(10, 1, 0.06, 0.2), { spread: 3, cam: 2 }); },
    update(app, dt) { this.f.update(dt); },
    draw(app, fb, t) {
      const k = Math.min(1, t / 2.6);
      const n = Math.max(2, Math.round(AD_HISTORY.length * k));
      let mx = 0;
      const best = [], avg = [];
      for (let i = 0; i < n; i++) { mx = Math.max(mx, AD_HISTORY[i][0]); best.push(mx); avg.push(AD_HISTORY[i][1]); }
      band(fb, 10, 50);
      big(fb, '飛べた子が', 14, C.white);
      big(fb, '親になる', 36, C.yellow);
      panel(fb, 10, 168, 160, 100, { fill: C.ink, border: C.cyan });
      text(fb, `第${n}世代`, 18, 172, C.yellow, { scale: 2, outline: C.ink });
      text(fb, `最高 ${best[n - 1]}m`, 162, 178, C.white, { align: 'right' });
      drawChart(fb, 18, 198, 144, 48, [{ data: avg, color: C.cyan }, { data: best, color: C.yellow, dot: true }], { ymax: 480, goal: 400 });
      text(fb, '遺伝的アルゴリズムで 進化', 90, 252, C.silver, { align: 'center' });
      fb.rect(0, 282, 180, 18, C.ink);
      text(fb, '交叉 ＋ 突然変異 × 50羽', 90, 285, C.lime, { align: 'center' });
    },
  },
  { // 3. 見える化：AIの目と脳
    t0: 5.8, t1: 8.6,
    enter(app) { this.f = new Flight(app, 1, 2001, variants(6, 1, 0.05, 0.15), { z0: -2 }); },
    update(app, dt) { this.f.update(dt); },
    draw(app, fb, t) {
      band(fb, 10, 50);
      big(fb, 'AIの目と脳が', 14, C.white);
      big(fb, '見える', 36, C.cyan);
      const b = this.f.s.leader || this.f.s.birds[0];
      fb.rect(0, 196, 180, 104, C.navy);
      fb.rect(0, 196, 180, 1, C.cyan);
      text(fb, 'AIの目（7×5ピクセル）', 6, 199, C.silver);
      drawBrain(fb, b.net, b.inp, 8, 214, 132, 62, { cell: 7, labels: true });
      drawStick(fb, 160, 240, 14, b.out[0], b.out[1], C.yellow);
      text(fb, '明るい＝近いかべ → よける', 90, 284, C.white, { align: 'center' });
    },
  },
  { // 4. 達成：ステージクリア
    t0: 8.6, t1: 11.2,
    enter(app) { this.f = new Flight(app, 1, 3003, variants(12, 3, 0.05, 0.15), { z0: -380, goal: true }); },
    update(app, dt) { this.f.update(dt); },
    draw(app, fb, t) {
      band(fb, 10, 50);
      big(fb, '第40世代', 14, C.white);
      big(fb, '群れで突破！', 36, C.lime);
      if (this.f.goalShown && (this.f.goalT < 0.6 || Math.floor(this.f.goalT * 6) % 2 === 0)) {
        fb.rect(0, 124, 180, 38, C.ink); fb.rect(0, 124, 180, 1, C.yellow); fb.rect(0, 161, 180, 1, C.yellow);
        mini(fb, 'GOAL!', 91, 131, C.plum, 'center', 5);
        mini(fb, 'GOAL!', 90, 130, C.yellow, 'center', 5);
      }
      fb.rect(0, 282, 180, 18, C.ink);
      text(fb, '6ステージ × 遊ぶほど強くなる', 90, 285, C.white, { align: 'center' });
    },
  },
  { // 5. 模倣学習：あなたのお手本をまねる
    t0: 11.2, t1: 13.4,
    enter(app) {
      this.f = new Flight(app, 0, 4001, [BASE], { z0: -2, look: PLAYER_LOOK, scale: 1 });
      this.t = 0;
    },
    update(app, dt) { this.t += dt; this.f.update(dt); },
    draw(app, fb, t) {
      const b = this.f.s.birds[0];
      band(fb, 10, 50);
      big(fb, 'あなたの操縦を', 14, C.white);
      big(fb, 'AIがまねる', 36, C.gold);
      // 指（スティック）
      const ox = 90, oy = 150;
      fb.circle(ox, oy, 20, C.white); fb.circle(ox, oy, 21, C.ink);
      const kx = Math.round(ox + b.out[0] * 20), ky = Math.round(oy - b.out[1] * 20);
      fb.disc(kx, ky, 6, C.ink); fb.disc(kx, ky, 5, C.white);
      fb.icon(ICON.hand, kx - 3, ky + 7, C.white);
      // まなび
      fb.rect(0, 206, 180, 94, C.navy);
      fb.rect(0, 206, 180, 1, C.gold);
      const k = Math.min(1, t / 1.8);
      const ax = b.out[0] * k + Math.sin(t * 9) * 0.6 * (1 - k), ay = b.out[1] * k + Math.cos(t * 7) * 0.6 * (1 - k);
      drawStick(fb, 26, 244, 18, ax, ay, C.yellow, b.out[0], b.out[1], C.white);
      fb.rect(8, 266, 3, 3, C.white); mini(fb, 'YOU', 13, 265, C.silver);
      fb.rect(30, 266, 3, 3, C.yellow); mini(fb, 'AI', 35, 265, C.silver);
      text(fb, '誤差', 54, 210, C.pink);
      const n = Math.max(2, Math.round(AD_LOSS.length * k));
      const L = AD_LOSS.map(v => Math.sqrt(v));      // 下がり方が見やすいように平方根で表示
      drawChart(fb, 54, 224, 118, 40, [{ data: L.slice(0, n), color: C.pink, dot: true }], { ymax: Math.max(...L) * 1.1 });
      text(fb, '模倣学習（誤差逆伝播）', 90, 284, C.white, { align: 'center' });
    },
  },
  { // 6. エンドカード
    t0: 13.4, t1: 15.0,
    enter(app) { this.f = new Flight(app, 0, 5001, variants(10, 1, 0.06, 0.2), { spread: 3, theme: 5 }); },
    update(app, dt) { this.f.update(dt); },
    draw(app, fb, t) {
      dim(fb, 0, 0, 180, 320);
      drawLogo(fb, 90, 40, 4);
      text(fb, 'AIヒナ そだてラボ', 90, 68, C.white, { align: 'center', outline: C.ink });
      const bob = Math.round(Math.sin(t * 6) * 2);
      fb.sprite(BIG_CHICK, 90 - 24, 88 + bob, colors({ c: rgb(PAL.yellow), d: rgb(PAL.gold) }), 3);
      big(fb, '遊んでわかる', 140, C.white);
      big(fb, '機械学習', 164, C.cyan);
      text(fb, '進化 × 模倣学習 × 3D', 90, 196, C.silver, { align: 'center', outline: C.ink });
      panel(fb, 20, 218, 140, 40, { fill: C.magenta, border: C.ink });
      text(fb, 'ブラウザで無料プレイ', 90, 222, C.white, { align: 'center' });
      text(fb, Math.floor(t * 3) % 2 ? '▶ いますぐ遊ぶ' : '　いますぐ遊ぶ', 90, 238, C.yellow, { align: 'center', bold: true });
      mini(fb, 'HSGWTEST-LGTM.GITHUB.IO', 90, 272, C.white, 'center');
      mini(fb, '/GAME/BITBIRDS', 90, 280, C.white, 'center');
      mini(fb, 'IPHONE / PC', 90, 296, C.silver, 'center');
    },
  },
];

class AdApp {
  constructor() {
    this.canvas = document.getElementById('c');
    this.px = new PixelRenderer(this.canvas, { fixed: { w: W, h: H, k: K, reserve: 64 }, preserve: true });
    this.world = new World3D();
    this.sound = new Sound();
    this.t = 0;
    this.playing = false;
    this.scene = -1;
    this.last = performance.now();
    window.addEventListener('resize', () => this.px.resize());
    this.enterScene(0);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  play() {
    this.paused = false;
    this.sound.unlock();
    this.t = 0;
    this.scene = -1;
    this.enterScene(0);
    this.playing = true;
  }

  // 確認用: i 番目の場面の lt 秒目へ飛んで止める
  seek(i, lt) {
    this.playing = false; this.paused = true;
    this.enterScene(i);
    this.t = SCENES[i].t0;
    for (let k = 0; k < Math.round(lt * 30); k++) { SCENES[i].update(this, 1 / 30); this.t += 1 / 30; }
  }

  enterScene(i) {
    this.scene = i;
    SCENES[i].enter(this);
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.playing) {
      this.t += dt;
      if (this.t >= DUR) { this.t = DUR - 0.001; this.playing = false; if (this.onEnd) this.onEnd(); }
      while (this.scene < SCENES.length - 1 && this.t >= SCENES[this.scene + 1].t0) this.enterScene(this.scene + 1);
    } else dt = (this.paused || this.t >= DUR - 0.01) ? 0 : dt;
    const sc = SCENES[this.scene];
    sc.update(this, dt);
    const fb = this.px.fb;
    fb.clear();
    const lt = this.t - sc.t0;
    sc.draw(this, fb, lt);
    // 場面の切りかわり（ドットのディザ）
    const toEnd = sc.t1 - this.t;
    if (lt < 0.12) fb.dither(0, 0, 180, 320, C.ink, Math.round((1 - lt / 0.12) * 16));
    else if (toEnd < 0.1 && this.scene < SCENES.length - 1) fb.dither(0, 0, 180, 320, C.ink, Math.round((1 - toEnd / 0.1) * 16));
    // 進行バー（広告の長さ）
    if (!this.playing && this.t < 0.01) { text(fb, '▶ 再生 をおしてください', 90, 150, C.white, { align: 'center', outline: C.ink }); }
    this.px.setViewHeight(this.px.VH);
    this.px.render(this.world.scene, this.world.camera, this.world.theme.fog);
  }
}

// ── 録画 ──
function pickMime() {
  if (!window.MediaRecorder) return null;
  for (const m of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* noop */ }
  }
  return null;
}

const app = new AdApp();
window.__ad = app;
window.__adScenes = SCENES;
const st = document.getElementById('st');
const btnPlay = document.getElementById('play'), btnRec = document.getElementById('rec');
btnPlay.onclick = () => { app.onEnd = null; app.play(); st.textContent = '再生中…'; app.onEnd = () => { st.textContent = '1080×1920 / 15秒'; }; };
btnRec.onclick = () => {
  const mime = pickMime();
  if (!mime || !app.canvas.captureStream) { st.textContent = 'この端末は録画に未対応（画面収録を使ってください）'; return; }
  app.sound.unlock();
  const stream = app.canvas.captureStream(30);
  const as = app.sound.recordStream();
  if (as && as.getAudioTracks()[0]) stream.addTrack(as.getAudioTracks()[0]);
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000 });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `bitbirds_ad_15s.${ext}`; a.id = 'dl';
    a.textContent = `保存（${(blob.size / 1e6).toFixed(1)}MB ${ext}）`;
    st.textContent = '';
    st.appendChild(a);
    a.click();
    btnPlay.disabled = btnRec.disabled = false;
  };
  btnPlay.disabled = btnRec.disabled = true;
  st.textContent = '録画中…';
  rec.start(500);
  app.play();
  app.onEnd = () => setTimeout(() => rec.stop(), 150);
};
