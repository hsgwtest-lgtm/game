// 島民の暮らしシミュレーション。
// 乱数は使わず、「時刻（スロット番号）× 島民ID」のハッシュだけで行動を決める。
// → 同じ時刻に開けば、誰の端末でも同じ島の光景になる。状態も持たない（任意の時刻を直接計算できる）。
//
// 1スロット（既定60秒）ごとに全員の「行き先と行動」を決め、
//   [前スロットの行動を少し続ける] → [歩いて移動] → [今スロットの行動]
// の順で過ごす。
//
// 行き先はすべて「島民の行動範囲」の中（nav が範囲の中だけを歩けるマスにしている）。
// 範囲の縁（森や高原との境目）にいる島民は、たまに障壁を匂わせるセリフを吹き出しで出す。

import { N, DISTRICTS, BIOME, NO_DISTRICT, PLAIN_CENTER, LANDING } from './terrain.js';
import { hashStr, hashMix, hash01 } from './rng.js';
import { SIM, JOBS, DEFAULT_JOB, RELATION_TYPES, DEFAULT_RELATION, BARRIERS, DEFAULT_BARRIER } from './config.js';

// 島民の集まり場。拠点が決まっていれば拠点（広場）、決まるまでは漂着した砂浜。
export function resolveHub(base) {
  if (base && Number.isFinite(base.x) && Number.isFinite(base.z)) return { x: base.x, z: base.z, label: base.name || '広場', isBase: true };
  return { x: LANDING.x, z: LANDING.z, label: LANDING.name, isBase: false };
}

// 行動範囲の外の地区の「自然の障壁」（セリフ・呼び名）
export const barrierOf = (districtIndex) => BARRIERS[DISTRICTS[districtIndex]?.id] || DEFAULT_BARRIER;

const EDGE_R = 3; // 範囲外の地区までこのマス数以内なら「縁」
const LINE_MS = 9000; // セリフの周期
const LINE_SHOW_MS = 4500; // 1回のセリフを出している長さ
const LINE_KINDS = new Set(['wander', 'rest', 'work', 'wait']); // 立ち止まっている行動のときだけ話す

export function createSim({ terrain, nav, pathfinder, islanders, buildings, hub = resolveHub(null), outOfRange = new Set(), seed = 1 }) {
  const { idx, cellCenter, district, biome, h } = terrain;
  const n = islanders.length;
  const SLOT_MS = SIM.slotSeconds * 1000;
  const idHash = islanders.map((p) => hashStr(String(p.id)));
  const indexOfId = new Map(islanders.map((p, i) => [String(p.id), i]));

  // ---- スポット（行き先）を集める -------------------------------------------
  function pickCells(filter, count, minSep, salt) {
    const cands = [];
    for (let k = 0; k < N * N; k++) {
      if (nav.walk[k] && filter(k, k % N, Math.floor(k / N))) cands.push(k);
    }
    cands.sort((a, b) => hashMix(a, salt, seed) - hashMix(b, salt, seed) || a - b);
    const out = [];
    for (const k of cands) {
      const c = cellCenter(k % N, Math.floor(k / N));
      if (out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= minSep)) {
        out.push({ ...c, k });
        if (out.length >= count) break;
      }
    }
    return out;
  }

  const buildingSpots = [];
  for (const b of buildings) {
    b.spots.forEach((s, m) => {
      const p = nav.snap(s.x, s.z);
      buildingSpots.push({ ...s, x: p.x, z: p.z, kind: 'building', key: `${b.id}:${m}` });
    });
  }

  // 波打ちぎわ（海のとなりの砂）
  const shoreSpots = pickCells(
    (k, i, j) => {
      if (biome[k] !== BIOME.SAND || nav.walkY[k] !== h[k]) return false;
      return [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([di, dj]) => terrain.heightAtCell(i + di, j + dj) < 1);
    },
    5,
    18,
    101,
  ).map((c, m) => {
    // 海のほうを向く
    let fx = 0;
    let fz = 0;
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        if (terrain.heightAtCell((c.k % N) + di, Math.floor(c.k / N) + dj) < 1) {
          fx += di;
          fz += dj;
        }
      }
    }
    const d = DISTRICTS[district[c.k]];
    return { x: c.x, z: c.z, fx: c.x + fx * 4, fz: c.z + fz * 4, jobs: [], label: `${d.name}の波打ちぎわ`, spread: 0.6, kind: 'shore', key: `shore${m}` };
  });

  // 各地区の見晴らしスポット（散歩・探検の行き先）。行動範囲の外の地区は歩けるマスが無いので選ばれない。
  const viewSpots = [];
  DISTRICTS.forEach((d, di) => {
    const awayFromHub = (i, j) => {
      const c = cellCenter(i, j);
      return Math.hypot(c.x - hub.x, c.z - hub.z) > 10;
    };
    pickCells((k, i, j) => district[k] === di && nav.walkY[k] === h[k] && awayFromHub(i, j), 3, 22, 200 + di).forEach((c, m) => {
      viewSpots.push({ x: c.x, z: c.z, fx: c.x + (c.x - PLAIN_CENTER.x), fz: c.z + (c.z - PLAIN_CENTER.z), jobs: [], label: d.name, spread: 1.2, kind: 'view', district: d.id, key: `view${di}:${m}` });
    });
  });

  // 島の真ん中をかこむ草地
  const meadowSpots = pickCells(
    (k, i, j) => {
      const c = cellCenter(i, j);
      const dist = Math.hypot(c.x - PLAIN_CENTER.x, c.z - PLAIN_CENTER.z);
      return biome[k] === BIOME.GRASS && dist > 20 && dist < 36;
    },
    3,
    14,
    301,
  ).map((c, m) => ({ x: c.x, z: c.z, fx: c.x + 3, fz: c.z + 1, jobs: [], label: '草地', spread: 1.2, kind: 'meadow', key: `meadow${m}` }));

  // 行動範囲の縁：範囲外の地区まで EDGE_R マス以内の歩けるマス → いちばん近い範囲外の地区
  const edgeOf = new Uint8Array(N * N).fill(NO_DISTRICT);
  const edgeD2 = new Uint8Array(N * N).fill(255);
  if (outOfRange.size) {
    for (let k = 0; k < N * N; k++) {
      if (!nav.walk[k]) continue;
      const i = k % N;
      const j = Math.floor(k / N);
      for (let dj = -EDGE_R; dj <= EDGE_R; dj++) {
        for (let di = -EDGE_R; di <= EDGE_R; di++) {
          if (!terrain.inGrid(i + di, j + dj)) continue;
          const nk = idx(i + di, j + dj);
          if (h[nk] < 1 || !outOfRange.has(district[nk])) continue;
          const d2 = di * di + dj * dj;
          if (d2 < edgeD2[k]) {
            edgeD2[k] = d2;
            edgeOf[k] = district[nk];
          }
        }
      }
    }
  }
  const edgeAt = (x, z) => {
    const c = terrain.cellOf(x, z);
    return edgeOf[idx(c.i, c.j)];
  };

  // 縁の見晴らしスポット（森や高原の様子をうかがいに行く場所）。障壁のほうを向く。
  const edgeSpots = [];
  for (const di of [...outOfRange].sort((a, b) => a - b)) {
    const bar = barrierOf(di);
    pickCells((k) => edgeOf[k] === di && edgeD2[k] <= 4 && nav.walkY[k] === h[k], 3, 16, 400 + di).forEach((c, m) => {
      let fx = 0;
      let fz = 0;
      const ci = c.k % N;
      const cj = Math.floor(c.k / N);
      for (let dj = -EDGE_R; dj <= EDGE_R; dj++) {
        for (let dk = -EDGE_R; dk <= EDGE_R; dk++) {
          if (!terrain.inGrid(ci + dk, cj + dj)) continue;
          if (district[idx(ci + dk, cj + dj)] === di) {
            fx += dk;
            fz += dj;
          }
        }
      }
      edgeSpots.push({ x: c.x, z: c.z, fx: c.x + fx, fz: c.z + fz, jobs: [], label: bar.edge || `${DISTRICTS[di].name}の手前`, spread: 0.6, kind: 'edge', edge: di, key: `edge${di}:${m}` });
    });
  }

  // 料理人の持ち場：拠点のたき火（拠点が決まるまでは、集まり場の砂浜で）
  const firePos = nav.snap(hub.x + 2.1, hub.z + 0.4);
  const fireSpot = { x: firePos.x, z: firePos.z, fx: hub.x, fz: hub.z, jobs: ['料理人'], label: hub.isBase ? `${hub.label}のたき火` : hub.label, spread: 0.3, kind: 'plaza', key: 'fire' };
  const plazaSpot = { x: hub.x, z: hub.z, fx: hub.x, fz: hub.z, jobs: [], label: hub.label, spread: 0, kind: 'plaza', key: 'plaza' };

  const spots = [...buildingSpots, ...shoreSpots, ...viewSpots, ...meadowSpots, ...edgeSpots, fireSpot];

  function jobSpots(job) {
    const tagged = spots.filter((s) => s.jobs.includes(job));
    // 探検家は、行動範囲の縁で森や高原の様子を調べることもある
    if (job === '探検家') return [...tagged, ...viewSpots, ...edgeSpots].length ? [...tagged, ...viewSpots, ...edgeSpots] : [fireSpot];
    if (tagged.length) return tagged;
    if (job === '漁師' && shoreSpots.length) return shoreSpots;
    if (job === '農家' && meadowSpots.length) return meadowSpots;
    if (buildingSpots.length) return buildingSpots;
    return viewSpots.length ? viewSpots : [fireSpot];
  }
  const jobSpotCache = new Map();
  const spotsForJob = (job) => {
    if (!jobSpotCache.has(job)) jobSpotCache.set(job, jobSpots(job));
    return jobSpotCache.get(job);
  };

  // 集まり場のまわりのぶらぶら位置
  function hubPoint(a, b) {
    const ang = hash01(a, b, 31) * Math.PI * 2;
    const r = 4.5 + hash01(a, b, 32) * 8;
    return nav.snap(hub.x + Math.cos(ang) * r, hub.z + Math.sin(ang) * r);
  }

  function relationBetween(i, j) {
    const a = (islanders[i].relationships || []).find((r) => String(r.id) === String(islanders[j].id));
    const b = (islanders[j].relationships || []).find((r) => String(r.id) === String(islanders[i].id));
    return a || b || null;
  }

  // ---- スロットごとの計画 ---------------------------------------------------
  const planCache = new Map();
  function plan(k) {
    let p = planCache.get(k);
    if (!p) {
      p = computePlan(k);
      planCache.set(k, p);
      if (planCache.size > 8) {
        for (const key of planCache.keys()) if (Math.abs(key - k) > 3) planCache.delete(key);
      }
    }
    return p;
  }

  function computePlan(k) {
    const out = new Array(n).fill(null);
    const gather = hashMix(k, seed, 77) % SIM.gatherEvery === 0;
    const order = [...Array(n).keys()].sort((a, b) => hashMix(k, idHash[a], 1) - hashMix(k, idHash[b], 1) || a - b);
    const taken = new Set();

    // 会話のペアを決める
    if (!gather) {
      for (const i of order) {
        if (out[i]) continue;
        if (hash01(k, idHash[i], 2) >= SIM.chatChance) continue;
        const cands = [];
        for (const r of islanders[i].relationships || []) {
          const j = indexOfId.get(String(r.id));
          if (j === undefined || j === i || out[j]) continue;
          cands.push({ j, w: 20 + Math.max(0, Number(r.affinity) || 0) });
        }
        if (!cands.length || hash01(k, idHash[i], 5) < 0.2) {
          for (const j of order) if (j !== i && !out[j] && !cands.some((c) => c.j === j)) cands.push({ j, w: 12 });
        }
        if (!cands.length) continue;
        let pick = hash01(k, idHash[i], 3) * cands.reduce((s, c) => s + c.w, 0);
        let j = cands[cands.length - 1].j;
        for (const c of cands) {
          pick -= c.w;
          if (pick < 0) {
            j = c.j;
            break;
          }
        }
        // 会う場所：集まり場か、どちらかの仕事場の近く
        const where = hash01(k, idHash[i], 6);
        let base;
        let place;
        if (where < 0.5) {
          base = hubPoint(k, idHash[i]);
          place = hub.label;
        } else {
          const list = spotsForJob(islanders[where < 0.75 ? i : j].job);
          const s = list[hashMix(k, idHash[i], 7) % list.length];
          const ang = hash01(k, idHash[i], 8) * Math.PI * 2;
          base = nav.snap(s.x + Math.cos(ang) * 2.4, s.z + Math.sin(ang) * 2.4);
          place = s.label;
        }
        // 向かい合う2点（歩ける向きを探す）
        let pa = base;
        let pb = null;
        for (let t = 0; t < 8 && !pb; t++) {
          const ang = (hash01(k, idHash[i], 9) + t / 8) * Math.PI * 2;
          const q = { x: base.x + Math.cos(ang) * 2.0, z: base.z + Math.sin(ang) * 2.0 };
          if (nav.isWalkable(q.x, q.z) && pathfinder.lineOK(base, q)) pb = q;
        }
        if (!pb) continue;
        const rel = relationBetween(i, j);
        const icon = (rel && RELATION_TYPES[rel.type]?.icon) || DEFAULT_RELATION.icon;
        out[i] = { kind: 'chat', x: pa.x, z: pa.z, fx: pb.x, fz: pb.z, partner: j, place, icon };
        out[j] = { kind: 'chat', x: pb.x, z: pb.z, fx: pa.x, fz: pa.z, partner: i, place, icon };
      }
    }

    order.forEach((i, rank) => {
      if (out[i]) return;
      const person = islanders[i];
      const r = hash01(k, idHash[i], 4);
      const explorer = person.job === '探検家';

      if (gather && r < 0.85) {
        const perRing = 10;
        const ring = Math.floor(rank / perRing);
        const inRing = Math.min(perRing, n - ring * perRing);
        const ang = ((rank % perRing) / inRing) * Math.PI * 2 + ring * 0.31 + hash01(k, 55) * 6.28;
        const rad = 3.8 + ring * 2.3;
        const p = nav.snap(hub.x + Math.cos(ang) * rad, hub.z + Math.sin(ang) * rad);
        out[i] = { kind: 'gather', x: p.x, z: p.z, fx: hub.x, fz: hub.z, partner: -1, place: hub.label };
        return;
      }

      if (r < (explorer ? 0.5 : 0.62)) {
        const list = spotsForJob(person.job);
        let pickIdx = hashMix(k, idHash[i], 10) % list.length;
        for (let t = 0; t < list.length && taken.has(list[pickIdx].key); t++) pickIdx = (pickIdx + 1) % list.length;
        const s = list[pickIdx];
        taken.add(s.key);
        const ang = hash01(k, idHash[i], 11) * Math.PI * 2;
        const rad = (s.spread || 0) * hash01(k, idHash[i], 12);
        const p = nav.snap(s.x + Math.cos(ang) * rad, s.z + Math.sin(ang) * rad);
        out[i] = { kind: 'work', x: p.x, z: p.z, fx: s.fx, fz: s.fz, partner: -1, place: s.label };
        return;
      }

      if (r < 0.8 || !viewSpots.length) {
        const p = hubPoint(k, idHash[i]);
        out[i] = { kind: 'rest', x: p.x, z: p.z, fx: hub.x, fz: hub.z, partner: -1, place: hub.label };
        return;
      }

      // 散歩：ときどき行動範囲の縁まで、森や高原の様子を見に行く
      if (edgeSpots.length && hash01(k, idHash[i], 17) < 0.22) {
        const s = edgeSpots[hashMix(k, idHash[i], 18) % edgeSpots.length];
        const ang = hash01(k, idHash[i], 19) * Math.PI * 2;
        const rad = s.spread * hash01(k, idHash[i], 21);
        const p = nav.snap(s.x + Math.cos(ang) * rad, s.z + Math.sin(ang) * rad);
        out[i] = { kind: 'wander', x: p.x, z: p.z, fx: s.fx, fz: s.fz, partner: -1, place: s.label, edge: s.edge };
        return;
      }

      // 散歩：半分は自分の起点地区へ
      let list = [...viewSpots, ...shoreSpots];
      const homeList = list.filter((s) => s.district === person.home);
      if (homeList.length && hash01(k, idHash[i], 13) < 0.5) list = homeList;
      const s = list[hashMix(k, idHash[i], 14) % list.length];
      const ang = hash01(k, idHash[i], 15) * Math.PI * 2;
      const rad = (s.spread || 0) * hash01(k, idHash[i], 16);
      const p = nav.snap(s.x + Math.cos(ang) * rad, s.z + Math.sin(ang) * rad);
      out[i] = { kind: 'wander', x: p.x, z: p.z, fx: s.fx, fz: s.fz, partner: -1, place: s.label };
    });

    return { k, gather, entries: out };
  }

  // ---- 移動（スロット k での、前の場所→今の場所） ----------------------------
  const legCache = new Map();
  function leg(i, k) {
    const key = k * 4096 + i;
    let l = legCache.get(key);
    if (l) return l;
    const from = plan(k - 1).entries[i];
    const to = plan(k).entries[i];
    const delay = 1.5 + 9 * hash01(k, idHash[i], 20);
    const path = pathfinder.findPath({ x: from.x, z: from.z }, { x: to.x, z: to.z });
    const travel = Math.min(path.len / SIM.walkSpeed, SIM.slotSeconds - delay - 6);
    l = { from, to, delay, path, travel, arrive: delay + travel };
    if (legCache.size > Math.max(64, n * 6)) {
      for (const kk of legCache.keys()) if (Math.abs(Math.floor(kk / 4096) - k) > 1) legCache.delete(kk);
    }
    legCache.set(key, l);
    return l;
  }

  // ---- 任意の時刻の状態 -----------------------------------------------------
  // 戻り値：{ x, y, z, dx, dz, anim, bubble, line, kind, phase, place, partner, edge }
  //   anim: 'idle' | 'walk' | 'work' | 'cheer' | 'talk'
  //   bubble: 吹き出しの種類。アイコン（'talk' | 'heart' | 'note' | 'bolt'）か、セリフ 'line'（文面は line）
  //   phase: 'linger'（前の行動の続き）| 'walk' | 'do'
  //   edge: 行動範囲の縁で様子をうかがっているときの、範囲外の地区の番号
  function stateAt(i, tMs) {
    const k = Math.floor(tMs / SLOT_MS);
    const e = (tMs - k * SLOT_MS) / 1000;
    const l = leg(i, k);

    if (e >= l.delay && e < l.arrive) {
      const p = pathfinder.pointAt(l.path, ((e - l.delay) / l.travel) * l.path.len);
      return { x: p.x, y: nav.yAt(p.x, p.z), z: p.z, dx: p.dx, dz: p.dz, anim: 'walk', bubble: null, line: '', kind: l.to.kind, phase: 'walk', place: l.to.place, partner: l.to.partner, edge: l.to.edge };
    }

    const lingering = e < l.delay;
    const entry = lingering ? l.from : l.to;
    const st = {
      x: entry.x,
      y: nav.yAt(entry.x, entry.z),
      z: entry.z,
      dx: entry.fx - entry.x,
      dz: entry.fz - entry.z,
      anim: 'idle',
      bubble: null,
      line: '',
      kind: entry.kind,
      phase: lingering ? 'linger' : 'do',
      place: entry.place,
      partner: entry.partner,
      edge: entry.edge,
    };

    if (entry.kind === 'work') {
      st.anim = 'work';
    } else if (entry.kind === 'gather') {
      st.anim = 'cheer';
      if (hashMix(idHash[i], Math.floor(tMs / 2400)) % 5 === 0) st.bubble = 'note';
    } else if (entry.kind === 'chat') {
      const j = entry.partner;
      const lj = leg(j, k);
      // 2人がそろっている間だけ会話する
      const together = lingering ? e < Math.min(l.delay, lj.delay) : e >= Math.max(l.arrive, lj.arrive);
      if (together) {
        st.anim = 'talk';
        const turn = Math.floor(tMs / 1700) % 2;
        const speaker = turn === 0 ? Math.min(i, j) : Math.max(i, j);
        if (speaker === i) st.bubble = entry.icon;
      } else {
        st.kind = 'wait';
      }
    }

    // 行動範囲の縁にいると、たまに障壁を匂わせるセリフをつぶやく（「行ってみようか」投票への伏線）
    if (!st.bubble && LINE_KINDS.has(st.kind)) {
      const near = entry.edge ?? edgeAt(entry.x, entry.z);
      const lines = near === NO_DISTRICT ? null : barrierOf(near).lines;
      if (lines && lines.length) {
        const tt = tMs + (idHash[i] % LINE_MS);
        const cyc = Math.floor(tt / LINE_MS);
        const odds = entry.edge !== undefined ? 2 : 4; // 縁まで様子を見に来た人は、よくつぶやく
        if (hashMix(idHash[i], cyc, 61) % odds === 0 && tt - cyc * LINE_MS < LINE_SHOW_MS) {
          st.bubble = 'line';
          st.line = lines[hashMix(idHash[i], cyc, 62) % lines.length];
        }
      }
    }
    return st;
  }

  // 詳細パネル用の「いま何をしているか」
  function describe(i, tMs) {
    const s = stateAt(i, tMs);
    const job = JOBS[islanders[i].job] || DEFAULT_JOB;
    const partner = s.partner >= 0 ? islanders[s.partner].name : '';
    if (s.phase === 'walk') {
      if (s.kind === 'chat') return `${partner}に会いに${s.place}へ向かっている`;
      if (s.kind === 'gather') return `${hub.label}の集まりへ向かっている`;
      return `${s.place}へ歩いている`;
    }
    switch (s.kind) {
      case 'work':
        return `${s.place}で${job.work}`;
      case 'gather':
        return `${hub.label}でみんなと集まっている`;
      case 'chat':
        return `${s.place}で${partner}とおしゃべり中`;
      case 'wait':
        return `${s.place}で${partner}を待っている`;
      case 'wander':
        if (s.edge !== undefined) return `${s.place}で${barrierOf(s.edge).look}`;
        return `${s.place}を散歩している`;
      default:
        return `${s.place}でひと休みしている`;
    }
  }

  // 集まり場から各建物への踏みあと（地面の色づけ用）
  function trails() {
    const cells = new Set();
    const start = nav.nearestOpen(hub.x + 4, hub.z + 4);
    if (start < 0) return cells;
    const seen = new Set();
    for (const s of buildingSpots) {
      if (seen.has(s.building)) continue;
      seen.add(s.building);
      const c = terrain.cellOf(s.x, s.z);
      const path = pathfinder.findCells(start, idx(c.i, c.j));
      if (path) for (const k of path) cells.add(k);
    }
    return cells;
  }

  return { SLOT_MS, hub, spots, plazaSpot, fireSpot, edgeSpots, edgeAt, plan, stateAt, describe, trails, indexOfId };
}
