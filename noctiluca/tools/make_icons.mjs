// アイコンを作る（開発用）: node tools/make_icons.mjs
// 渦をまいて泳ぐ光の粒（餌場のまわりを回る群れ）を、点の集まりで描く
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('/opt/npm-tools/node_modules/sharp');
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };

function svg(size, inset) {
  const c = size / 2;
  const R = size * 0.27 * inset;
  let dots = '';
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * Math.PI * 2;
    const ring = R * (1 + gauss() * 0.11);
    const swirl = a + (ring - R) / R * 1.2;
    const x = c + Math.cos(swirl) * ring;
    const y = c + Math.sin(swirl) * ring * 0.96;
    const s = size * (0.0022 + rnd() * 0.0026);
    const glow = rnd() < 0.06;
    const op = 0.35 + rnd() * 0.5;
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(glow ? s * 1.9 : s).toFixed(2)}" fill="${glow ? '#e8f8ff' : '#49c8ff'}" opacity="${op.toFixed(2)}"/>`;
  }
  // 散らばる粒
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2;
    const d = R * (1.35 + rnd() * 1.1);
    dots += `<circle cx="${(c + Math.cos(a) * d).toFixed(1)}" cy="${(c + Math.sin(a) * d).toFixed(1)}" r="${(size * 0.002).toFixed(2)}" fill="#49c8ff" opacity="${(0.15 + rnd() * 0.3).toFixed(2)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="48%" r="70%"><stop offset="0" stop-color="#0a2c4f"/><stop offset="0.55" stop-color="#041226"/><stop offset="1" stop-color="#01040b"/></radialGradient>
    <radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#f2c35b" stop-opacity="0.38"/><stop offset="1" stop-color="#f2c35b" stop-opacity="0"/></radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="${(size * 0.004).toFixed(2)}"/></filter>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <circle cx="${c}" cy="${c}" r="${R * 0.8}" fill="url(#core)"/>
  <g filter="url(#soft)" opacity="0.9">${dots}</g>
  <g>${dots}</g>
</svg>`;
}

async function make(name, size, inset = 1) {
  await sharp(Buffer.from(svg(size, inset))).png().toFile(path.join(ROOT, 'icons', name));
  console.log('icons/' + name);
}

await make('icon-512.png', 512);
await make('icon-192.png', 192);
await make('apple-touch-icon.png', 180);
await make('icon-maskable-512.png', 512, 0.8);
