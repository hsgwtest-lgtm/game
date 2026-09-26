/* =====================================================================
   SoftEvo 8 — brainview.js
   脳の可視化
   ・活動: 信号の流れ (w × 活性) を色と光る粒で
   ・重み: 学習した結合そのもの
   ・変異: 親からどのシナプスが変わったか
   ・ニューロンをタップ → 体のどこに対応するかを強調、手術 (ノックアウト)
   ===================================================================== */
import { weightIndex, biasIndex, rhythmHz } from './sim.js';
import { fitCanvas, clamp, signedColor, muscleHue, POS, NEG } from './ui.js';

const GROUP_COLOR = { stretch: '#ff8fb1', touch: '#ffd166', body: '#7fdcff', clock: '#8dffb0', foe: '#ff5b6e' };
const GROUP_NAME = { stretch: '筋の伸び', touch: '接地', body: '姿勢/速度', clock: 'リズム', foe: '対戦感覚' };
const FOE_DESC = {
  '相手 前後': '相手が自分の前 (+) にいるか後ろ (−) にいるか、どれだけ離れているか。',
  '相手 上下': '相手の重心が自分より高い (+) か低い (−) か。下からすくうか、上からのしかかるか。',
  '相手の勢い': '相手がこちらへ迫ってくる (−) か、離れていく (+) か。',
  '相手に接触': '相手の体に触れていると 1。組み合った瞬間を知る感覚です。',
  '土俵の位置': '自分が土俵のどこにいるか。+1 に近いほど前の土俵際、−1 に近いほど背中側の土俵際 (危ない)。',
  '綱の張り': '綱がどれだけ強く引っぱられているか。0 ならたるんでいる。',
  '綱の位置': '綱の中心 (赤い印) が自分の側に来ている (+) か相手側 (−) か。±1 で決着。',
};

export class BrainView {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.mode = 'activity';
    this.sel = null;
    this.hover = null;
    this.layout = null;
    this.genome = null; this.parent = null;
    this.pos = null; this.lastSize = '';
    canvas.addEventListener('pointerup', e => {
      const hit = this.hit(e);
      this.sel = hit && this.sel && hit.l === this.sel.l && hit.i === this.sel.i ? null : hit;
      this.hooks.onSelect && this.hooks.onSelect(this.sel);
    });
    canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') this.hover = this.hit(e); });
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
  }

  setRun(layout) { this.layout = layout; this.sel = null; this.lastSize = ''; }
  setGenomes(g, parent) { this.genome = g; this.parent = parent; this.diffStats = null; }

  select(l, i) { this.sel = l == null ? null : { l, i }; this.hooks.onSelect && this.hooks.onSelect(this.sel); }

  computeLayout(w, h) {
    const key = `${w}x${h}`;
    if (key === this.lastSize && this.pos) return;
    this.lastSize = key;
    const { sizes, inputs } = this.layout;
    const L = sizes.length;
    const LW = w < 380 ? 70 : 92, RW = w < 380 ? 40 : 52, top = 24, bot = 8;
    this.LW = LW; this.RW = RW; this.top = top;
    const xs = sizes.map((_, l) => LW + 10 + (w - LW - RW - 20) * l / (L - 1));
    this.pos = [];
    // 入力: グループ間にすき間
    const groups = [];
    inputs.forEach((inp, i) => { if (!groups.length || groups[groups.length - 1].g !== inp.group) groups.push({ g: inp.group, start: i, n: 0 }); groups[groups.length - 1].n++; });
    const slots = sizes[0] + (groups.length - 1) * 0.9;
    const sp = (h - top - bot) / slots;
    this.inSp = sp;
    this.r0 = clamp(sp * 0.36, 2.2, 8);
    const p0 = []; let y = top + sp / 2;
    groups.forEach((gr, gi) => { if (gi) y += sp * 0.9; for (let k = 0; k < gr.n; k++) { p0.push({ x: xs[0], y }); y += sp; } });
    this.groups = groups;
    this.pos.push(p0);
    for (let l = 1; l < L; l++) {
      const n = sizes[l];
      const s = Math.min((h - top - bot) / n, 34);
      const y0 = top + (h - top - bot - s * n) / 2 + s / 2;
      this.pos.push(Array.from({ length: n }, (_, i) => ({ x: xs[l], y: y0 + i * s })));
      this['r' + l] = clamp(s * 0.34, 3, 10);
    }
  }

  radius(l) { return this['r' + l] || this.r0; }

  hit(e) {
    if (!this.pos) return null;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 18;
    this.pos.forEach((layer, l) => layer.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = { l, i }; } }));
    // ラベル部分のタップでも選択
    if (!best && x < this.LW) {
      this.pos[0].forEach((p, i) => { const d = Math.abs(p.y - y); if (d < Math.max(6, this.inSp / 2) && d < bd) { bd = d; best = { l: 0, i }; } });
    }
    return best;
  }

  /** ニューロンの説明 */
  describe(n, acts) {
    const { sizes, inputs, outputs } = this.layout, g = this.genome, L = sizes.length;
    const v = acts ? acts[n.l][n.i] : 0;
    if (n.l === 0) {
      const inp = inputs[n.i];
      const desc = {
        stretch: 'この筋肉がどれだけ伸びている(+)/縮んでいる(−)か。体の「固有感覚」です。',
        touch: 'この点が地面に触れていると 1。足裏の感覚です。',
        body: '体全体の傾きや速さ。バランス感覚です。',
        clock: `脳内の振り子。周期は遺伝子で決まり、この個体は ${rhythmHz(g).toFixed(2)} Hz。歩くリズムの源になりやすい入力です。`,
        foe: `${FOE_DESC[inp.label] || ''} 対戦の特訓で追加された感覚で、最初は配線ゼロ。進化が「使い道」を見つけると結合が育ちます。`,
      }[inp.group];
      return { title: `感覚: ${inp.label}`, group: inp.group, value: v, desc, links: this.topLinks(n) };
    }
    if (n.l === L - 1) {
      const o = outputs[n.i];
      return { title: `運動: ${o.label}`, value: v, color: `hsl(${muscleHue(n.i)},80%,62%)`, desc: `この値で筋肉${n.i + 1}の長さが決まります。＋で伸び、−で縮む。`, links: this.topLinks(n) };
    }
    return { title: `隠れ層${n.l} ニューロン #${n.i + 1}`, value: v, desc: `バイアス ${g[biasIndex(sizes, n.l, n.i)].toFixed(2)}。感覚を組み合わせて「特徴」を作る中間ニューロンです。`, links: this.topLinks(n) };
  }

  topLinks(n) {
    const { sizes, inputs, outputs } = this.layout, g = this.genome, L = sizes.length;
    const name = (l, i) => l === 0 ? inputs[i].label : l === L - 1 ? outputs[i].label : `隠れ${l}-#${i + 1}`;
    const res = { in: [], out: [] };
    if (n.l > 0) {
      const arr = [];
      for (let i = 0; i < sizes[n.l - 1]; i++) arr.push({ name: name(n.l - 1, i), w: g[weightIndex(sizes, n.l, n.i, i)] });
      res.in = arr.sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 3);
    }
    if (n.l < L - 1) {
      const arr = [];
      for (let j = 0; j < sizes[n.l + 1]; j++) arr.push({ name: name(n.l + 1, j), w: g[weightIndex(sizes, n.l + 1, j, n.i)] });
      res.out = arr.sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 3);
    }
    return res;
  }

  /** 選択ニューロンに対応する体の部位 */
  bodyTargets(n) {
    const res = { nodes: [], edges: [] };
    if (!n) return res;
    const { sizes, inputs, outputs } = this.layout, L = sizes.length;
    const mark = (l, i) => {
      if (l === 0) { const p = inputs[i]; if (p.kind === 'node') res.nodes.push(p.idx); else if (p.kind === 'muscle') res.edges.push(p.edge); }
      else if (l === L - 1) res.edges.push(outputs[i].edge);
    };
    mark(n.l, n.i);
    if (n.l > 0 && n.l < L - 1) {
      // 隠れニューロン: 最も強く影響する筋肉
      for (const o of this.topLinks(n).out.slice(0, 2)) { const j = outputs.findIndex(q => q.label === o.name); if (j >= 0) res.edges.push(outputs[j].edge); }
    }
    return res;
  }

  mutationStats() {
    if (this.diffStats) return this.diffStats;
    const g = this.genome, p = this.parent;
    if (!p || p.length !== g.length) return (this.diffStats = null);
    let n = 0, sum = 0;
    for (let i = 0; i < g.length; i++) { const d = Math.abs(g[i] - p[i]); if (d > 1e-6) { n++; sum += d; } }
    return (this.diffStats = { n, mean: n ? sum / n : 0, total: g.length });
  }

  render(acts, knock, time) {
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.fillStyle = '#080d1a'; ctx.fillRect(0, 0, w, h);
    if (!this.layout || !this.genome) return;
    this.computeLayout(w, h);
    const { sizes, inputs, outputs } = this.layout, g = this.genome, L = sizes.length, pos = this.pos;
    const focus = this.sel || this.hover;
    const mode = this.mode;
    const par = mode === 'mutation' ? this.parent : null;

    // 見出し
    ctx.font = '600 10px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(180,200,240,0.6)';
    for (let l = 0; l < L; l++) ctx.fillText(l === 0 ? '感覚' : l === L - 1 ? '筋肉' : `隠れ層${L > 3 ? l : ''}`, pos[l][0].x, 13);

    // 最大重み
    let maxW = 0.001;
    for (let i = 0; i < g.length - 1; i++) maxW = Math.max(maxW, Math.abs(g[i]));

    // ── 結合 ──
    ctx.lineCap = 'round';
    const pulses = [];
    for (let l = 1; l < L; l++) {
      const nIn = sizes[l - 1], nOut = sizes[l];
      const A = acts ? acts[l - 1] : null;
      for (let j = 0; j < nOut; j++) {
        const pj = pos[l][j];
        for (let i = 0; i < nIn; i++) {
          const wi = weightIndex(sizes, l, j, i), wv = g[wi];
          const linked = focus && ((focus.l === l && focus.i === j) || (focus.l === l - 1 && focus.i === i));
          let alpha, col, lw;
          if (mode === 'mutation') {
            const d = par ? g[wi] - par[wi] : 0;
            if (Math.abs(d) > 1e-6) { alpha = 0.95; col = d > 0 ? '#ff5fd2' : '#b47bff'; lw = 0.8 + Math.min(3, Math.abs(d) * 5); }
            else { alpha = 0.05; col = '#8aa0c8'; lw = 0.6; }
          } else if (mode === 'weights') {
            alpha = Math.pow(Math.abs(wv) / maxW, 1.3) * 0.9; col = wv >= 0 ? POS : NEG; lw = 0.4 + Math.abs(wv) / maxW * 2.6;
          } else {
            const s = A ? wv * A[i] : 0;
            alpha = Math.min(0.85, Math.abs(s) * 0.55); col = s >= 0 ? POS : NEG; lw = 0.35 + Math.min(2.6, Math.abs(wv) * 0.9);
            if (Math.abs(s) > 0.55 && (!focus || linked)) pulses.push([pos[l - 1][i], pj, s, wi]);
          }
          if (focus) alpha = linked ? Math.max(alpha, mode === 'mutation' ? alpha : 0.35) : alpha * 0.12;
          if (alpha < 0.02) continue;
          ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = lw;
          ctx.beginPath(); ctx.moveTo(pos[l - 1][i].x, pos[l - 1][i].y); ctx.lineTo(pj.x, pj.y); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    // 信号の粒
    if (mode === 'activity') {
      for (const [a, b, s, k] of pulses) {
        const t = (time * (0.8 + Math.min(1.5, Math.abs(s) * 0.5)) + (k * 0.618) % 1) % 1;
        ctx.fillStyle = s >= 0 ? '#ffe2b0' : '#bff0ff';
        ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 1.6, 0, 7); ctx.fill();
      }
    }

    // ── ニューロン ──
    for (let l = 0; l < L; l++) {
      const r = this.radius(l);
      for (let i = 0; i < sizes[l]; i++) {
        const p = pos[l][i], v = acts ? acts[l][i] : 0;
        const knocked = knock && knock[l][i];
        const isSel = focus && focus.l === l && focus.i === i;
        if (!knocked && Math.abs(v) > 0.4 && mode === 'activity') {
          ctx.fillStyle = signedColor(v, 0.22 * Math.abs(v));
          ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.1, 0, 7); ctx.fill();
        }
        ctx.fillStyle = knocked ? '#2a2f3c' : mode === 'activity' ? signedColor(v) : '#1b2438';
        let stroke = l === 0 ? GROUP_COLOR[inputs[i].group] : l === L - 1 ? `hsl(${muscleHue(i)},75%,62%)` : '#9fb3dc';
        if (mode === 'mutation' && par && l > 0) { const bi = biasIndex(sizes, l, i); if (Math.abs(g[bi] - par[bi]) > 1e-6) stroke = '#ff5fd2'; }
        ctx.strokeStyle = knocked ? '#5a6275' : stroke;
        ctx.lineWidth = isSel ? 3 : 1.3;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); ctx.stroke();
        if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, 7); ctx.stroke(); }
        if (knocked) {
          ctx.strokeStyle = '#ff5b6e'; ctx.lineWidth = 2;
          const k = r * 0.8;
          ctx.beginPath(); ctx.moveTo(p.x - k, p.y - k); ctx.lineTo(p.x + k, p.y + k); ctx.moveTo(p.x + k, p.y - k); ctx.lineTo(p.x - k, p.y + k); ctx.stroke();
        }
      }
    }

    // ── ラベル ──
    const fs = clamp(this.inSp * 0.78, 6.5, 11);
    ctx.textBaseline = 'middle';
    if (fs >= 7) {
      ctx.font = `${fs}px system-ui`; ctx.textAlign = 'right';
      inputs.forEach((inp, i) => {
        const p = pos[0][i];
        const isF = focus && focus.l === 0 && focus.i === i;
        ctx.fillStyle = isF ? '#fff' : GROUP_COLOR[inp.group];
        ctx.globalAlpha = isF ? 1 : 0.75;
        ctx.fillText(inp.label, p.x - this.r0 - 5, p.y);
      });
      ctx.globalAlpha = 1;
    } else {
      // 小さすぎる時はグループ名だけ
      ctx.font = '600 9px system-ui'; ctx.textAlign = 'right';
      for (const gr of this.groups) {
        const a = pos[0][gr.start], b = pos[0][gr.start + gr.n - 1];
        ctx.fillStyle = GROUP_COLOR[gr.g]; ctx.fillText(GROUP_NAME[gr.g], a.x - this.r0 - 5, (a.y + b.y) / 2);
      }
    }
    ctx.font = '600 10px system-ui'; ctx.textAlign = 'left';
    outputs.forEach((o, j) => {
      const p = pos[L - 1][j], r = this.radius(L - 1);
      ctx.fillStyle = `hsl(${muscleHue(j)},75%,62%)`;
      ctx.fillRect(p.x + r + 4, p.y - 1.5, 8, 3);
      ctx.fillText(o.label, p.x + r + 15, p.y);
    });
    ctx.textBaseline = 'alphabetic';
  }
}
