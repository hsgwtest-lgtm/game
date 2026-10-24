// 地形（高さの関数）。物理と3D表示で同じ関数を使う。スタート地点（x < 0.5）はどれも平ら。
import { dsin, dcos } from './dmath.js';

function smooth(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

export const TERRAINS = {
  flat: { name: 'へいち' },
  hills: { name: 'おか' },
  rough: { name: 'でこぼこ' },
  steps: { name: 'だんさ' },
  slope: { name: 'のぼりざか' },
  beach: { name: 'はまべ' },
  ice: { name: 'こおり' },
};

export function heightAt(type, x, z) {
  switch (type) {
    case 'hills': { const u = x - 0.5; return smooth(u / 1.5) * (0.18 * (1 - dcos(0.6 * u)) + 0.05 * dsin(1.7 * u)); }
    case 'rough': { const r = smooth((x - 0.5) / 1.0); return r * 0.03 * (dsin(4.1 * x) * dsin(3.3 * z + 0.5) + 0.6 * dsin(7.7 * x + 1.1) * dcos(5.9 * z) + 1.6); }
    case 'steps': {
      const u = x - 1.0;
      if (u < 0) return 0;
      const L = 0.9, H = 0.06, rise = 0.12;
      const n = Math.floor(u / L), f = u - n * L;
      return H * (n + smooth((f - (L - rise)) / rise));
    }
    case 'slope': { const u = x - 0.5; return u > 0 ? 0.12 * u * smooth(u / 2) : 0; }
    case 'beach': { const u = x; return u < -1 ? -0.5 : 0.18 * u; }
    default: return 0;
  }
}

export function makeTerrain(type, env = {}) {
  const flat = !type || type === 'flat' || type === 'ice';
  const e = 1e-4;
  const t = {
    type, flat,
    friction: type === 'ice' ? 0.12 : (env.friction || 1),
    h: flat ? () => 0 : (x, z) => heightAt(type, x, z),
    n: flat ? (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } : (x, z, o) => {
      const hx = (heightAt(type, x + e, z) - heightAt(type, x - e, z)) / (2 * e);
      const hz = (heightAt(type, x, z + e) - heightAt(type, x, z - e)) / (2 * e);
      const inv = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
      o[0] = -hx * inv; o[1] = inv; o[2] = -hz * inv;
      return o;
    },
    water: null,
  };
  if (type === 'beach') { const lv = env.deep ? 0.4 : 0.12; t.water = () => lv; t.waterLevel = lv; }  // 波打ち際（陸へ上がるほど浅く）
  if (env.shallow) { const lv = env.shallow; t.water = () => lv; t.waterLevel = lv; }     // 浅い水たまり
  return t;
}
