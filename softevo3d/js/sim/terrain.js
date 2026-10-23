// 地形（高さの関数）。物理と3D表示で同じ関数を使う。
// スタート地点（x < 0.6m）はどの地形でも平ら。
// でこぼこは z 方向に 1m・2/3m 周期 → パレードの各レーン（2m間隔）が同じ地形になる。

import { dsin, dcos } from './dmath.js';

export const TERRAINS = {
  flat: { name: 'へいち', desc: 'たいらな じめん' },
  hills: { name: 'おか', desc: 'ゆるやかな のぼりくだり' },
  bumpy: { name: 'でこぼこ', desc: 'こまかい でこぼこ' },
  stairs: { name: 'かいだん', desc: 'すこしずつ のぼる だんさ' },
};
export const TERRAIN_KEYS = ['flat', 'hills', 'bumpy', 'stairs'];
export const LANE_GAP = 2.0;

function smooth(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
function ramp(x) { return smooth((x - 0.6) / 1.2); }

const PI = 3.141592653589793;
const STEP_LEN = 0.8, STEP_H = 0.04, STEP_RISE = 0.1;

export function heightAt(type, x, z) {
  switch (type) {
    case 'hills': {
      const u = x - 0.6;
      return ramp(x) * (0.11 * (1 - dcos(0.85 * u)) + 0.035 * dsin(2.6 * u));
    }
    case 'bumpy': {
      const b = dsin(3.7 * x) * dsin(2 * PI * z) + 0.6 * dsin(7.3 * x + 1.3) * dcos(3 * PI * z + 0.4);
      return ramp(x) * 0.022 * (b + 1.6);
    }
    case 'stairs': {
      const u = x - 1.2;
      if (u < 0) return 0;
      const n = Math.floor(u / STEP_LEN);
      const f = u - n * STEP_LEN;
      return STEP_H * (n + smooth((f - (STEP_LEN - STEP_RISE)) / STEP_RISE));
    }
    default: return 0;
  }
}

// 地面の高さと（上向きの）法線をまとめて返すオブジェクト
export function makeGround(type) {
  const flat = !TERRAINS[type] || type === 'flat';
  const e = 1e-4;
  return {
    type: flat ? 'flat' : type,
    flat,
    h(x, z) { return flat ? 0 : heightAt(type, x, z); },
    // out = [nx, ny, nz]
    normal(x, z, out) {
      if (flat) { out[0] = 0; out[1] = 1; out[2] = 0; return out; }
      const hx = (heightAt(type, x + e, z) - heightAt(type, x - e, z)) / (2 * e);
      const hz = (heightAt(type, x, z + e) - heightAt(type, x, z - e)) / (2 * e);
      const inv = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
      out[0] = -hx * inv; out[1] = inv; out[2] = -hz * inv;
      return out;
    },
  };
}
