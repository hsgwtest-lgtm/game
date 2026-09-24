/* =====================================================================
   SoftEvo 8 — builder.js
   生物エディタ: タップ & ドラッグだけで体をつくる
   ・ノード: 空いた所をタップ / ノードをドラッグで移動
   ・骨/筋肉: ノードからノードへドラッグ (空白で離すと新ノード付きで伸びる)
   ・辺をタップ → 今の種類に変換、消しゴムで削除
   ・左右対称モード、元に戻す/やり直し、試運転 (ランダムな脳でゆらす)
   ===================================================================== */
import { NODE_R, Creature, brainLayout, randomGenome, makeRng, cloneBlueprint, validateBlueprint } from './sim.js';
import { Camera, drawCreature, staticBody } from './world.js';
import { fitCanvas, clamp } from './ui.js';

const SNAP = 5;
const MAX_NODES = 24, MAX_EDGES = 64;

export class Builder {
  constructor(canvas, { onChange, onHint }) {
    this.canvas = canvas;
    this.onChange = onChange || (() => {});
    this.onHint = onHint || (() => {});
    this.bp = { nodes: [], edges: [] };
    this.tool = 'node';
    this.mirror = true;
    this.undoStack = []; this.redoStack = [];
    this.cam = new Camera();
    this.cam.zoom = 2.2; this.cam.y = 50;
    this.ptr = new Map();
    this.drag = null;
    this.pending = -1;
    this.hover = { x: 0, y: 0, on: false };
    this.preview = null;
    this.settings = null;
    this.bind();
  }

  // ─── データ操作 ───
  snapshot() { this.undoStack.push(JSON.stringify(this.bp)); if (this.undoStack.length > 80) this.undoStack.shift(); this.redoStack.length = 0; }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(JSON.stringify(this.bp)); this.bp = JSON.parse(this.undoStack.pop()); this.changed(); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(JSON.stringify(this.bp)); this.bp = JSON.parse(this.redoStack.pop()); this.changed(); }
  load(bp, keepUndo = false) { if (keepUndo) this.snapshot(); this.bp = cloneBlueprint(bp); this.pending = -1; this.stopPreview(); this.fit(); this.changed(); }
  clear() { this.snapshot(); this.bp = { nodes: [], edges: [] }; this.pending = -1; this.changed(); }
  changed() { this.stopPreview(); this.onChange(this.bp); }

  mirrorOf(i) {
    const p = this.bp.nodes[i];
    if (Math.abs(p.x) < 1) return i;
    return this.bp.nodes.findIndex(q => Math.abs(q.x + p.x) < 1.5 && Math.abs(q.y - p.y) < 1.5);
  }

  addNode(x, y, withMirror = true) {
    if (this.bp.nodes.length >= MAX_NODES) { this.onHint(`ノードは最大${MAX_NODES}個までです`, true); return -1; }
    x = Math.round(x / SNAP) * SNAP; y = Math.max(0, Math.round(y / SNAP) * SNAP);
    const near = this.bp.nodes.findIndex(q => Math.hypot(q.x - x, q.y - y) < NODE_R * 1.6);
    if (near >= 0) return near;
    this.bp.nodes.push({ x, y });
    const idx = this.bp.nodes.length - 1;
    if (this.mirror && withMirror && Math.abs(x) >= SNAP && this.bp.nodes.length < MAX_NODES) {
      if (!this.bp.nodes.some(q => Math.abs(q.x + x) < 1.5 && Math.abs(q.y - y) < 1.5)) this.bp.nodes.push({ x: -x, y });
    }
    return idx;
  }

  edgeIndex(a, b) { return this.bp.edges.findIndex(e => (e.a === a && e.b === b) || (e.a === b && e.b === a)); }

  setEdge(a, b, type, withMirror = true) {
    if (a === b || a < 0 || b < 0) return;
    const k = this.edgeIndex(a, b);
    if (k >= 0) this.bp.edges[k].type = type;
    else if (this.bp.edges.length < MAX_EDGES) this.bp.edges.push({ a, b, type });
    else { this.onHint(`接続は最大${MAX_EDGES}本までです`, true); return; }
    if (this.mirror && withMirror) {
      const ma = this.mirrorOf(a), mb = this.mirrorOf(b);
      if (ma >= 0 && mb >= 0 && !(ma === a && mb === b) && !(ma === b && mb === a)) this.setEdge(ma, mb, type, false);
    }
  }

  removeNode(i, withMirror = true) {
    const m = this.mirror && withMirror ? this.mirrorOf(i) : -1;
    const kill = new Set([i]); if (m >= 0) kill.add(m);
    const remap = []; let k = 0;
    this.bp.nodes = this.bp.nodes.filter((_, j) => { if (kill.has(j)) { remap[j] = -1; return false; } remap[j] = k++; return true; });
    this.bp.edges = this.bp.edges.filter(e => remap[e.a] >= 0 && remap[e.b] >= 0).map(e => ({ ...e, a: remap[e.a], b: remap[e.b] }));
  }

  removeEdge(k, withMirror = true) {
    const e = this.bp.edges[k];
    this.bp.edges.splice(k, 1);
    if (this.mirror && withMirror) {
      const mk = this.edgeIndex(this.mirrorOf(e.a), this.mirrorOf(e.b));
      if (mk >= 0) this.bp.edges.splice(mk, 1);
    }
  }

  // ─── ヒットテスト ───
  view() { const r = this.canvas.getBoundingClientRect(); return { w: r.width, h: r.height, r }; }
  toWorld(ev) { const { w, h, r } = this.view(); return { x: this.cam.wx(ev.clientX - r.left, w), y: this.cam.wy(ev.clientY - r.top, h) }; }
  hitNode(p) {
    const R = Math.max(NODE_R + 3, 16 / this.cam.zoom);
    let best = -1, bd = R;
    this.bp.nodes.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  hitEdge(p) {
    const R = 10 / this.cam.zoom + 2;
    let best = -1, bd = R;
    this.bp.edges.forEach((e, k) => {
      const A = this.bp.nodes[e.a], B = this.bp.nodes[e.b];
      const dx = B.x - A.x, dy = B.y - A.y, L = dx * dx + dy * dy || 1;
      const t = clamp(((p.x - A.x) * dx + (p.y - A.y) * dy) / L, 0, 1);
      const d = Math.hypot(A.x + dx * t - p.x, A.y + dy * t - p.y);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }

  // ─── 入力 ───
  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => { this.ptr.delete(e.pointerId); this.drag = null; });
    c.addEventListener('pointerleave', () => { this.hover.on = false; });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const { w, h, r } = this.view();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const bx = this.cam.wx(sx, w), by = this.cam.wy(sy, h);
      this.cam.zoom = clamp(this.cam.zoom * Math.exp(-e.deltaY * 0.0015), 0.5, 8);
      this.cam.x += bx - this.cam.wx(sx, w); this.cam.y += by - this.cam.wy(sy, h);
    }, { passive: false });
  }

  down(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptr.size === 2) { this.drag = { kind: 'pinch', ...this.pinchState() }; return; }
    if (this.preview) this.stopPreview();
    const p = this.toWorld(e);
    const ni = this.hitNode(p);
    const sx = e.clientX, sy = e.clientY;
    if (this.tool === 'erase') {
      if (ni >= 0) { this.snapshot(); this.removeNode(ni); this.pending = -1; this.changed(); return; }
      const ek = this.hitEdge(p);
      if (ek >= 0) { this.snapshot(); this.removeEdge(ek); this.changed(); return; }
      this.drag = { kind: 'pan', sx, sy, cx: this.cam.x, cy: this.cam.y, moved: false };
      return;
    }
    if (ni >= 0) {
      if (this.tool === 'node') this.drag = { kind: 'node', i: ni, sx, sy, moved: false, snap: false };
      else this.drag = { kind: 'link', from: ni, to: p, sx, sy, moved: false };
      return;
    }
    const ek = this.hitEdge(p);
    if (ek >= 0 && this.tool !== 'node') {
      this.drag = { kind: 'edge', k: ek, sx, sy, moved: false };
      return;
    }
    this.drag = { kind: 'empty', p, sx, sy, cx: this.cam.x, cy: this.cam.y, moved: false };
  }

  pinchState() {
    const [a, b] = [...this.ptr.values()];
    return { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: this.cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: this.cam.x, cy: this.cam.y };
  }

  move(e) {
    const p = this.toWorld(e);
    this.hover = { ...p, on: true };
    if (!this.ptr.has(e.pointerId)) return;
    this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = this.drag; if (!d) return;
    if (d.kind === 'pinch' && this.ptr.size === 2) {
      const [a, b] = [...this.ptr.values()];
      this.cam.zoom = clamp(d.z0 * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(10, d.d0), 0.5, 8);
      this.cam.x = d.cx - ((a.x + b.x) / 2 - d.mx) / this.cam.zoom;
      this.cam.y = d.cy + ((a.y + b.y) / 2 - d.my) / this.cam.zoom;
      return;
    }
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) {
      if (!d.moved && d.kind === 'node') this.snapshot();
      d.moved = true;
    }
    if (!d.moved) return;
    if (d.kind === 'node') {
      const q = this.bp.nodes[d.i];
      const m = this.mirror ? this.mirrorOf(d.i) : -1;
      q.x = Math.round(p.x / SNAP) * SNAP; q.y = Math.max(0, Math.round(p.y / SNAP) * SNAP);
      if (m >= 0 && m !== d.i) { this.bp.nodes[m].x = -q.x; this.bp.nodes[m].y = q.y; }
    } else if (d.kind === 'link') d.to = p;
    else if (d.kind === 'pan' || d.kind === 'empty') {
      this.cam.x = d.cx - (e.clientX - d.sx) / this.cam.zoom;
      this.cam.y = d.cy + (e.clientY - d.sy) / this.cam.zoom;
    }
  }

  up(e) {
    this.ptr.delete(e.pointerId);
    const d = this.drag; this.drag = null;
    if (!d || d.kind === 'pinch') { if (this.ptr.size === 1) this.drag = null; return; }
    const p = this.toWorld(e);
    const type = this.tool === 'muscle' ? 'muscle' : 'bone';
    if (d.kind === 'node') {
      if (d.moved) this.changed();
      return;
    }
    if (d.kind === 'link') {
      if (!d.moved) {
        // タップ-タップ接続
        if (this.pending >= 0 && this.pending !== d.from) {
          this.snapshot(); this.setEdge(this.pending, d.from, type); this.pending = -1; this.changed();
        } else this.pending = this.pending === d.from ? -1 : d.from;
        return;
      }
      const to = this.hitNode(p);
      this.snapshot();
      if (to >= 0) this.setEdge(d.from, to, type);
      else {
        const before = this.bp.nodes.length;
        const ni = this.addNode(p.x, p.y);
        if (ni >= 0) {
          this.setEdge(d.from, ni, type);
          if (this.bp.nodes.length === before) { /* 既存ノード */ }
        }
      }
      this.pending = -1;
      this.changed();
      return;
    }
    if (d.kind === 'edge') {
      if (!d.moved) { this.snapshot(); const eg = this.bp.edges[d.k]; this.setEdge(eg.a, eg.b, type); this.changed(); }
      return;
    }
    if (d.kind === 'empty' && !d.moved) {
      if (this.tool === 'node') { this.snapshot(); this.addNode(p.x, p.y); this.changed(); }
      else if (this.pending >= 0) {
        this.snapshot(); const ni = this.addNode(p.x, p.y);
        if (ni >= 0) this.setEdge(this.pending, ni, type);
        this.pending = ni; this.changed();
      } else this.onHint(this.tool === 'muscle' ? 'ノードからノードへドラッグして筋肉をつなぐ' : 'ノードからノードへドラッグして骨をつなぐ');
    }
  }

  // ─── カメラ ───
  fit() {
    const { w, h } = this.view();
    const ns = this.bp.nodes;
    if (!ns.length) { this.cam.x = 0; this.cam.y = 45; this.cam.zoom = clamp(Math.min(w, h) / 180, 1, 4); return; }
    let x0 = Infinity, x1 = -Infinity, y1 = 0;
    for (const p of ns) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    this.cam.zoom = clamp(Math.min((w - 60) / (x1 - x0 + 120), (h - 80) / (y1 + 100)), 0.6, 5);
    this.cam.x = (x0 + x1) / 2; this.cam.y = y1 / 2 + 10;
  }

  // ─── 試運転 ───
  startPreview(settings) {
    const err = validateBlueprint(this.bp);
    if (err) { this.onHint(err, true); return false; }
    const layout = brainLayout(this.bp, settings);
    const rng = makeRng(((Math.random() * 1e9) | 0) + 7);
    const g = randomGenome(layout.sizes, rng);
    g[g.length - 1] = 1.2;
    this.preview = new Creature(this.bp, layout, g, { terrain: 'flat', gravity: settings.gravity, friction: settings.friction });
    this.previewCam = { x: this.cam.x, y: this.cam.y };
    return true;
  }
  stopPreview() { if (this.preview) { this.preview = null; } }

  // ─── 描画 ───
  render() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.fillStyle = '#0a1020'; ctx.fillRect(0, 0, w, h);
    const cam = this.cam, Z = cam.zoom;
    // グリッド
    const x0 = cam.wx(0, w), x1 = cam.wx(w, w), yTop = cam.wy(0, h), yBot = cam.wy(h, h);
    for (const [stepCm, col] of [[10, 'rgba(120,150,220,0.07)'], [50, 'rgba(120,150,220,0.16)']]) {
      if (stepCm * Z < 6) continue;
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath();
      for (let gx = Math.ceil(x0 / stepCm) * stepCm; gx <= x1; gx += stepCm) { const sx = Math.round(cam.sx(gx, w)) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, h); }
      for (let gy = Math.ceil(yBot / stepCm) * stepCm; gy <= yTop; gy += stepCm) { const sy = Math.round(cam.sy(gy, h)) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(w, sy); }
      ctx.stroke();
    }
    // 地面
    const gy = cam.sy(0, h);
    ctx.fillStyle = '#0f2623'; ctx.fillRect(0, gy, w, h - gy);
    ctx.strokeStyle = '#3de0b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    // 対称軸
    if (this.mirror && !this.preview) {
      const ax = cam.sx(0, w);
      ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,209,102,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(ax, 0); ctx.lineTo(ax, gy); ctx.stroke(); ctx.setLineDash([]);
    }
    // 目盛
    ctx.fillStyle = 'rgba(200,220,255,0.45)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    for (let gx = Math.ceil(x0 / 50) * 50; gx <= x1; gx += 50) ctx.fillText(`${gx}cm`, cam.sx(gx, w), gy + 16);

    if (this.preview) {
      const pv = this.preview;
      for (let k = 0; k < 1; k++) pv.step();
      const [cx] = pv.centroid();
      ctx.save();
      ctx.translate(w / 2 - (this.previewCam.x) * Z, h / 2 + this.previewCam.y * Z);
      ctx.scale(Z, -Z);
      ctx.translate(-cx + this.previewCam.x, 0);
      // 試運転は常に地面 y=0 を基準に描く
      drawCreature(ctx, pv, {});
      ctx.restore();
      ctx.fillStyle = '#ffd166'; ctx.textAlign = 'left'; ctx.font = '600 12px system-ui';
      ctx.fillText('試運転中 — ランダムな脳で動かしています (タップで終了)', 12, 66);
      return;
    }

    ctx.save(); cam.apply(ctx, w, h);
    const b = staticBody(this.bp);
    b.rx = b.x; b.ry = b.y;
    drawCreature(ctx, b, { selNode: this.pending });
    // リンク中の線
    const d = this.drag;
    if (d && d.kind === 'link' && d.moved) {
      const A = this.bp.nodes[d.from];
      ctx.strokeStyle = this.tool === 'muscle' ? 'rgba(255,90,120,0.8)' : 'rgba(230,240,255,0.8)';
      ctx.lineWidth = 3 / Z * 1.2; ctx.setLineDash([6 / Z, 5 / Z]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(d.to.x, d.to.y); ctx.stroke(); ctx.setLineDash([]);
    }
    // ホバー予告
    if (this.hover.on && !this.drag && this.tool === 'node' && this.hitNode(this.hover) < 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1 / Z;
      ctx.beginPath(); ctx.arc(Math.round(this.hover.x / SNAP) * SNAP, Math.max(0, Math.round(this.hover.y / SNAP) * SNAP), NODE_R, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }
}
