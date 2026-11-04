/* ポケカ番号サーチ — カード左下の「sv3 066/108」からカードを特定する */
'use strict';

const $ = (s) => document.querySelector(s);
const inSet = $('#inSet'), inNum = $('#inNum'), inTot = $('#inTot');
const elStatus = $('#status'), elResults = $('#results');

const IMG_BASE = 'https://assets.tcgdex.net/ja';
const TYPE_JA = { Fire: '炎', Water: '水', Grass: '草', Lightning: '雷', Psychic: '超', Fighting: '闘', Darkness: '悪', Metal: '鋼', Dragon: 'ドラゴン', Fairy: 'フェアリー', Colorless: '無色' };
const RARITY_JA = {
  'Common': 'C', 'Uncommon': 'U', 'Rare': 'R', 'Holo Rare': 'R（キラ）', 'Rare Holo': 'R（キラ）', 'Double rare': 'RR', 'Triple Rare': 'RRR',
  'Illustration rare': 'AR', 'Special illustration rare': 'SAR', 'Ultra Rare': 'SR', 'Secret Rare': 'SR', 'Hyper rare': 'UR',
  'Mega Hyper Rare': 'MUR', 'Shiny rare': 'S', 'Shiny Ultra Rare': 'SSR', 'ACE SPEC Rare': 'ACE', 'Character Rare': 'CHR',
  'Character Super Rare': 'CSR', 'Radiant Rare': 'K', 'Promo': 'PROMO', 'Black White Rare': 'BWR', 'Classic Collection': 'CLASSIC',
  'RGB Rare': 'RGB', 'Futuristic Rare': 'FUTURE'
};
const STAGE_JA = { Basic: 'たね', Stage1: '1進化', Stage2: '2進化', VMAX: 'VMAX', VSTAR: 'VSTAR', MEGA: 'メガ', Baby: 'ベイビィ', 'LEVEL-UP': 'レベルアップ', BREAK: 'BREAK' };
const CAT_JA = { Pokemon: 'ポケモン', Trainer: 'トレーナーズ', Energy: 'エネルギー' };
const TT_JA = { Supporter: 'サポート', Item: 'グッズ', Tool: 'ポケモンのどうぐ', Stadium: 'スタジアム' };
const AB_JA = { Ability: '特性', 'Poke-POWER': 'ポケパワー', 'Poke-BODY': 'ポケボディー', 'Pokemon Power': 'ポケパワー', 'Ancient Trait': '古代能力', 'VSTAR Power': 'VSTARパワー' };

let DB = null;              // index.json
let setById = new Map();    // lower(id) -> set
const detailCache = new Map();

/* ---------- utils ---------- */
const toHalf = (s) => (s || '').replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ').replace(/[／]/g, '/');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const numEq = (a, b) => {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  return na && nb ? parseInt(a, 10) === parseInt(b, 10) : String(a).toLowerCase() === String(b).toLowerCase();
};
const pad3 = (n) => (/^\d+$/.test(n) ? String(n).padStart(3, '0') : n);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode etc. */ } }
};

/* ---------- data ---------- */
async function loadDB() {
  const res = await fetch('data/index.json');
  DB = await res.json();
  for (const s of DB.sets) setById.set(s.id.toLowerCase(), s);
  const total = DB.sets.reduce((a, s) => a + s.c.length, 0);
  $('#meta').textContent = `${DB.sets.length}弾 / ${total.toLocaleString()}枚収録`;
  $('#setList').innerHTML = DB.sets.map((s) => `<option value="${esc(s.id.toLowerCase())}">${esc(s.n)}</option>`).join('');
}

async function loadDetail(setId) {
  if (detailCache.has(setId)) return detailCache.get(setId);
  const p = fetch(`data/sets/${encodeURIComponent(setId)}.json`).then((r) => r.json()).then((d) => {
    const m = new Map(); for (const c of d.cards) m.set(c.id, c); return m;
  });
  detailCache.set(setId, p);
  return p;
}

/* ---------- parsing ---------- */
// "sv3 066/108", "SV3 066 / 108 RR", "066/108", "001/SV-P", "sv3 66"
function parseFree(raw) {
  const s = toHalf(raw).trim().toLowerCase();
  let m = s.match(/^(?:([a-z][a-z0-9.\-]*?)\s+)?(\d{1,3})\s*\/\s*([a-z0-9.\-]+)/i);
  if (m) {
    let [, set, num, tot] = m;
    if (/[a-z]/.test(tot)) { set = set || tot; tot = ''; } // promo: 001/SV-P
    return { set: set || '', num, tot };
  }
  m = s.match(/^([a-z][a-z0-9.\-]*?)\s+(\d{1,3})$/i);
  if (m) return { set: m[1], num: m[2], tot: '' };
  return null;
}

/* ---------- search ---------- */
function search({ set, num, tot }) {
  set = toHalf(set).trim().toLowerCase();
  num = toHalf(num).trim().replace(/\D/g, '');
  tot = toHalf(tot).trim();
  if (!num) return { hits: [], msg: '' };

  // 総数欄に記号（例 SV-P）が入ったらプロモとして扱う
  if (/[a-z]/i.test(tot)) { if (!set) set = tot.toLowerCase(); tot = ''; }
  const totN = tot ? parseInt(tot, 10) : null;

  const find = (s) => {
    const c = s.c.find(([id]) => numEq(id, num));
    return c ? { set: s, id: c[0], name: c[1] } : null;
  };

  if (set) {
    const s = setById.get(set) || setById.get(set.replace(/\s+/g, ''));
    if (s) {
      const hit = find(s);
      if (hit) {
        let note = '';
        if (totN && s.o && totN !== s.o) note = `※ 総数は通常 ${s.o} です（入力 ${totN}）`;
        return { hits: [hit], msg: `<b>${esc(s.n)}</b> の ${pad3(num)} 番`, note };
      }
      return { hits: [], msg: `<span class="warn">${esc(s.n)}（${esc(s.id)}）に ${pad3(num)} 番のデータがありません</span>` };
    }
    // 記号が見つからない → 前方一致で候補を出しつつ番号/総数でも探す
    const pref = DB.sets.filter((x) => x.id.toLowerCase().startsWith(set));
    const hits = pref.map(find).filter(Boolean);
    if (hits.length) return { hits, msg: `「${esc(set)}」で始まる弾から ${hits.length}件` };
  }

  let pool;
  if (totN) {
    pool = DB.sets.filter((s) => s.o === totN);
    if (!pool.length) return { hits: [], msg: `<span class="warn">総数 ${totN} の弾が見つかりません。記号も入れてみてください</span>` };
  } else {
    pool = DB.sets;
  }
  const hits = pool.map(find).filter(Boolean);
  let msg;
  if (!hits.length) msg = `<span class="warn">該当なし</span>`;
  else if (hits.length === 1) msg = `総数 ${totN ?? '-'} の弾は1つだけ → <b>確定</b>`;
  else msg = `候補 <b>${hits.length}</b>件${set ? '' : '（エキスパンション記号を入れると1枚に絞れます）'}`;
  return { hits: hits.slice(0, 60), msg, more: hits.length > 60 ? hits.length - 60 : 0 };
}

/* ---------- render ---------- */
const imgUrl = (h) => `${IMG_BASE}/${h.set.s}/${h.set.id}/${h.id}/high.webp`;

function costHtml(co) {
  return `<span class="cost">${(co || []).map((t) => `<i class="e e-${esc(t)}" title="${esc(TYPE_JA[t] || t)}"></i>`).join('')}</span>`;
}

function detailHtml(c) {
  let h = '';
  for (const a of c.ab || []) {
    h += `<div class="row"><span class="lab">${esc(AB_JA[a.ty] || a.ty || '特性')}</span><span class="nm">${esc(a.n)}</span>${a.e ? `<div class="eff">${esc(a.e)}</div>` : ''}</div>`;
  }
  for (const a of c.at || []) {
    h += `<div class="row">${costHtml(a.co)}<span class="nm">${esc(a.n)}</span>${a.d != null ? `<span class="dmg">${esc(a.d)}</span>` : ''}${a.e ? `<div class="eff">${esc(a.e)}</div>` : ''}</div>`;
  }
  if (c.ef) h += `<div class="row"><div class="eff">${esc(c.ef)}</div></div>`;
  const sub = [];
  if (c.ev) sub.push(`${esc(c.ev)}から進化`);
  if (c.wk) sub.push('弱点 ' + c.wk.map((w) => `${TYPE_JA[w.type] || w.type}${w.value || ''}`).join(' '));
  if (c.rs) sub.push('抵抗力 ' + c.rs.map((w) => `${TYPE_JA[w.type] || w.type}${w.value || ''}`).join(' '));
  if (c.re != null && c.c === 'Pokemon') sub.push(`にげる ${c.re}`);
  if (c.il) sub.push(`Illus. ${esc(c.il)}`);
  if (sub.length) h += `<div class="sub">${sub.join(' ・ ')}</div>`;
  return h;
}

function badgesHtml(c) {
  const b = [];
  if (c.r && c.r !== 'None') b.push(`<span class="badge rar">${esc(RARITY_JA[c.r] || c.r)}</span>`);
  if (c.rm) b.push(`<span class="badge">レギュ ${esc(c.rm)}</span>`);
  if (c.c) b.push(`<span class="badge">${esc(c.tt ? TT_JA[c.tt] || c.tt : CAT_JA[c.c] || c.c)}</span>`);
  if (c.st) b.push(`<span class="badge">${esc(STAGE_JA[c.st] || c.st)}</span>`);
  if (c.t) b.push(`<span class="badge">${c.t.map((t) => `<i class="e e-${esc(t)}"></i> ${esc(TYPE_JA[t] || t)}`).join(' ')}</span>`);
  if (c.hp) b.push(`<span class="badge">HP ${esc(c.hp)}</span>`);
  return b.join('');
}

function cardEl(h, best) {
  const el = $('#tplCard').content.firstElementChild.cloneNode(true);
  if (best) el.classList.add('best');
  const tot = h.set.o ? String(h.set.o).padStart(3, '0') : '';
  el.querySelector('.card-code').textContent = `${h.set.id.toLowerCase()}  ${h.id}${tot ? '/' + tot : ''}`;
  el.querySelector('.card-name').textContent = h.name;
  el.querySelector('.card-set').textContent = `${h.set.n}（${h.set.d || '発売日不明'}）`;
  const img = el.querySelector('img'), wrap = el.querySelector('.card-img');
  img.alt = h.name;
  img.src = imgUrl(h);
  img.onerror = () => {
    if (!img.dataset.fb) { img.dataset.fb = 1; img.src = imgUrl(h).replace('high.webp', 'low.png'); return; }
    img.remove(); wrap.querySelector('.noimg').hidden = false;
  };
  img.onload = () => { wrap.classList.add('zoomable'); wrap.onclick = () => zoom(img.src.replace('low.png', 'high.webp')); };
  const q = encodeURIComponent(h.name);
  el.querySelector('.links').innerHTML =
    `<a href="https://www.pokemon-card.com/card-search/index.php?keyword=${q}" target="_blank" rel="noopener">公式カード検索</a>` +
    `<a href="https://www.google.com/search?q=${encodeURIComponent(h.name + ' ' + h.set.id + ' ' + h.id + ' 相場')}" target="_blank" rel="noopener">相場を検索</a>`;
  loadDetail(h.set.id).then((m) => {
    const c = m.get(h.id); if (!c) return;
    el.querySelector('.badges').innerHTML = badgesHtml(c);
    el.querySelector('.card-detail').innerHTML = detailHtml(c);
  }).catch(() => {});
  return el;
}

function miniEl(h) {
  const el = document.createElement('div');
  el.className = 'mini';
  el.innerHTML = `<span class="c">${esc(h.set.id.toLowerCase())} ${esc(h.id)}/${esc(String(h.set.o || '?').padStart(3, '0'))}</span><span class="n">${esc(h.name)}</span><span class="s">${esc(h.set.n)}</span>`;
  el.onclick = () => el.replaceWith(cardEl(h, false));
  return el;
}

function render(r) {
  elStatus.innerHTML = (r.msg || '') + (r.note ? `<br><span class="warn">${esc(r.note)}</span>` : '');
  elResults.innerHTML = '';
  const FULL = 3;
  r.hits.forEach((h, i) => elResults.appendChild(i < FULL ? cardEl(h, i === 0 && r.hits.length === 1) : miniEl(h)));
  if (r.more) elStatus.innerHTML += `（ほか${r.more}件は省略）`;
  if (r.hits.length === 1) pushHistory(r.hits[0]);
}

function zoom(src) {
  const z = document.createElement('div');
  z.className = 'zoom';
  z.innerHTML = `<img src="${esc(src)}" alt="">`;
  z.onclick = () => z.remove();
  document.body.appendChild(z);
}

/* ---------- history ---------- */
function pushHistory(h) {
  const list = store.get('pk_hist', []).filter((x) => !(x.set === h.set.id && x.id === h.id));
  list.unshift({ set: h.set.id, id: h.id, n: h.name });
  store.set('pk_hist', list.slice(0, 12));
  drawHistory();
}
function drawHistory() {
  const list = store.get('pk_hist', []);
  $('#historyWrap').hidden = !list.length;
  $('#history').innerHTML = '';
  for (const x of list) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `<i>${esc(x.set.toLowerCase())} ${esc(x.id)}</i>${esc(x.n)}`;
    b.onclick = () => { const s = setById.get(x.set.toLowerCase()); fill({ set: x.set.toLowerCase(), num: x.id, tot: s && s.o ? String(s.o).padStart(3, '0') : '' }); };
    $('#history').appendChild(b);
  }
}

/* ---------- input wiring ---------- */
let timer = 0;
function run() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!DB) return;
    if (!inNum.value.trim()) { elStatus.textContent = ''; elResults.innerHTML = ''; return; }
    render(search({ set: inSet.value, num: inNum.value, tot: inTot.value }));
  }, 120);
}
function fill(p) {
  inSet.value = p.set || ''; inNum.value = p.num || ''; inTot.value = p.tot || '';
  run();
}
// どの欄に貼り付けても "sv3 066/108" を分解
for (const el of [inSet, inNum, inTot]) {
  el.addEventListener('input', () => {
    const p = /[\s/／]/.test(el.value) ? parseFree(el.value) : null;
    if (p) { fill(p); (p.tot ? inTot : inNum).blur(); return; }
    run();
  });
}
// 番号3桁で自動的に総数へ
inNum.addEventListener('input', () => { if (/^\d{3}$/.test(inNum.value) && !inTot.value) inTot.focus(); });
inSet.addEventListener('keydown', (e) => { if (e.key === 'Enter') inNum.focus(); });
inNum.addEventListener('keydown', (e) => { if (e.key === 'Enter') inTot.focus(); });
inTot.addEventListener('keydown', (e) => { if (e.key === 'Enter') inTot.blur(); });
$('#btnClear').onclick = () => { fill({}); inSet.focus(); };

/* ---------- camera: real-time detection ---------- */
const cam = $('#cam'), video = $('#video'), camMsg = $('#camMsg'), camRead = $('#camRead');
const camBox = $('#camBox'), camHit = $('#camHit'), camLog = $('#camLog');
let stream = null, worker = null, live = false, paused = false, loopId = 0;
let lastHit = null;              // 直近に確定したカード
const votes = [];                // 直近フレームの読み取り結果（多数決用）
const VOTE_WINDOW = 4, VOTE_NEED = 2;

async function getWorker() {
  if (worker) return worker;
  camMsg.textContent = '文字認識エンジンを読み込み中…（初回のみ数MB）';
  if (!window.Tesseract) {
    await new Promise((ok, ng) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = ok; s.onerror = () => ng(new Error('OCRの読み込みに失敗（オフライン？）'));
      document.head.appendChild(s);
    });
  }
  worker = await Tesseract.createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-. ',
    tessedit_pageseg_mode: '7' // 1行として読む
  });
  return worker;
}

$('#btnCam').onclick = async () => {
  cam.hidden = false; cam.classList.remove('paused'); paused = false;
  $('#camPause').textContent = '⏸ 一時停止';
  camHit.hidden = true; camRead.textContent = ''; votes.length = 0; lastHit = null;
  camMsg.textContent = 'カメラを起動中…';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 }, focusMode: 'continuous' },
      audio: false
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    setupTorch();
    await getWorker();
    camMsg.textContent = '左下の番号を枠に合わせると自動で検知します';
    startLoop();
  } catch (e) {
    camMsg.textContent = (e && e.name === 'NotAllowedError') ? 'カメラの使用が許可されていません' : 'カメラを使えません: ' + (e.message || e);
  }
};

function closeCam() {
  live = false; loopId++;
  cam.hidden = true;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}
$('#camClose').onclick = closeCam;
$('#camPause').onclick = () => {
  paused = !paused;
  cam.classList.toggle('paused', paused);
  $('#camPause').textContent = paused ? '▶ 再開' : '⏸ 一時停止';
  camMsg.textContent = paused ? '一時停止中' : '左下の番号を枠に合わせると自動で検知します';
};
$('#camOpen').onclick = () => { if (lastHit) { closeCam(); showHit(lastHit); } };
camHit.querySelector('img').onclick = $('#camOpen').onclick;

// ライト（Android Chrome などトーチ対応端末のみ）
function setupTorch() {
  const btn = $('#camTorch'); btn.hidden = true; btn.classList.remove('on');
  const track = stream && stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  if (!caps.torch) return;
  btn.hidden = false;
  let on = false;
  btn.onclick = async () => {
    on = !on;
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); btn.classList.toggle('on', on); } catch { on = false; }
  };
}

// 画面上の枠 → 動画座標に変換して切り出し（object-fit: cover を考慮）
function grabBox() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const r = video.getBoundingClientRect(), b = camBox.getBoundingClientRect();
  const scale = Math.max(r.width / vw, r.height / vh);
  const ox = (r.width - vw * scale) / 2, oy = (r.height - vh * scale) / 2;
  const sx = (b.left - r.left - ox) / scale, sy = (b.top - r.top - oy) / scale;
  const sw = b.width / scale, sh = b.height / scale;
  const cv = $('#camCanvas'), up = Math.min(3, Math.max(1, 900 / sw)); // 速度優先で幅~900px
  cv.width = Math.round(sw * up); cv.height = Math.round(sh * up);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv;
}

// グレースケール + 大津の二値化（invert=true で暗い背景の白文字に対応）
function binarize(src, invert) {
  const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
  const ctx = cv.getContext('2d'); ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data, hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; d[i] = g; hist[g]++; }
  const n = d.length / 4; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; th = t; } }
  for (let i = 0; i < d.length; i += 4) { let v = d[i] > th ? 255 : 0; if (invert) v = 255 - v; d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// OCR文字列 → {set,num,tot}。数字部分の o/O→0, l/I/|→1 など誤認識を補正
function parseOcr(text) {
  let t = toHalf(text).toLowerCase().replace(/[\\]/g, '/').replace(/\s*\/\s*/g, '/');
  const fixDigits = (s) => s.replace(/[oq]/g, '0').replace(/[il|]/g, '1').replace(/z/g, '2').replace(/s/g, '5').replace(/b/g, '8');
  // "066/108" 部分を探す（誤認識補正しながら）
  let m = t.match(/([0-9oqilzsb|]{2,3})\/([0-9oqilzsb|]{2,3}|[a-z]{1,3}-?p)(?![0-9])/);
  if (!m) return null;
  const num = fixDigits(m[1]);
  let tot = /p$/.test(m[2]) ? m[2] : fixDigits(m[2]);
  if (!/^\d+$/.test(num)) return null;
  const before = t.slice(0, m.index).trim();
  let set = '';
  const sm = before.match(/([a-z]{1,3}[0-9oilz]{0,2}[a-z]?(?:-p)?)\s*$/);
  if (sm) {
    const cand = sm[1];
    // "sv3" "svo" → 数字補正版も試す
    for (const c of [cand, cand.replace(/^([a-z]+)([0-9oilz]+)/, (_, a, b) => a + fixDigits(b))]) {
      if (setById.has(c)) { set = c; break; }
    }
  }
  return { set, num, tot };
}

// 読み取り結果を実在カードに照合（1枚に絞れたときだけ採用）
function resolve(p) {
  if (!p) return null;
  const r = search(p);
  return r.hits.length === 1 ? r.hits[0] : null;
}

function startLoop() {
  if (live) return;
  live = true;
  const my = ++loopId;
  let frame = 0;
  (async function tick() {
    while (live && my === loopId) {
      if (paused || !video.videoWidth || document.hidden) { await sleep(250); continue; }
      const t0 = performance.now();
      try {
        const raw = grabBox();
        // 通常/反転を交互に試す（カード下部の地色によって読みやすさが変わる）
        const { data } = await worker.recognize(binarize(raw, frame++ % 2 === 1));
        if (!live || my !== loopId) break;
        const txt = data.text.replace(/\s+/g, ' ').trim();
        camRead.textContent = txt ? `認識: ${txt.slice(0, 32)}` : '';
        const hit = resolve(parseOcr(data.text));
        vote(hit);
      } catch (e) {
        camRead.textContent = 'エラー: ' + (e.message || e);
        await sleep(500);
      }
      // 端末負荷を抑える（最低 ~150ms 間隔）
      const dt = performance.now() - t0;
      if (dt < 150) await sleep(150 - dt);
    }
  })();
}

const keyOf = (h) => h ? `${h.set.id}#${h.id}` : '';
function vote(hit) {
  votes.push(keyOf(hit) ? hit : null);
  if (votes.length > VOTE_WINDOW) votes.shift();
  const counts = new Map();
  for (const v of votes) if (v) counts.set(keyOf(v), (counts.get(keyOf(v)) || 0) + 1);
  let bestK = '', bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { bestK = k; bestN = n; }
  if (bestN >= VOTE_NEED && bestK !== keyOf(lastHit)) {
    confirmHit(votes.find((v) => v && keyOf(v) === bestK));
  }
  camBox.classList.toggle('locked', !!hit && keyOf(hit) === keyOf(lastHit));
}

function confirmHit(h) {
  lastHit = h;
  camBox.classList.add('locked');
  if (navigator.vibrate) navigator.vibrate(60);
  const tot = h.set.o ? String(h.set.o).padStart(3, '0') : '';
  camHit.hidden = false;
  camHit.style.animation = 'none'; void camHit.offsetWidth; camHit.style.animation = '';
  camHit.querySelector('.hc').textContent = `${h.set.id.toLowerCase()} ${h.id}${tot ? '/' + tot : ''}`;
  camHit.querySelector('.hn').textContent = h.name;
  camHit.querySelector('.hs').textContent = h.set.n;
  const img = camHit.querySelector('img');
  img.style.visibility = 'visible';
  img.onerror = () => { img.style.visibility = 'hidden'; };
  img.src = imgUrl(h).replace('high.webp', 'low.webp');
  camMsg.textContent = '検知しました — 次のカードもそのまま読めます';
  pushHistory(h);
  // カメラ内のスキャン履歴（連続スキャン用）
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.innerHTML = `<i>${esc(h.set.id.toLowerCase())} ${esc(h.id)}</i>${esc(h.name)}`;
  chip.onclick = () => { closeCam(); showHit(h); };
  camLog.prepend(chip);
  while (camLog.children.length > 20) camLog.lastChild.remove();
}

// 検知したカードをメイン画面に表示
function showHit(h) {
  const tot = h.set.o ? String(h.set.o).padStart(3, '0') : '';
  fill({ set: h.set.id.toLowerCase(), num: h.id, tot });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- boot ---------- */
loadDB().then(() => {
  drawHistory();
  const p = parseFree(decodeURIComponent(location.hash.slice(1)));
  if (p) fill(p);
}).catch(() => { $('#meta').textContent = 'データ読込失敗'; });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
