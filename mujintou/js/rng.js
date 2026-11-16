// 決定的な乱数まわり。Math.random は使わない（同じ入力なら必ず同じ島・同じ暮らしになる）。

export function hashInt(n) {
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return (n ^ (n >>> 16)) >>> 0;
}

export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return hashInt(h >>> 0);
}

// 複数の整数をまとめて1つのハッシュへ
export function hashMix(...nums) {
  let h = 0x9e3779b9;
  for (const n of nums) {
    h = hashInt((h ^ (n | 0)) + 0x7f4a7c15);
  }
  return h >>> 0;
}

// 0以上1未満
export function hash01(...nums) {
  return hashMix(...nums) / 4294967296;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 値ノイズ（-1〜1）
export function makeNoise2D(seed) {
  const lattice = (ix, iy) => hash01(ix, iy, seed) * 2 - 1;
  const fade = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const a = lattice(ix, iy);
    const b = lattice(ix + 1, iy);
    const c = lattice(ix, iy + 1);
    const d = lattice(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fbm(x, y, octaves = 4) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * freq + o * 17.3, y * freq - o * 9.1) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
  return { noise, fbm };
}
