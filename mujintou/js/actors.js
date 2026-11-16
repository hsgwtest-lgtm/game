// 島民の表示：ドット絵スプライト、足もとの影、吹き出し、頭上の名前ラベル（DOM）。
// 吹き出しはアイコン（会話・ハート・音符・いなずま）がスプライト、セリフ（文字）が名前ラベルの上の DOM。
// 名前ラベルとセリフは、カメラの距離に応じて出し分ける（zoom.js）。

import * as THREE from '../lib/three.module.js';
import { islanderAtlas, bubbleCanvas, FRAME_W, FRAME_H, FRAME_COUNT, FRAMES, BUBBLE_W, BUBBLE_H } from './pixelart.js';
import { hashStr } from './rng.js';
import { MAX_LABELS } from './config.js';
import { nameLabelLook } from './zoom.js';

const SPRITE_H = 3.9; // スプライト1コマの高さ（ワールド単位）
const SPRITE_W = (SPRITE_H * FRAME_W) / FRAME_H;
const MIN_PX = 30; // 引いて見ても、これより小さくはしない（画面上の高さ）

function pixelTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createActors({ scene, islanders, sim, labelLayer }) {
  const bubbleTex = {};
  for (const icon of ['talk', 'heart', 'note', 'bolt']) bubbleTex[icon] = pixelTexture(bubbleCanvas(icon));

  const shadowGeo = new THREE.CircleGeometry(0.85, 10);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#1b1630', transparent: true, opacity: 0.26, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(1.25, 1.6, 20);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
  ring.visible = false;
  ring.renderOrder = 3;
  scene.add(ring);

  const actors = islanders.map((person, i) => {
    const atlas = islanderAtlas(person);
    const tex = pixelTexture(atlas);
    tex.repeat.set(1 / FRAME_COUNT, 0.5);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5, transparent: false }));
    sprite.center.set(0.5, 1 / FRAME_H);
    sprite.scale.set(SPRITE_W, SPRITE_H, 1);
    sprite.renderOrder = 1;

    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.renderOrder = 3;

    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex.talk, alphaTest: 0.5, transparent: false, depthTest: false }));
    bubble.center.set(0.35, 0);
    bubble.visible = false;
    bubble.renderOrder = 5;

    scene.add(shadow, sprite, bubble);

    const label = document.createElement('div');
    label.className = 'label';
    label.style.display = 'none';
    const name = document.createElement('span');
    name.textContent = person.displayName;
    label.appendChild(name);
    labelLayer.appendChild(label);

    return {
      person,
      index: i,
      atlas,
      tex,
      sprite,
      shadow,
      bubble,
      label,
      speech: null, // セリフの吹き出し（初めて話すときに作る）
      speechText: '',
      line: '',
      seed: hashStr(String(person.id)),
      pos: new THREE.Vector3(),
      y: null,
      facing: 1,
      scale: 1,
      screen: { x: 0, y: 0, r: 0, visible: false },
      look: { show: false, opacity: 0, size: 0 },
      labelShown: false,
      labelSize: 0,
      labelOpacity: -1,
    };
  });

  const right = new THREE.Vector3();
  const v = new THREE.Vector3();
  const order = [];

  // viewport: { w, h }（CSSピクセル）、zoomDist: カメラから注視点までの距離（ラベルの段階表示に使う）
  function update(tMs, dt, camera, viewport, selected, zoomDist) {
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    const pxPerUnitAt1 = viewport.h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const t = tMs / 1000;

    for (const a of actors) {
      const s = sim.stateAt(a.index, tMs);

      // 高さは段差でカクッとしないよう、少しなめらかに追いかける
      if (a.y === null || Math.abs(a.y - s.y) > 3) a.y = s.y;
      else a.y += (s.y - a.y) * Math.min(1, dt * 14);

      // 画面上の左右どちらを向くか
      const side = s.dx * right.x + s.dz * right.z;
      if (Math.abs(side) > 0.05 * Math.hypot(s.dx, s.dz)) a.facing = side > 0 ? 1 : -1;

      // コマ選び
      let frame = FRAMES.idle;
      let hop = 0;
      const ph = t + (a.seed % 1000) / 500;
      if (s.anim === 'walk') {
        frame = [FRAMES.walkA, FRAMES.idle, FRAMES.walkB, FRAMES.idle][Math.floor(ph * 7) % 4];
        hop = Math.floor(ph * 7) % 2 === 0 ? 0.12 : 0;
      } else if (s.anim === 'work') {
        frame = Math.floor(ph * 2.4) % 2 ? FRAMES.workB : FRAMES.workA;
      } else if (s.anim === 'cheer') {
        const c = Math.floor(ph * 2.6) % 3;
        frame = c === 0 ? FRAMES.cheer : FRAMES.idle;
        hop = c === 0 ? 0.3 : 0;
      } else if (s.anim === 'talk') {
        hop = s.bubble && Math.floor(ph * 4) % 2 ? 0.14 : 0;
      }
      a.tex.offset.set(frame / FRAME_COUNT, a.facing > 0 ? 0.5 : 0);

      a.pos.set(s.x, a.y, s.z);
      const dist = camera.position.distanceTo(a.pos);
      const pxPerUnit = pxPerUnitAt1 / Math.max(1, dist);
      const minPx = a.index === selected ? MIN_PX + 8 : MIN_PX;
      const k = Math.max(1, minPx / (SPRITE_H * pxPerUnit));
      a.scale = k;

      a.sprite.position.set(s.x, a.y + hop * k, s.z);
      a.sprite.scale.set(SPRITE_W * k, SPRITE_H * k, 1);
      a.shadow.position.set(s.x, a.y + 0.07, s.z);
      a.shadow.scale.setScalar(k);

      // セリフ（'line'）は DOM の吹き出しで、名前ラベルの上に出す。それ以外はアイコンのスプライト。
      const iconBubble = s.bubble && s.bubble !== 'line';
      a.line = s.bubble === 'line' ? s.line : '';
      if (iconBubble) {
        a.bubble.visible = true;
        a.bubble.material.map = bubbleTex[s.bubble] || bubbleTex.talk;
        const bh = 2.3 * k;
        a.bubble.scale.set((bh * BUBBLE_W) / BUBBLE_H, bh, 1);
        a.bubble.position.set(s.x, a.y + (SPRITE_H + 0.2) * k, s.z);
      } else {
        a.bubble.visible = false;
      }

      // 画面座標（タップ判定とラベル用）
      v.set(s.x, a.y + SPRITE_H * k * 0.5, s.z).project(camera);
      const onScreen = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
      a.screen.visible = onScreen;
      a.screen.x = (v.x * 0.5 + 0.5) * viewport.w;
      a.screen.y = (-v.y * 0.5 + 0.5) * viewport.h;
      a.screen.r = Math.max(20, SPRITE_H * k * pxPerUnit * 0.6);
      a.screen.dist = dist;
      a.screen.top = a.screen.y - SPRITE_H * k * pxPerUnit * (iconBubble ? 1.15 : 0.56);
    }

    // ラベル：ズームの段階で出し分け（引きの全体表示では出さない）、
    // 出すものが多いときはカメラに近い順に上限（MAX_LABELS）まで
    order.length = 0;
    for (const a of actors) {
      nameLabelLook(zoomDist ?? a.screen.dist, a.screen.dist, viewport.h, a.index === selected, a.look);
      if (a.screen.visible && a.look.show) order.push(a);
    }
    let allowed = null;
    if (order.length > MAX_LABELS) {
      order.sort((p, q) => p.screen.dist - q.screen.dist);
      allowed = new Set(order.slice(0, MAX_LABELS));
    }
    for (const a of actors) {
      const show = a.screen.visible && a.look.show && (a.index === selected || !allowed || allowed.has(a));
      if (show !== a.labelShown) {
        a.label.style.display = show ? '' : 'none';
        a.labelShown = show;
      }
      if (!show) continue;
      if (a.labelSize !== a.look.size) {
        a.label.style.fontSize = `${a.look.size}px`;
        a.labelSize = a.look.size;
      }
      if (a.labelOpacity !== a.look.opacity) {
        a.label.style.opacity = String(a.look.opacity);
        a.labelOpacity = a.look.opacity;
      }
      a.label.style.transform = `translate(${Math.round(a.screen.x)}px, ${Math.round(a.screen.top)}px) translate(-50%, -100%)`;
      a.label.classList.toggle('is-selected', a.index === selected);

      // セリフの吹き出し（名前ラベルの上）
      if (a.line) {
        if (!a.speech) {
          a.speech = document.createElement('span');
          a.speech.className = 'speech';
          a.speech.hidden = true;
          a.label.appendChild(a.speech);
        }
        if (a.speechText !== a.line) {
          a.speech.textContent = a.line;
          a.speechText = a.line;
        }
      }
      if (a.speech && a.speech.hidden !== !a.line) {
        a.speech.hidden = !a.line;
        a.label.classList.toggle('is-talking', !!a.line);
      }
    }

    // 選択中の足もとの輪
    if (selected >= 0 && actors[selected]) {
      const a = actors[selected];
      ring.visible = true;
      const pulse = 1 + 0.12 * Math.sin(t * 5);
      ring.position.set(a.pos.x, a.pos.y + 0.1, a.pos.z);
      ring.scale.setScalar(a.scale * pulse);
    } else {
      ring.visible = false;
    }
  }

  // タップ位置（ステージ内のCSSピクセル）に近い島民
  function pickAt(x, y) {
    let best = -1;
    let bestD = Infinity;
    for (const a of actors) {
      if (!a.screen.visible) continue;
      const d = Math.hypot(a.screen.x - x, a.screen.y - y);
      if (d <= a.screen.r + 8 && d < bestD) {
        bestD = d;
        best = a.index;
      }
    }
    return best;
  }

  return {
    actors,
    update,
    pickAt,
    positionOf: (i) => actors[i]?.pos,
    atlasOf: (i) => actors[i]?.atlas,
  };
}
