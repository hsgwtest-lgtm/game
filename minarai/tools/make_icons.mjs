// アイコンを作る（開発用）: node tools/make_icons.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const sharp = createRequire('/opt/npm-tools/node_modules/')('sharp');
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');

// 真上から見たアーム（「AIの目」と同じ配色）。pad: まわりの余白（マスク用アイコンは広めに）
function svg(size, pad) {
  const s = 512, k = (1 - pad * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#12204a"/><stop offset="1" stop-color="#05070f"/></radialGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="${s}" height="${s}" fill="url(#bg)"/>
  <g transform="translate(${s / 2} ${s / 2}) scale(${k}) translate(${-s / 2} ${-s / 2})">
    <circle cx="256" cy="268" r="204" fill="none" stroke="#19f0ff" stroke-opacity=".35" stroke-width="5"/>
    <circle cx="256" cy="268" r="118" fill="none" stroke="#2a3f73" stroke-width="4"/>
    <circle cx="372" cy="356" r="52" fill="#783e00"/><circle cx="372" cy="356" r="52" fill="none" stroke="#ff9614" stroke-width="6" filter="url(#glow)"/>
    <g filter="url(#glow)">
      <line x1="256" y1="268" x2="176" y2="176" stroke="#4868ff" stroke-width="36" stroke-linecap="round"/>
      <line x1="176" y1="176" x2="296" y2="128" stroke="#28c8ff" stroke-width="30" stroke-linecap="round"/>
      <circle cx="176" cy="176" r="20" fill="#bec4dc"/>
      <circle cx="256" cy="268" r="30" fill="#60647c"/>
      <rect x="312" y="96" width="56" height="56" rx="6" fill="#ff9614" transform="rotate(-22 340 124)"/>
      <g transform="rotate(-22 340 124)" fill="#ff40c8"><rect x="296" y="80" width="16" height="92" rx="4"/><rect x="304" y="80" width="72" height="15" rx="4"/><rect x="304" y="157" width="72" height="15" rx="4"/></g>
    </g>
  </g>
</svg>`;
}
for (const [name, size, pad] of [['icon-512.png', 512, 0.04], ['icon-192.png', 192, 0.04], ['apple-touch-icon.png', 180, 0.04], ['icon-maskable-512.png', 512, 0.14]]) {
  await sharp(Buffer.from(svg(size, pad))).png().toFile(path.join(OUT, name));
  console.log('wrote', name);
}
