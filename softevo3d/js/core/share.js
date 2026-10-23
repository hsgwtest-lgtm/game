// 共有と書き出し
//  ・共有コード: 体＋いちばん良い脳を短い文字列に。URL（#c=...）で送ると、相手の端末でもまったく同じ動きをする（物理が決定論的なので）
//  ・ファイル書き出し: 記録とアルバムを丸ごと JSON に（バックアップ用）

import { normalizeVoxels, validateVoxels, MAX_VOXELS } from '../sim/body.js';
import { normalizeEnv } from '../sim/creature.js';

function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) { return null; }
}
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

export function genomeToB64(g) { return b64encode(new Uint8Array(Float32Array.from(g).buffer)); }
export function b64ToGenome(s) { const b = b64decode(s); return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4)).slice(); }

// 送る中身
export function sharePayload(rec, champ) {
  return {
    t: 'se3d', v: 1, n: rec.name, vox: rec.voxels, h: rec.hidden, env: rec.env, lv: rec.level,
    gen: champ ? champ.gen : 0, fit: champ ? champ.fit : 0, g: champ ? genomeToB64(champ.g) : null,
    moves: Object.keys(rec.moves || {}),
  };
}

export async function encodeShare(payload) {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const z = await deflate(json);
  return z ? 'z' + b64encode(z) : 'j' + b64encode(json);
}

export async function decodeShare(code) {
  code = String(code || '').trim();
  const m = /[#&?]c=([A-Za-z0-9_-]+)/.exec(code);
  if (m) code = m[1];
  if (!code) throw new Error('コードが空です');
  let p;
  try {
    const kind = code[0], body = b64decode(code.slice(1));
    const bytes = kind === 'z' ? await inflate(body) : body;
    p = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new Error('コードが こわれているか、とちゅうで きれています');
  }
  return validatePayload(p);
}

export function validatePayload(p) {
  if (!p || p.t !== 'se3d') throw new Error('SoftEvo 3D のコードではありません');
  const vox = normalizeVoxels(p.vox);
  if (vox.length > MAX_VOXELS) throw new Error('ボクセルが多すぎます');
  const v = validateVoxels(vox);
  if (!v.ok) throw new Error('体のデータがこわれています');
  const name = String(p.n || 'ナナシ').slice(0, 8);
  const hidden = [8, 12, 16].includes(p.h) ? p.h : 12;
  let g = null;
  if (p.g) { g = b64ToGenome(p.g); if (g.some(x => !Number.isFinite(x) || Math.abs(x) > 50)) g = null; }
  return { name, voxels: vox, hidden, env: normalizeEnv(p.env), level: Math.max(1, Math.min(99, p.lv | 0)), gen: p.gen | 0, fit: +p.fit || 0, genome: g };
}

export function readShareFromHash() {
  try {
    const m = /[#&]c=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return null;
    history.replaceState(null, '', location.pathname + location.search);
    return m[1];
  } catch (e) { return null; }
}

export function shareURL(code) {
  return location.origin + location.pathname + '#c=' + code;
}

// ── ファイル ──
export function downloadJSON(name, obj) {
  const json = JSON.stringify(obj, (k, v) => (v instanceof Float32Array || v instanceof Float64Array) ? { $f32: genomeToB64(v) } : v);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function parseJSON(text) {
  return JSON.parse(text, (k, v) => (v && typeof v === 'object' && typeof v.$f32 === 'string') ? b64ToGenome(v.$f32) : v);
}

export function pickFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) { resolve(null); return; }
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsText(f);
    };
    inp.click();
  });
}

// 共有の窓（コードを先に作っておき、ボタンを押したその場でコピー／シェアする）
export async function openShareDialog(app, rec, champ, message, C) {
  const code = await encodeShare(sharePayload(rec, champ));
  const url = shareURL(code);
  const buttons = [];
  if (navigator.share) buttons.push({ label: 'シェア', immediate: true, accent: C.lime, onTap: () => { navigator.share({ title: 'SoftEvo 3D', text: `${rec.name}（LV${rec.level}）を育てたよ！`, url }).catch(() => {}); } });
  buttons.push({ label: 'コピー', immediate: true, accent: navigator.share ? null : C.lime, onTap: () => { copyText(url).then(ok => { app.toast(ok ? 'URLを コピーしました' : 'コピーできませんでした', ok ? C.lime : C.red); app.sfx(ok ? 'save' : 'error'); }); } });
  buttons.push({ label: 'とじる' });
  message(app, {
    title: '共有コード', sfx: 'card',
    text: `${rec.name} の体と いちばん良い脳を URL にしました。ひらいた人の図鑑に、同じ動きをする生き物が とどきます。`,
    buttons,
  });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) { return false; }
  }
}
