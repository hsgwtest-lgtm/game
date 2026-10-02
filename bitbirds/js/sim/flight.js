// 飛行シミュレーション：鳥の状態・ピクセルの目（光線による奥行き画像）・当たり判定・セッション

import { WORLD, EYE, N_EXTRA } from '../core/config.js';
import { Course, OB_GATE, OB_PILLAR, OB_LOG } from './course.js';

export const EYE_CELLS = EYE.cols * EYE.rows;
export const N_IN = EYE_CELLS + N_EXTRA;
const SUB = EYE.sub * EYE.sub;

// ── 目の光線の向きを前計算（ピンホールカメラと同じ投影）──
export const RAYS = (() => {
  const out = new Float32Array(EYE_CELLS * SUB * 3);
  const fx = Math.tan((EYE.fovX / 2) * Math.PI / 180);
  const fy = Math.tan((EYE.fovY / 2) * Math.PI / 180);
  let k = 0;
  for (let r = 0; r < EYE.rows; r++) {
    for (let c = 0; c < EYE.cols; c++) {
      for (let sy = 0; sy < EYE.sub; sy++) {
        for (let sx = 0; sx < EYE.sub; sx++) {
          // 画像の上の行 = 上を見る
          const u = ((c + (sx + 0.5) / EYE.sub) / EYE.cols) * 2 - 1;   // -1..1 左→右
          const v = 1 - ((r + (sy + 0.5) / EYE.sub) / EYE.rows) * 2;   // 1..-1 上→下
          let dx = u * fx, dy = v * fy, dz = -1;
          const l = Math.hypot(dx, dy, dz);
          out[k++] = dx / l; out[k++] = dy / l; out[k++] = dz / l;
        }
      }
    }
  }
  return out;
})();

let NEXT_ID = 1;

export class Bird {
  constructor(opts = {}) {
    this.id = NEXT_ID++;
    this.eye = new Float32Array(EYE_CELLS);   // 近さ: 0=遠い/何もない … 1=すぐ目の前
    this.inp = new Float32Array(N_IN);
    this.out = new Float32Array(2);           // -1..1 の操縦（横, 縦）
    this.ctrl = opts.ctrl || null;            // (bird) => void で out を決める
    this.tag = opts.tag || null;              // 画面側が自由に使うデータ
    this.reset(opts.x || 0, opts.y ?? WORLD.START_Y);
  }
  reset(x = 0, y = WORLD.START_Y) {
    this.x = x; this.y = y; this.z = 0;
    this.px = x; this.py = y; this.pz = 0;     // 前ステップの位置（描画の補間用）
    this.vx = 0; this.vy = 0;
    this.alive = true;
    this.cause = null;
    this.dist = 0;
    this.bonus = 0;     // ほうしゅう設計: ぶつかった時に「通り道にどれだけ近かったか」
    this.rows = 0;
    this.t = 0;
    this.deathT = 0;
    this.cursor = 0;
    this.rowCursor = 0;
    this.out[0] = 0; this.out[1] = 0;
    this.flap = Math.random() * 6.28;
  }
}

// ── 1本の光線を飛ばして、ぶつかるまでの距離を返す ──
function castRay(ox, oy, oz, dx, dy, dz, obs, i0) {
  const XMIN = WORLD.XMIN, XMAX = WORLD.XMAX, YMIN = WORLD.YMIN, YMAX = WORLD.YMAX;
  let best = WORLD.DMAX;
  let s;
  if (dx < 0) { s = (XMIN - ox) / dx; if (s < best) best = s; }
  else if (dx > 0) { s = (XMAX - ox) / dx; if (s < best) best = s; }
  if (dy < 0) { s = (YMIN - oy) / dy; if (s < best) best = s; }
  else if (dy > 0) { s = (YMAX - oy) / dy; if (s < best) best = s; }
  const n = obs.length;
  for (let i = i0; i < n; i++) {
    const o = obs[i];
    if (o.z + 1.6 < oz - best) break;   // これより奥は今の最短距離より遠い
    if (o.type === OB_GATE) {
      const zf = o.z + o.t * 0.5;
      if (oz > zf) {
        s = (zf - oz) / dz;
        if (s < best) {
          const hx = ox + s * dx - o.cx, hy = oy + s * dy - o.cy;
          if (!(hx < o.hw * 0.5 && hx > -o.hw * 0.5 && hy < o.hh * 0.5 && hy > -o.hh * 0.5)) best = s;
        }
      }
    } else if (o.type === OB_PILLAR) {
      const ex = ox - o.x, ez = oz - o.z;
      const a = dx * dx + dz * dz;
      const b = 2 * (dx * ex + dz * ez);
      const c = ex * ex + ez * ez - o.r * o.r;
      const disc = b * b - 4 * a * c;
      if (disc >= 0 && a > 1e-9) {
        s = (-b - Math.sqrt(disc)) / (2 * a);
        if (s > 0 && s < best) best = s;
      }
    } else { // OB_LOG
      const ey = oy - o.y, ez = oz - o.z;
      const a = dy * dy + dz * dz;
      const b = 2 * (dy * ey + dz * ez);
      const c = ey * ey + ez * ez - o.r * o.r;
      const disc = b * b - 4 * a * c;
      if (disc >= 0 && a > 1e-9) {
        s = (-b - Math.sqrt(disc)) / (2 * a);
        if (s > 0 && s < best) best = s;
      }
    }
  }
  return best;
}

// ── 目の画像と入力ベクトルを作る ──
export function sense(b, course) {
  const obs = course.obs;
  // カーソルを「まだ越えていない最初の障害物」まで進める
  let i0 = b.cursor;
  while (i0 < obs.length && obs[i0].z > b.z + 2.5) i0++;
  b.cursor = i0;
  const invL = 1 / EYE.lambda;
  const invSub = 1 / SUB;
  let k = 0;
  for (let cell = 0; cell < EYE_CELLS; cell++) {
    let acc = 0;
    for (let s = 0; s < SUB; s++) {
      const d = castRay(b.x, b.y, b.z, RAYS[k], RAYS[k + 1], RAYS[k + 2], obs, i0);
      k += 3;
      acc += Math.exp(-d * invL);
    }
    const v = acc * invSub;
    b.eye[cell] = v;
    b.inp[cell] = v;
  }
  const inp = b.inp;
  inp[EYE_CELLS] = b.vx / WORLD.VLAT;
  inp[EYE_CELLS + 1] = b.vy / WORLD.VLAT;
  inp[EYE_CELLS + 2] = b.x / WORLD.XMAX;
  inp[EYE_CELLS + 3] = (b.y - (WORLD.YMIN + WORLD.YMAX) / 2) / ((WORLD.YMAX - WORLD.YMIN) / 2);
}

// ── 1ステップ動かして当たり判定。ぶつかったら原因を返す ──
export function physics(b, course, dt, speed) {
  const R = WORLD.R;
  const k = Math.min(1, WORLD.RESP * dt);
  const ox = Math.max(-1, Math.min(1, b.out[0]));
  const oy = Math.max(-1, Math.min(1, b.out[1]));
  b.vx += (ox * WORLD.VLAT - b.vx) * k;
  b.vy += (oy * WORLD.VLAT - b.vy) * k;
  b.px = b.x; b.py = b.y; b.pz = b.z;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z -= speed * dt;
  b.t += dt;
  b.dist = -b.z;
  b.flap += dt * (9 + Math.abs(b.vy) * 1.5);
  // 天井は押し戻すだけ
  if (b.y > WORLD.YMAX - R) { b.y = WORLD.YMAX - R; if (b.vy > 0) b.vy = 0; }
  if (b.x < WORLD.XMIN + R || b.x > WORLD.XMAX - R) return 'wall';
  if (b.y < WORLD.YMIN + R) return 'ground';
  const obs = course.obs;
  for (let i = b.cursor; i < obs.length; i++) {
    const o = obs[i];
    if (o.z < b.z - 2.5) break;
    if (o.type === OB_GATE) {
      if (Math.abs(b.z - o.z) < o.t * 0.5 + R) {
        const hx = b.x - o.cx, hy = b.y - o.cy;
        if (!(Math.abs(hx) < o.hw * 0.5 - R && Math.abs(hy) < o.hh * 0.5 - R)) return 'gate';
      }
    } else if (o.type === OB_PILLAR) {
      const ex = b.x - o.x, ez = b.z - o.z, rr = o.r + R;
      if (ex * ex + ez * ez < rr * rr) return 'pillar';
    } else {
      const ey = b.y - o.y, ez = b.z - o.z, rr = o.r + R;
      if (ey * ey + ez * ez < rr * rr) return 'log';
    }
  }
  return null;
}

// ほうしゅう設計（報酬シェーピング）:
// ぶつかった時、次の通り道（穴）にどれだけ近かったかで少しだけ点を足す。
// これがないと「最初の穴を偶然くぐれる子」が出るまで何も学べない。
export const BONUS_MAX = 6;
export function shapingBonus(b, rows) {
  // ぶつかった列（または次に来る列）を探す
  let i = b.rowCursor;
  while (i < rows.length && rows[i].z > b.z + 1.5) i++;
  if (i >= rows.length) return 0;
  const r = rows[i];
  const gx = r.gate ? r.gate.cx : r.gx, gy = r.gate ? r.gate.cy : r.gy;
  const mx = Math.max(0, Math.abs(b.x - gx) - r.gw / 2);
  const my = Math.max(0, Math.abs(b.y - gy) - r.gh / 2);
  const miss = Math.hypot(mx, my);
  const dz = Math.max(0, b.z - r.z);
  return BONUS_MAX * Math.max(0, 1 - miss / 5) * Math.max(0, 1 - dz / 24);
}

export const CAUSE_LABEL = {
  wall: 'がけ', ground: 'じめん', gate: 'かべ', pillar: 'はしら', log: 'まるた',
};

// ── セッション：1つのコースを何羽かで同時に飛ぶ ──
export class Session {
  constructor(stage, seed, opts = {}) {
    this.stage = stage;
    this.seed = seed;
    this.course = new Course(stage, seed);
    this.birds = [];
    this.T = 0;
    this.steps = 0;
    this.events = [];
    this.maxDist = opts.maxDist ?? Infinity;  // ここまで飛んだら完走（止める）
    this.aliveCount = 0;
    this.leader = null;
  }
  add(bird) { this.birds.push(bird); this.aliveCount++; return bird; }

  get done() { return this.aliveCount === 0; }

  step(dt = WORLD.DT) {
    const speed = this.stage.speed;
    const course = this.course;
    // 一番前の鳥の先までコースを伸ばす
    let minZ = 0;
    for (const b of this.birds) if (b.alive && b.z < minZ) minZ = b.z;
    course.ensure(minZ - WORLD.DMAX - 40);
    course.update(this.T);
    const rows = course.rows;
    let alive = 0, leader = null;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      if (!b.alive) continue;
      sense(b, course);
      if (b.ctrl) b.ctrl(b);
      const cause = physics(b, course, dt, speed);
      if (cause) b.bonus = shapingBonus(b, rows);
      // 越えた列を数える
      while (b.rowCursor < rows.length && rows[b.rowCursor].z > b.z) {
        b.rowCursor++;
        if (!cause) { b.rows++; this.events.push({ type: 'pass', bird: b, row: rows[b.rowCursor - 1] }); }
      }
      if (cause) {
        b.alive = false; b.cause = cause; b.deathT = this.T;
        this.events.push({ type: 'crash', bird: b, cause });
        continue;
      }
      if (b.dist >= this.maxDist) {
        b.alive = false; b.cause = 'finish'; b.dist = this.maxDist; b.deathT = this.T;
        this.events.push({ type: 'finish', bird: b });
        continue;
      }
      alive++;
      if (!leader || b.z < leader.z) leader = b;
    }
    this.aliveCount = alive;
    if (leader) this.leader = leader;
    this.T += dt;
    this.steps++;
  }

  // イベントを取り出して空にする
  drain() { const e = this.events; this.events = []; return e; }
}
