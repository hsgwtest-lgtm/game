// オンライン対戦（ライブのルーム・クイック対戦・ゴースト）。
// 試合そのものは各端末で同じ計算をするので、送るのは「脳」と「開始時刻」と「スタンプ」だけ。

import { db, listen, measureOffset, SV_TIME, inc, FireError, cleanName, RULES_HINT, dbUrl } from './fire.js';
import { fromWire, toWire } from '../ml/net.js';
import { cleanDeck } from '../sim/rewards.js';
import { randomSeed } from '../core/rng.js';
import { N_ARENAS } from '../sim/arenas.js';

export const PLAN_MS = 60000;      // 作戦タイム
const START_DELAY = 6500;          // 開始時刻までの余裕（VS表示＋カウントダウン）
const STALE = 30000;               // これ以上だまっていたら切断とみなす

export class Online {
  constructor(app) {
    this.app = app;
    this.offset = 0;
    this.synced = false;
    this.status = 'idle';     // idle / ok / error
    this.error = null;
    this.room = null;
  }
  get pid() { return this.app.G.profile.id; }
  get name() { return cleanName(this.app.G.profile.name) || 'ななし'; }
  now() { return Date.now() + this.offset; }

  async sync() {
    this.offset = await measureOffset(this.pid);
    this.synced = true;
  }

  // つながるか・書きこめるか
  async check() {
    try {
      await this.sync();
      this.status = 'ok'; this.error = null;
      return { ok: true };
    } catch (e) {
      this.status = 'error';
      this.error = e instanceof FireError ? e.kind : 'network';
      return { ok: false, kind: this.error };
    }
  }

  errorText(kind) {
    if (kind === 'permission') return 'データベースの書きこみが許可されていません。Firebase のルールに ' + RULES_HINT + ' を追加してください';
    if (kind === 'full') return 'このルームはもう満員です';
    if (kind === 'notfound') return 'そのルームは見つかりませんでした';
    if (kind === 'stale') return 'そのルームの主はいなくなったようです';
    if (kind === 'timeout') return '返事がありませんでした';
    return 'ネットワークにつながりません';
  }

  // ── ゴースト ──
  async listGhosts() {
    const d = await db.get('ghosts', `orderBy=${encodeURIComponent('"$key"')}&limitToLast=40`);
    const out = [];
    for (const k in d || {}) {
      const g = d[k];
      if (!g || typeof g !== 'object') continue;
      out.push({
        key: k, name: cleanName(g.n) || 'ロボ', owner: cleanName(g.o) || 'ななし', oid: String(g.oid || ''),
        deck: cleanDeck(g.dk), steps: Number(g.st) || 0, t: Number(g.t) || 0,
        w: Number(g.w) || 0, l: Number(g.l) || 0, d: Number(g.dr) || 0,
      });
    }
    return out;
  }

  async uploadGhost(bot, net, deck) {
    const G = this.app.G;
    const old = G.s.online.ghostKey;
    const r = await db.post('ghosts', { n: cleanName(bot.name), o: this.name, oid: this.pid, dk: deck, st: bot.steps, t: SV_TIME, w: 0, l: 0, dr: 0 });
    if (!r || !r.name) throw new FireError('http');
    await db.put(`ghostBrains/${r.name}`, toWire(net));
    G.s.online.ghostKey = r.name;
    G.s.online.ghostBot = bot.id;
    G.save();
    if (old) { db.del(`ghosts/${old}`).catch(() => {}); db.del(`ghostBrains/${old}`).catch(() => {}); }
    return r.name;
  }

  async ghostBrain(key) {
    const w = await db.get(`ghostBrains/${key}`);
    return fromWire(w);
  }

  // ゴーストから見た結果を記録（勝ち w / 負け l / 引き分け dr）
  async reportGhost(key, ghostOutcome) {
    const f = ghostOutcome > 0 ? 'w' : ghostOutcome < 0 ? 'l' : 'dr';
    try { await db.patch(`ghosts/${key}`, { [f]: inc(1) }); } catch (e) { /* 記録できなくても試合はできる */ }
  }

  async myGhost() {
    const k = this.app.G.s.online.ghostKey;
    if (!k) return null;
    try { const g = await db.get(`ghosts/${k}`); return g ? { key: k, w: g.w || 0, l: g.l || 0, d: g.dr || 0, name: g.n } : null; } catch (e) { return null; }
  }
}

// ── ライブのルーム ──
export class LiveRoom {
  constructor(online, role, code, me) {
    this.online = online;
    this.role = role;              // 'host' / 'guest'
    this.other = role === 'host' ? 'guest' : 'host';
    this.code = code;
    this.me = me;                  // { name, bot, deck, steps, wire }
    this.data = null;
    this.state = 'connecting';     // connecting / waiting / paired / battle / plan / over / left / error
    this.error = null;
    this.accepted = role === 'host';
    this.uploaded = {};
    this.launched = {};
    this.results = {};
    this.emoSeen = new Set();
    this.emoHandler = null;
    this.listeners = [];
    this.gm = 1;
    this.planFor = 0;
    this.closed = false;
    this.opLeft = false;
    this.lastBeatCheck = 0;
  }

  get path() { return `rooms/${this.code}`; }
  get side() { return this.role === 'host' ? 0 : 1; }
  get bestOf() { return (this.data && this.data.cfg && this.data.cfg.bo) || 1; }
  on(fn) { this.listeners.push(fn); }
  emit(ev, arg) { for (const f of this.listeners) f(ev, arg); }

  static async create(online, me, bestOf, quick) {
    if (!online.synced) await online.sync();
    let code = null;
    for (let i = 0; i < 10; i++) {
      const c = String(1000 + Math.floor(Math.random() * 9000));
      const t = await db.get(`rooms/${c}/t`);
      if (!t || online.now() - t > 30 * 60 * 1000) { code = c; break; }
    }
    if (!code) throw new FireError('http', 'ルームを作れませんでした');
    const seed = randomSeed();
    await db.put(`rooms/${code}`, {
      v: 1, t: SV_TIME, cfg: { bo: bestOf, pl: PLAN_MS }, gm: 1,
      seed: { g1: seed }, arenas: { g1: pickArenas() },
      host: { id: online.pid, n: me.name, beat: SV_TIME },
    });
    if (quick) await db.put(`lobby/${code}`, { t: SV_TIME, n: me.name, b: bestOf });
    const room = new LiveRoom(online, 'host', code, me);
    room.quick = quick;
    room.state = 'waiting';
    room._listen();
    gc(online).catch(() => {});
    return room;
  }

  static async join(online, me, code, timeout = 8000) {
    if (!online.synced) await online.sync();
    const r = await db.get(`rooms/${code}`);
    if (!r || r.v !== 1 || !r.host) throw new FireError('notfound');
    if (r.guest && r.guest.id !== online.pid) throw new FireError('full');
    if (typeof r.host.beat === 'number' && online.now() - r.host.beat > STALE) throw new FireError('stale');
    await db.post(`rooms/${code}/joins`, { id: online.pid, n: me.name, t: SV_TIME });
    const room = new LiveRoom(online, 'guest', code, me);
    room._listen();
    // 受け入れられるまで待つ
    const ok = await new Promise((res) => {
      const timer = setTimeout(() => res(false), timeout);
      room.on((ev) => { if (ev === 'accepted') { clearTimeout(timer); res(true); } if (ev === 'rejected') { clearTimeout(timer); res('full'); } });
    });
    if (ok !== true) { room.close(false); throw new FireError(ok === 'full' ? 'full' : 'timeout'); }
    return room;
  }

  // クイック対戦: 待っている人がいれば入り、いなければ自分が待つ
  static async quick(online, me, bestOf) {
    if (!online.synced) await online.sync();
    const lobby = await db.get('lobby') || {};
    const now = online.now();
    const list = Object.keys(lobby).map(k => ({ code: k, ...lobby[k] }))
      .filter(e => typeof e.t === 'number' && now - e.t < 45000 && (e.b || 1) === bestOf)
      .sort((a, b) => a.t - b.t);
    for (const e of Object.keys(lobby)) if (typeof lobby[e].t === 'number' && now - lobby[e].t > 5 * 60 * 1000) db.del(`lobby/${e}`).catch(() => {});
    for (const e of list.slice(0, 4)) {
      try { return await LiveRoom.join(online, me, e.code, 6000); } catch (err) { if (err.kind === 'permission') throw err; }
    }
    return LiveRoom.create(online, me, bestOf, true);
  }

  _listen() {
    this.sub = listen(this.path, (d) => this._onData(d), (kind) => {
      if (kind === 'permission') { this.state = 'error'; this.error = 'permission'; this.emit('error', 'permission'); }
      else this.emit('net', kind);
    });
    this.beatTimer = setInterval(() => this._beat(), 5000);
    this._beat();
  }

  _beat() {
    if (this.closed || (!this.accepted && this.role === 'guest')) return;
    db.patch(`${this.path}/${this.role}`, { beat: SV_TIME }).catch(() => {});
    if (this.quick && this.role === 'host' && this.state === 'waiting') db.patch(`lobby/${this.code}`, { t: SV_TIME }).catch(() => {});
  }

  g() { return (this.data && this.data.g && this.data.g['g' + this.gm]) || {}; }
  r(n) { const g = this.g(); return (g.r && g.r['r' + n]) || {}; }
  seedOf(n) { const s = this.data && this.data.seed ? this.data.seed['g' + this.gm] : 1; return ((s >>> 0) + Math.imul(n, 0x9E3779B9)) >>> 0; }
  arenaOf(n) {
    const a = toArr(this.data && this.data.arenas ? this.data.arenas['g' + this.gm] : null);
    const v = a.length ? a[(n - 1) % a.length] : 0;
    return Number.isInteger(v) && v >= 0 && v < N_ARENAS ? v : 0;
  }
  opponentInfo() { const o = this.data && this.data[this.other]; return o ? { name: cleanName(o.n) || 'ななし' } : null; }

  _onData(d) {
    if (this.closed) return;
    this.data = d;
    if (!d) { this.state = 'left'; this.emit('left'); return; }
    if (d.gm && d.gm !== this.gm) {
      this.gm = d.gm; this.uploaded = {}; this.launched = {}; this.results = {}; this.planFor = 0; this.planEnd = 0; this.planInfo = null;
      if (this.state !== 'left' && this.state !== 'error') this.state = 'paired';
      this.emit('rematch');
    }
    // ── 参加の受け入れ ──
    if (this.role === 'host' && !d.guest && d.joins) {
      const keys = Object.keys(d.joins).sort();
      const j = d.joins[keys[0]];
      if (j && j.id) {
        db.patch(this.path, { guest: { id: String(j.id), n: cleanName(j.n) || 'ななし' } }).catch(() => {});
        if (this.quick) db.del(`lobby/${this.code}`).catch(() => {});
      }
    }
    if (this.role === 'guest' && !this.accepted && d.guest) {
      if (d.guest.id === this.online.pid) {
        this.accepted = true;
        db.patch(`${this.path}/guest`, { n: this.me.name, beat: SV_TIME }).catch(() => {});
        this.emit('accepted');
      } else { this.emit('rejected'); return; }
    }
    if (d.guest && this.state === 'waiting') { this.state = 'paired'; this.emit('paired'); }
    if (this.role === 'guest' && this.accepted && this.state === 'connecting') { this.state = 'paired'; this.emit('paired'); }
    if (d.bye && d.bye[this.other] && !this.opLeft) { this.opLeft = true; this.emit('opleft'); }
    // ── スタンプ ──
    if (d.em) for (const k in d.em) {
      if (this.emoSeen.has(k)) continue;
      this.emoSeen.add(k);
      const e = d.em[k];
      if (e && e.s !== this.side && this.emoHandler && typeof e.t === 'number' && this.online.now() - e.t < 8000) this.emoHandler({ side: e.s, e: e.e | 0 });
    }
    if (!d.guest || !this.accepted) return;
    // ── ラウンドの進行 ──
    const n = this.currentRound();
    if (n > 0) this._progress(n);
  }

  // いまのラウンド番号（結果がそろっていない最初のラウンド）
  currentRound() {
    for (let n = 1; n <= 5; n++) {
      if (!this.results[n]) return n;
    }
    return 0;
  }

  wins() {
    const w = { host: 0, guest: 0 };
    for (const n in this.results) {
      const r = this.results[n];
      if (r.winner === 0) w.host++; else if (r.winner === 1) w.guest++;
    }
    return w;
  }

  need() { return Math.ceil(this.bestOf / 2); }

  isOver() {
    const w = this.wins();
    const played = Object.keys(this.results).length;
    return w.host >= this.need() || w.guest >= this.need() || played >= this.bestOf;
  }

  _progress(n) {
    const R = this.r(n);
    // 1回戦は自動で脳を出す。2回戦からは作戦タイムのあと
    if (n === 1 && !this.uploaded[1]) this.submit(1, this.me.wire, this.me.deck);
    // ホスト: 両方そろったら開始時刻を決める
    if (this.role === 'host' && R.rd && R.rd.host && R.rd.guest && !R.st) {
      db.put(`${this.path}/g/g${this.gm}/r/r${n}/st`, Math.round(this.online.now() + START_DELAY)).catch(() => {});
    }
    // ホスト: 作戦タイムを過ぎても相手が出さなければ、前の脳で出す
    if (this.role === 'host' && n > 1) {
      const P = this.r(n - 1);
      if (P.pl && this.online.now() > P.pl + 12000 && R.rd && R.rd.host && !R.rd.guest && P.b && P.b.guest) {
        db.patch(`${this.path}/g/g${this.gm}/r/r${n}`, { b: { ...(R.b || {}), guest: P.b.guest }, rd: { host: true, guest: true } }).catch(() => {});
      }
    }
    // 開始時刻と2つの脳がそろったら試合
    if (R.st && R.b && R.b.host && R.b.guest && !this.launched[n]) {
      let a, b;
      try { a = fromWire(R.b.host.w); b = fromWire(R.b.guest.w); } catch (e) { this.state = 'error'; this.error = 'brain'; this.emit('error', 'brain'); return; }
      this.launched[n] = true;
      this.state = 'battle';
      this.emit('battle', {
        n, start: R.st, seed: this.seedOf(n), arena: this.arenaOf(n),
        host: { net: a, name: cleanName(R.b.host.nm) || 'ロボ', deck: cleanDeck(R.b.host.dk), steps: Number(R.b.host.st) || 0, player: cleanName(this.data.host && this.data.host.n) },
        guest: { net: b, name: cleanName(R.b.guest.nm) || 'ロボ', deck: cleanDeck(R.b.guest.dk), steps: Number(R.b.guest.st) || 0, player: cleanName(this.data.guest && this.data.guest.n) },
      });
    }
    // 作戦タイムの開始（直前のラウンドの結果のあと）
    if (n > 1 && !this.uploaded[n]) {
      const P = this.r(n - 1);
      if (P.pl && this.planFor !== n) { this.planFor = n; this.planEnd = P.pl; this.state = 'plan'; this.emit('plan', { n, end: P.pl, rival: this.rivalBrain(n - 1) }); }
    }
  }

  rivalBrain(n) {
    const R = this.r(n);
    const b = R.b && R.b[this.other];
    return b ? { wire: b.w, name: cleanName(b.nm), deck: cleanDeck(b.dk), steps: Number(b.st) || 0 } : null;
  }

  // 脳を出す（n回戦用）
  submit(n, wire, deck) {
    if (this.uploaded[n]) return;
    this.uploaded[n] = true;
    const base = `${this.path}/g/g${this.gm}/r/r${n}`;
    db.put(`${base}/b/${this.role}`, { w: wire, dk: deck, st: this.me.steps, nm: this.me.bot })
      .then(() => db.put(`${base}/rd/${this.role}`, true))
      .catch((e) => { this.uploaded[n] = false; this.emit('error', e.kind || 'network'); });
  }

  // 試合が終わった（各端末で計算した結果）
  roundEnded(n, res) {
    this.results[n] = { winner: res.winner, scores: res.scores, hash: res.hash };
    const base = `${this.path}/g/g${this.gm}/r/r${n}`;
    db.put(`${base}/rs/${this.role}`, { s: res.scores, h: res.hash }).catch(() => {});
    if (this.isOver()) { this.state = 'over'; this.emit('over', this.wins()); return; }
    // ホストが作戦タイムを決める
    this.planEnd = Math.round(this.online.now() + PLAN_MS);
    if (this.role === 'host') db.put(`${base}/pl`, this.planEnd).catch(() => {});
    this.state = 'between';
    this.emit('between', n);
  }

  // 相手の結果と一致したか
  checkSync(n) {
    const R = this.r(n);
    if (!R.rs || !R.rs.host || !R.rs.guest) return null;
    return R.rs.host.h === R.rs.guest.h;
  }

  sendEmote(e) {
    db.post(`${this.path}/em`, { s: this.side, e, t: SV_TIME }).catch(() => {});
  }

  // もう一回
  async voteRematch() {
    await db.put(`${this.path}/rm/g${this.gm}/${this.role}`, true).catch(() => {});
  }

  checkRematch() {
    const rm = this.data && this.data.rm && this.data.rm['g' + this.gm];
    if (rm && rm.host && rm.guest && this.role === 'host' && !this._rmDone) {
      this._rmDone = true;
      const ng = this.gm + 1;
      db.patch(this.path, {
        gm: ng, [`seed/g${ng}`]: randomSeed(), [`arenas/g${ng}`]: pickArenas(), [`g/g${this.gm}`]: null,
      }).then(() => { this._rmDone = false; }).catch(() => { this._rmDone = false; });
    }
    return rm || {};
  }

  // 相手が生きているか
  opponentAlive() {
    if (!this.data) return true;
    const o = this.data[this.other];
    if (!o || typeof o.beat !== 'number') return true;
    return this.online.now() - o.beat < STALE;
  }

  close(sayBye = true) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.beatTimer);
    if (this.sub) this.sub.close();
    if (sayBye) {
      db.put(`${this.path}/bye/${this.role}`, SV_TIME).catch(() => {});
      if (this.quick && this.role === 'host') db.del(`lobby/${this.code}`).catch(() => {});
      if (this.role === 'host' && (!this.data || !this.data.guest)) db.del(this.path).catch(() => {});
    }
  }
}

// Firebase は配列を {0:..,1:..} で返すこともある
function toArr(a) {
  if (Array.isArray(a)) return a;
  if (a && typeof a === 'object') return Object.keys(a).sort((x, y) => x - y).map(k => a[k]);
  return [];
}

function pickArenas() {
  const a = [];
  while (a.length < 3) {
    const x = Math.floor(Math.random() * N_ARENAS);
    if (!a.includes(x)) a.push(x);
  }
  return a;
}

// 古いルームのそうじ（ときどき、少しだけ）
async function gc(online) {
  if (Math.random() > 0.3) return;
  const keys = await db.get('rooms', 'shallow=true');
  if (!keys) return;
  const ks = Object.keys(keys);
  for (let i = 0; i < Math.min(4, ks.length); i++) {
    const k = ks[Math.floor(Math.random() * ks.length)];
    const t = await db.get(`rooms/${k}/t`);
    if (typeof t === 'number' && online.now() - t > 3 * 3600 * 1000) await db.del(`rooms/${k}`);
  }
}

export { RULES_HINT, dbUrl };
