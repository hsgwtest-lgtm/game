// カメラ操作：ゆっくり自動で回る／ドラッグで回す／ピンチ・ホイールで寄る／タップで対象へ寄る。

import * as THREE from '../lib/three.module.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function createOrbit({ camera, dom, onTap, islandRadius = 100 }) {
  const state = {
    target: new THREE.Vector3(0, 4, 4),
    dist: 300,
    az: 0.5, // 水平の回り込み（ラジアン）
    pol: 0.92, // 真上からの傾き（0 = 真上）
  };
  const goal = { target: state.target.clone(), dist: state.dist, az: state.az, pol: state.pol };
  const limits = { minDist: 26, maxDist: 900, minPol: 0.3, maxPol: 1.28 };
  let follow = null; // () => Vector3
  let lastInput = -1e9;
  let autoOrbit = true;
  let viewShift = 0; // 下にシートが出ているぶん、絵を上へずらす（CSSピクセル）
  let viewShiftGoal = 0;
  let size = { w: 1, h: 1 };
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const pointers = new Map();
  let tapCandidate = null;
  let pinch = null;

  const touch = () => {
    lastInput = performance.now();
  };

  function onDown(e) {
    dom.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    if (pointers.size === 1) {
      tapCandidate = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    } else {
      tapCandidate = null;
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
    touch();
  }

  function pan(dx, dy) {
    // 画面のドラッグ量を地面上の移動に変換
    const k = (goal.dist * 2 * Math.tan((camera.fov * Math.PI) / 360)) / size.h;
    const sin = Math.sin(goal.az);
    const cos = Math.cos(goal.az);
    goal.target.x += (-dx * cos - dy * sin) * k;
    goal.target.z += (dx * sin - dy * cos) * k;
    const r = Math.hypot(goal.target.x, goal.target.z);
    if (r > islandRadius * 1.2) {
      goal.target.x *= (islandRadius * 1.2) / r;
      goal.target.z *= (islandRadius * 1.2) / r;
    }
    follow = null;
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (tapCandidate && tapCandidate.id === e.pointerId) {
      if (Math.hypot(e.clientX - tapCandidate.x, e.clientY - tapCandidate.y) > 8) tapCandidate.moved = true;
      if (!tapCandidate.moved) return;
    }
    touch();
    if (pointers.size === 1) {
      if (p.button === 2 || e.shiftKey) {
        pan(dx, dy);
      } else {
        goal.az -= dx * 0.0065;
        goal.pol = clamp(goal.pol - dy * 0.005, limits.minPol, limits.maxPol);
      }
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (pinch.d > 0 && d > 0) goal.dist = clamp((goal.dist * pinch.d) / d, limits.minDist, limits.maxDist);
      pan(cx - pinch.cx, cy - pinch.cy);
      pinch = { d, cx, cy };
    }
  }

  function onUp(e) {
    const had = pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (had && tapCandidate && tapCandidate.id === e.pointerId && !tapCandidate.moved && performance.now() - tapCandidate.t < 500 && e.type === 'pointerup') {
      const rect = dom.getBoundingClientRect();
      onTap?.(e.clientX - rect.left, e.clientY - rect.top);
    }
    if (tapCandidate && tapCandidate.id === e.pointerId) tapCandidate = null;
    touch();
  }

  function onWheel(e) {
    e.preventDefault();
    const f = Math.exp(clamp(e.deltaY, -120, 120) * 0.0016);
    goal.dist = clamp(goal.dist * f, limits.minDist, limits.maxDist);
    touch();
  }

  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', (e) => e.preventDefault());

  // 島全体が画面に入る距離
  function fitDistance() {
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const byWidth = (islandRadius * 1.08) / Math.tan(hFov / 2);
    const byHeight = (islandRadius * 0.95) / Math.tan(vFov / 2);
    return clamp(Math.max(byWidth, byHeight), 120, limits.maxDist);
  }

  function setSize(w, h) {
    size = { w, h };
    limits.maxDist = fitDistance() * 1.25;
    goal.dist = clamp(goal.dist, limits.minDist, limits.maxDist);
  }

  function overview(immediate = false) {
    follow = null;
    goal.target.set(0, 4, 2);
    goal.dist = fitDistance();
    goal.pol = 0.92;
    if (immediate) snap();
  }

  function focus(point, dist = 60) {
    follow = null;
    goal.target.set(point.x, point.y ?? 4, point.z);
    goal.dist = clamp(dist, limits.minDist, limits.maxDist);
    touch();
  }

  function followTarget(fn, dist = 46) {
    follow = fn;
    goal.dist = clamp(Math.min(goal.dist, dist), limits.minDist, limits.maxDist);
    touch();
  }

  function snap() {
    if (follow) {
      const p = follow();
      if (p) goal.target.set(p.x, p.y + 2, p.z);
    }
    state.target.copy(goal.target);
    state.dist = goal.dist;
    state.az = goal.az;
    state.pol = goal.pol;
    viewShift = viewShiftGoal;
    apply();
  }

  function apply() {
    const sinP = Math.sin(state.pol);
    camera.position.set(
      state.target.x + state.dist * sinP * Math.sin(state.az),
      state.target.y + state.dist * Math.cos(state.pol),
      state.target.z + state.dist * sinP * Math.cos(state.az),
    );
    camera.lookAt(state.target);
    if (Math.abs(viewShift) > 0.5) camera.setViewOffset(size.w, size.h, 0, viewShift, size.w, size.h);
    else if (camera.view) camera.clearViewOffset();
    camera.updateMatrixWorld();
  }

  function update(dt) {
    if (follow) {
      const p = follow();
      if (p) goal.target.set(p.x, p.y + 2, p.z);
    }
    const idle = performance.now() - lastInput > 4500;
    if (autoOrbit && !reduceMotion && idle && pointers.size === 0) {
      goal.az += dt * (follow ? 0.045 : 0.03);
    }
    const k = 1 - Math.exp(-dt * 5.5);
    state.target.lerp(goal.target, k);
    state.dist += (goal.dist - state.dist) * k;
    state.az += (goal.az - state.az) * k;
    state.pol += (goal.pol - state.pol) * k;
    viewShift += (viewShiftGoal - viewShift) * k;
    apply();
  }

  return {
    state,
    goal,
    update,
    setSize,
    overview,
    focus,
    followTarget,
    snap,
    stopFollow: () => {
      follow = null;
    },
    isFollowing: () => !!follow,
    setViewShift: (px) => {
      viewShiftGoal = px;
    },
    setAutoOrbit: (on) => {
      autoOrbit = on;
    },
    setAngles: (az, pol) => {
      goal.az = az;
      if (pol !== undefined) goal.pol = clamp(pol, limits.minPol, limits.maxPol);
    },
  };
}
