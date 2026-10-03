// 修行場（グリッドの世界）のシミュレーション
// 3つの流派すべてが「同じ世界・同じ目・同じ脳の形」で学ぶ。ちがうのは学び方だけ。
//
// 1ステップ: でしが5つの行動（↑↓←→・待つ）から1つを選ぶ → 動く → オニが動く → 当たり判定
// オニやトゲは時刻 t だけで決まる（全員で同じ時計を共有するので、群れや分身が同じ画面で走れる）。

export const T_FLOOR = 0, T_WALL = 1, T_VOID = 2, T_GOAL = 3, T_DOOR = 4, T_SPIKE_A = 5, T_SPIKE_B = 6;

// 行動: 0=↑(奥へ) 1=↓(手前へ) 2=← 3=→ 4=待つ
export const ACTS = [[0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]];
export const N_ACT = 5;
export const A_WAIT = 4;

// 目（5×5マス）× 4チャンネル（かべ・きけん・ゴール・アイテム）＋ 5つ（ゴールの方角x,y・カギ・位置x,y）
export const VR = 2, VS = 5, VC = 25, N_CH = 4;
export const N_IN = N_CH * VC + 5;
export const CH_WALL = 0, CH_DANGER = 1, CH_GOAL = 2, CH_ITEM = 3;
export const I_DX = 100, I_DY = 101, I_KEY = 102, I_PX = 103, I_PY = 104;

// 終わった理由
export const C_NONE = 0, C_GOAL = 1, C_FALL = 2, C_ONI = 3, C_SPIKE = 4, C_TIME = 5;

// できごと（見た目と効果音用のビット）
export const EV_MOVE = 1, EV_BUMP = 2, EV_FALL = 4, EV_ONI = 8, EV_SPIKE = 16, EV_COIN = 32,
  EV_KEY = 64, EV_GOAL = 128, EV_TIME = 256, EV_DOOR = 512;

// ごほうびの初期値（ステージや設定で上書き）
export const BASE_REWARD = {
  goal: 10,       // 巻物をとった
  death: -1,      // 落ちた・やられた
  step: -0.02,    // 1歩ごと（だらだらしないように）
  coin: 1,        // 小判
  key: 0,         // カギ
  shaping: 0.3,   // ゴールに（まっすぐの距離で）近づくと +、遠ざかると −。0 で切る
  explore: 0,     // はじめて行ったマスで +（探検ボーナス）
};

const BIG = 1 << 30;

export class Stage {
  // def: stages.js の定義。mirror=true で左右反転（応用問題用）
  constructor(def, mirror = false) {
    this.def = def;
    this.mirror = mirror;
    const rows = def.map;
    const H = this.H = rows.length;
    const W = this.W = rows[0].length;
    this.tiles = new Uint8Array(W * H);
    this.coins = [];
    this.coinAt = new Int16Array(W * H).fill(-1);
    this.keyIdx = -1;
    this.starts = [];
    this.goal = { x: 0, y: 0 };
    let hasDoor = false, hasSpike = false;
    for (let y = 0; y < H; y++) {
      const row = rows[y];
      if (row.length !== W) throw new Error(`stage ${def.id}: row ${y} width ${row.length} != ${W}`);
      for (let x = 0; x < W; x++) {
        const ch = row[mirror ? W - 1 - x : x];
        const i = y * W + x;
        let t = T_FLOOR;
        switch (ch) {
          case '.': break;
          case '#': t = T_WALL; break;
          case ' ': t = T_VOID; break;
          case 'S': this.starts.push({ x, y }); break;
          case 'G': t = T_GOAL; this.goal = { x, y }; break;
          case 'c': this.coinAt[i] = this.coins.length; this.coins.push({ x, y }); break;
          case 'k': this.keyIdx = i; break;
          case 'D': t = T_DOOR; hasDoor = true; break;
          case '^': t = T_SPIKE_A; hasSpike = true; break;
          case 'v': t = T_SPIKE_B; hasSpike = true; break;
          default: throw new Error(`stage ${def.id}: unknown tile '${ch}'`);
        }
        this.tiles[i] = t;
      }
    }
    if (!this.starts.length) throw new Error(`stage ${def.id}: no start`);
    this.start = this.starts[0];
    this.multiStart = this.starts.length > 1;
    this.hasKey = this.keyIdx >= 0;
    this.hasDoor = hasDoor;
    this.hasSpike = hasSpike;
    this.hasCoin = this.coins.length > 0;
    this.maxSteps = def.maxSteps || 50;
    this.spikeP = def.spikePeriod || 4;
    this.coinRespawn = def.coinRespawn || 0;
    // オニ: 道のり（往復 or 周回）を1歩ずつの位置の列にしておく
    this.enemies = (def.enemies || []).map((e) => {
      const pts = e.path.map(([x, y]) => [mirror ? W - 1 - x : x, y]);
      const seq = [];
      for (let k = 0; k < pts.length; k++) {
        const [x0, y0] = pts[k];
        if (k === 0) { seq.push(y0 * W + x0); continue; }
        // 前の点からまっすぐ1マスずつ進む（同じ点の繰り返しは「その場で待つ」）
        let [px, py] = pts[k - 1];
        if (px === x0 && py === y0) { seq.push(y0 * W + x0); continue; }
        while (px !== x0 || py !== y0) {
          if (px !== x0) px += Math.sign(x0 - px); else py += Math.sign(y0 - py);
          seq.push(py * W + px);
        }
      }
      let cyc = seq;
      if ((e.mode || 'pingpong') === 'pingpong' && seq.length > 1) {
        cyc = seq.concat(seq.slice(1, -1).reverse());
      }
      if (e.delay) { const d = e.delay % cyc.length; cyc = cyc.slice(d).concat(cyc.slice(0, d)); }
      return { seq: Int16Array.from(cyc), color: e.color || 0 };
    });
    // 「まっすぐの距離」（ごほうびの近づき判定）
    this.dist = new Int16Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      this.dist[y * W + x] = Math.abs(x - this.goal.x) + Math.abs(y - this.goal.y);
  }

  tile(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return T_VOID;
    return this.tiles[y * this.W + x];
  }

  // トゲが時刻 t に出ているか（A と B は交互）
  spikeOn(tile, t) {
    if (tile !== T_SPIKE_A && tile !== T_SPIKE_B) return false;
    const half = this.spikeP >> 1;
    const aOn = (t % this.spikeP) < half;
    return tile === T_SPIKE_A ? aOn : !aOn;
  }

  enemyPos(e, t) { const s = this.enemies[e].seq; return s[t % s.length]; }

  walkable(x, y) {
    const t = this.tile(x, y);
    return t !== T_WALL && t !== T_VOID;
  }
}

// 1回の挑戦（エピソード）。n人が同じ時計で同時に走る。
export class Episode {
  constructor(stage, n, rewards = BASE_REWARD, startIdx = 0) {
    this.st = stage;
    this.n = n;
    this.rw = Object.assign({}, BASE_REWARD, rewards);
    this.x = new Int16Array(n); this.y = new Int16Array(n);
    this.px = new Int16Array(n); this.py = new Int16Array(n);   // 1歩前の位置（アニメ用）
    this.alive = new Uint8Array(n); this.done = new Uint8Array(n); this.succ = new Uint8Array(n);
    this.key = new Uint8Array(n);
    this.ret = new Float32Array(n); this.r = new Float32Array(n);
    this.steps = new Int16Array(n); this.cause = new Uint8Array(n);
    this.ev = new Uint16Array(n); this.act = new Int8Array(n);
    this.coinsGot = new Int16Array(n);
    this.endT = new Int16Array(n);
    const nc = stage.coins.length;
    this.coinT = new Int32Array(Math.max(1, n * nc));
    const W = stage.W, H = stage.H;
    this.visited = new Uint8Array(n * W * H);   // 探検ボーナス用：行ったことのあるマス
    this.eNextGrid = new Uint8Array(W * H);
    this.eCur = new Int16Array(stage.enemies.length);
    this.eNext = new Int16Array(stage.enemies.length);
    this._prepT = -1;
    this.reset(startIdx);
  }

  // startIdx: スタート地点の番号（毎回ちがう修行場用）。全員が同じ地点から同時に出発する
  reset(startIdx = 0) {
    const st = this.st;
    this.startIdx = Math.max(0, Math.min(st.starts.length - 1, startIdx | 0));
    const s0 = st.starts[this.startIdx];
    this.t = 0;
    this.x.fill(s0.x); this.y.fill(s0.y);
    this.px.fill(s0.x); this.py.fill(s0.y);
    this.alive.fill(1); this.done.fill(0); this.succ.fill(0); this.key.fill(0);
    this.ret.fill(0); this.r.fill(0); this.steps.fill(0); this.cause.fill(0);
    this.ev.fill(0); this.act.fill(A_WAIT); this.coinsGot.fill(0); this.endT.fill(0);
    this.coinT.fill(0);
    this.visited.fill(0);
    const WH = st.W * st.H, si0 = s0.y * st.W + s0.x;
    for (let i = 0; i < this.n; i++) this.visited[i * WH + si0] = 1;
    this.doneCount = 0;
    this._prepT = -1;
  }

  get allDone() { return this.doneCount >= this.n; }

  // 時刻 t のオニの位置と、t+1 の位置（きけん）を用意する
  _prep(t) {
    if (this._prepT === t) return;
    this._prepT = t;
    const st = this.st, g = this.eNextGrid;
    g.fill(0);
    for (let e = 0; e < st.enemies.length; e++) {
      const c = st.enemyPos(e, t), nx = st.enemyPos(e, t + 1);
      this.eCur[e] = c; this.eNext[e] = nx;
      g[nx] = 1;
    }
  }

  // (x,y)→(nx,ny) に動いた時にオニに当たるか（同じマス or すれちがい）
  _oniHit(x, y, nx, ny) {
    const W = this.st.W, from = y * W + x, to = ny * W + nx;
    for (let e = 0; e < this.eCur.length; e++) {
      if (this.eNext[e] === to) return true;
      if (this.eCur[e] === to && this.eNext[e] === from) return true;
    }
    return false;
  }

  coinAvail(i, c, t) { return this.coinT[i * this.st.coins.length + c] <= t; }

  // 全員ぶんの行動を受け取って1ステップ進める（終わっている人は無視）
  step(acts) {
    const st = this.st, rw = this.rw, W = st.W;
    const t = this.t, t1 = t + 1;
    this._prep(t);
    const nc = st.coins.length;
    for (let i = 0; i < this.n; i++) {
      this.px[i] = this.x[i]; this.py[i] = this.y[i];
      if (this.done[i]) { this.r[i] = 0; this.ev[i] = 0; continue; }
      const x = this.x[i], y = this.y[i];
      let a = acts[i] | 0;
      if (a < 0 || a >= N_ACT) a = A_WAIT;
      this.act[i] = a;
      let nx = x + ACTS[a][0], ny = y + ACTS[a][1];
      let r = rw.step, ev = 0;
      if (a !== A_WAIT) {
        const tl = st.tile(nx, ny);
        if (tl === T_WALL || (tl === T_DOOR && !this.key[i])) { nx = x; ny = y; ev |= EV_BUMP; }
        else { ev |= EV_MOVE; if (tl === T_DOOR) ev |= EV_DOOR; }
      }
      const tl2 = st.tile(nx, ny);
      let dead = C_NONE;
      if (tl2 === T_VOID) dead = C_FALL;
      else if (this._oniHit(x, y, nx, ny)) dead = C_ONI;
      else if (st.spikeOn(tl2, t1)) dead = C_SPIKE;
      if (dead) {
        this.alive[i] = 0; this.done[i] = 1; this.cause[i] = dead; this.endT[i] = t1;
        this.doneCount++;
        r += rw.death;
        ev |= dead === C_FALL ? EV_FALL : dead === C_ONI ? EV_ONI : EV_SPIKE;
      } else {
        if (rw.shaping) r += rw.shaping * (st.dist[y * W + x] - st.dist[ny * W + nx]);
        const vi = i * W * st.H + ny * W + nx;
        if (!this.visited[vi]) { this.visited[vi] = 1; r += rw.explore; }
        const ci = st.coinAt[ny * W + nx];
        if (ci >= 0 && this.coinT[i * nc + ci] <= t1) {
          this.coinT[i * nc + ci] = st.coinRespawn > 0 ? t1 + st.coinRespawn : BIG;
          this.coinsGot[i]++;
          r += rw.coin; ev |= EV_COIN;
        }
        if (st.keyIdx === ny * W + nx && !this.key[i]) {
          this.key[i] = 1; r += rw.key; ev |= EV_KEY;
        }
        if (tl2 === T_GOAL) {
          this.succ[i] = 1; this.done[i] = 1; this.cause[i] = C_GOAL; this.endT[i] = t1;
          this.doneCount++;
          r += rw.goal; ev |= EV_GOAL;
        }
      }
      this.x[i] = nx; this.y[i] = ny;
      this.steps[i]++;
      this.ret[i] += r; this.r[i] = r; this.ev[i] = ev;
      if (!this.done[i] && t1 >= st.maxSteps) {
        this.done[i] = 1; this.cause[i] = C_TIME; this.endT[i] = t1; this.doneCount++;
        this.ev[i] |= EV_TIME;
      }
    }
    this.t = t1;
  }

  // でし i の「目」に映るもの（ox,oy を渡すとその場所にいたと仮定して計算＝方針マップ用）
  observe(i, out, ox = this.x[i], oy = this.y[i], hasKey = this.key[i]) {
    const st = this.st, W = st.W, H = st.H, t = this.t, t1 = t + 1;
    this._prep(t);
    const nc = st.coins.length;
    const g = this.eNextGrid;
    let c = 0;
    for (let dy = -VR; dy <= VR; dy++) {
      for (let dx = -VR; dx <= VR; dx++, c++) {
        const cx = ox + dx, cy = oy + dy;
        const inside = cx >= 0 && cy >= 0 && cx < W && cy < H;
        const tl = inside ? st.tiles[cy * W + cx] : T_VOID;
        const ci = cy * W + cx;
        out[c] = (tl === T_WALL || (tl === T_DOOR && !hasKey)) ? 1 : 0;
        let dg = tl === T_VOID ? 1 : 0;
        if (!dg && st.spikeOn(tl, t1)) dg = 1;
        if (!dg && inside && g[ci]) dg = 1;
        if (!dg && inside && (dx === 0 || dy === 0) && Math.abs(dx + dy) === 1) {
          const from = oy * W + ox;
          for (let e = 0; e < this.eCur.length; e++) if (this.eCur[e] === ci && this.eNext[e] === from) { dg = 1; break; }
        }
        out[VC + c] = dg;
        out[2 * VC + c] = tl === T_GOAL ? 1 : 0;
        let it = 0;
        if (inside) {
          const k = st.coinAt[ci];
          if (k >= 0 && (i < 0 || this.coinT[i * nc + k] <= t1)) it = 1;
          if (st.keyIdx === ci && !hasKey) it = 1;
        }
        out[3 * VC + c] = it;
      }
    }
    const gx = st.goal.x, gy = st.goal.y;
    out[I_DX] = Math.max(-1, Math.min(1, (gx - ox) / 6));
    out[I_DY] = Math.max(-1, Math.min(1, (gy - oy) / 6));
    out[I_KEY] = hasKey ? 1 : 0;
    out[I_PX] = ox / (W - 1) * 2 - 1;
    out[I_PY] = oy / (H - 1) * 2 - 1;
    return out;
  }

  // 生き残っている人数
  aliveCount() { let c = 0; for (let i = 0; i < this.n; i++) if (!this.done[i]) c++; return c; }
  successCount() { let c = 0; for (let i = 0; i < this.n; i++) if (this.succ[i]) c++; return c; }
}
