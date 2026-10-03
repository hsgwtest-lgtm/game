// ゲームの進み具合（ロボ・デッキ・解放・設定）。localStorage に JSON で保存。
// 脳そのものは IndexedDB（brain/ロボID, snap/ロボID/手数）。

import { lsGet, lsSet, idbGet, idbSet, idbDel } from '../core/store.js';
import { STARTER_DECK, cleanDeck, CARD } from '../sim/rewards.js';
import { Net, ARCH, packQ8, unpackQ8 } from '../ml/net.js';
import { LEAGUE } from './league.js';
import { randomSeed } from '../core/rng.js';

const KEY = 'nuribots/save/v1';
export const BOT_NAMES = ['ヌリー', 'ペンタ', 'ローラ', 'ドット', 'ピクル', 'ハケまる', 'ブラシ', 'カラコ', 'ヌリオン', 'ペンキー', 'ロロ', 'ベタ'];
export const MAX_BOTS = 3;
export const ALBUM_MAX = 14;
export const MILESTONES = [10e3, 30e3, 60e3, 100e3, 200e3, 400e3, 700e3, 1e6, 1.5e6, 2e6, 3e6, 5e6, 8e6, 12e6];
export const ENT_LEVELS = [0.003, 0.01, 0.03];   // 好奇心: ひかえめ / ふつう / つよめ

export function uid() { return randomSeed().toString(36) + Date.now().toString(36).slice(-4); }

export function newBot(name, color = 0) {
  return {
    id: uid(), name, color,
    deck: STARTER_DECK.map(d => ({ ...d })),
    steps: 0, iters: 0, episodes: 0, trainSec: 0,
    hist: [],          // 学習の記録 {s:手数, w:勝率, sh:床の割合, r:ごほうび, e:迷い}
    album: [],         // 成長アルバム {key, steps, w, sh, label, t, g(盤面base64)}
    rec: { w: 0, l: 0, d: 0 },
    train: { opps: ['koro'], arenas: [0], ent: 1, speed: 1 },
    radar: null,
    created: Date.now(),
  };
}

function defaults() {
  return {
    v: 1,
    profile: { id: uid() + uid(), name: '' },
    bots: [newBot(BOT_NAMES[0])],
    active: 0,
    league: { cleared: {}, tries: {} },
    unlock: { cards: ['paint', 'steal', 'win', 'idle'], arenas: [0], slots: 4, title: '' },
    settings: { sfx: true, music: true, outline: true, bspeed: 1, policy: true },
    seen: {},
    online: { bestOf: 3, ghostKey: '', ghostBot: '' },
    created: Date.now(),
  };
}

export class Game {
  constructor() {
    this.s = defaults();
    this._timer = null;
  }

  load() {
    const d = lsGet(KEY, null);
    if (d && d.v === 1) {
      const base = defaults();
      this.s = { ...base, ...d, profile: { ...base.profile, ...d.profile }, unlock: { ...base.unlock, ...d.unlock },
        settings: { ...base.settings, ...d.settings }, league: { ...base.league, ...d.league }, online: { ...base.online, ...d.online } };
      if (!Array.isArray(this.s.bots) || !this.s.bots.length) this.s.bots = base.bots;
      for (const b of this.s.bots) {
        b.deck = cleanDeck(b.deck);
        b.train = { ...newBot('').train, ...b.train };
        b.hist = b.hist || []; b.album = b.album || []; b.rec = b.rec || { w: 0, l: 0, d: 0 };
      }
      if (this.s.active >= this.s.bots.length) this.s.active = 0;
    }
    return this;
  }

  save(now = false) {
    clearTimeout(this._timer);
    if (now) { lsSet(KEY, this.s); return; }
    this._timer = setTimeout(() => lsSet(KEY, this.s), 300);
  }

  get bot() { return this.s.bots[this.s.active]; }
  get unlock() { return this.s.unlock; }
  get settings() { return this.s.settings; }
  get profile() { return this.s.profile; }

  cardUnlocked(id) { return this.s.unlock.cards.includes(id); }
  arenaUnlocked(id) { return this.s.unlock.arenas.includes(id); }

  // デッキに入っているカードのうち、解放済みのものだけ
  usableDeck(bot = this.bot) {
    return cleanDeck(bot.deck.filter(d => this.cardUnlocked(d.id)), this.s.unlock.slots);
  }

  addBot(name) {
    if (this.s.bots.length >= MAX_BOTS) return null;
    const used = new Set(this.s.bots.map(b => b.name));
    const nm = name || BOT_NAMES.find(n => !used.has(n)) || 'ロボ' + (this.s.bots.length + 1);
    const b = newBot(nm, this.s.bots.length % 2);
    this.s.bots.push(b);
    this.s.active = this.s.bots.length - 1;
    this.save();
    return b;
  }

  async deleteBot(i) {
    const b = this.s.bots[i];
    if (!b || this.s.bots.length <= 1) return;
    await idbDel('brain/' + b.id);
    for (const a of b.album) await idbDel(a.key);
    this.s.bots.splice(i, 1);
    if (this.s.active >= this.s.bots.length) this.s.active = this.s.bots.length - 1;
    this.save();
  }

  async resetBrain(bot) {
    await idbDel('brain/' + bot.id);
    for (const a of bot.album) await idbDel(a.key);
    bot.steps = 0; bot.iters = 0; bot.episodes = 0; bot.trainSec = 0; bot.msLast = 0;
    bot.hist = []; bot.album = []; bot.radar = null; bot.evs = null; bot.rec = { w: 0, l: 0, d: 0 };
    this.save();
  }

  // ── 脳 ──
  async loadBrainRecord(bot = this.bot) {
    const r = await idbGet('brain/' + bot.id);
    if (!r || !r.p || r.p.length !== new Net(ARCH).size) return null;
    return r;
  }
  async loadNet(bot = this.bot) {
    const r = await this.loadBrainRecord(bot);
    if (!r) return null;
    const net = new Net(ARCH);
    net.p.set(r.p);
    return net;
  }
  async saveBrain(bot, m) {
    if (!m || !m.params) return;
    await idbSet('brain/' + bot.id, { p: new Float32Array(m.params), m: m.adam ? m.adam.m : null, v: m.adam ? m.adam.v : null, t: m.adam ? m.adam.t : 0, rs: m.rs || null });
  }

  // ── アルバム ──
  async addSnapshot(bot, params, info) {
    const net = new Net(ARCH);
    net.p.set(params);
    const key = `snap/${bot.id}/${info.steps}`;
    await idbSet(key, packQ8(net));
    bot.album = bot.album.filter(a => a.key !== key);
    bot.album.push({ key, steps: info.steps, w: info.w ?? 0, sh: info.sh ?? 0, label: info.label || '', t: Date.now(), g: info.g || '' });
    bot.album.sort((a, b) => a.steps - b.steps);
    // 多すぎたら、最初と最後を残して間をまびく
    while (bot.album.length > ALBUM_MAX) {
      const i = 1 + Math.floor((bot.album.length - 2) / 2);
      const rm = bot.album.splice(i, 1)[0];
      if (rm) await idbDel(rm.key);
    }
    this.save();
  }
  async loadSnapshot(a) {
    const q = await idbGet(a.key);
    if (!q) return null;
    try { return unpackQ8(q); } catch (e) { return null; }
  }

  // 学習の記録を足す（多すぎたら半分にまびく）
  pushHist(bot, pt) {
    bot.hist.push(pt);
    if (bot.hist.length > 300) bot.hist = bot.hist.filter((_, i) => i % 2 === 0 || i === bot.hist.length - 1);
  }

  // ── リーグ ──
  leagueIndex() {
    let i = 0;
    while (i < LEAGUE.length && this.s.league.cleared[LEAGUE[i].id]) i++;
    return i;
  }

  // 勝ったら解放。新しく手に入ったものの一覧を返す
  clearLeague(id) {
    const L = LEAGUE.find(l => l.id === id);
    if (!L) return [];
    const got = [];
    if (this.s.league.cleared[id]) return got;
    this.s.league.cleared[id] = Date.now();
    const u = L.unlock || {};
    for (const c of u.cards || []) if (!this.s.unlock.cards.includes(c)) { this.s.unlock.cards.push(c); got.push({ type: 'card', id: c }); }
    for (const a of u.arenas || []) if (!this.s.unlock.arenas.includes(a)) { this.s.unlock.arenas.push(a); got.push({ type: 'arena', id: a }); }
    if (u.slots && u.slots > this.s.unlock.slots) { this.s.unlock.slots = u.slots; got.push({ type: 'slots', n: u.slots }); }
    if (u.title) { this.s.unlock.title = u.title; got.push({ type: 'title', name: u.title }); }
    this.save();
    return got;
  }

  // オンライン用に全部見せる時の、使えるカード数
  get slots() { return this.s.unlock.slots; }
}

export function gridToB64(grid) {
  // 2bit × 256マス = 64バイト
  const out = new Uint8Array(64);
  for (let i = 0; i < 256; i++) out[i >> 2] |= (Math.min(3, grid[i]) & 3) << ((i & 3) * 2);
  let s = '';
  for (let i = 0; i < 64; i++) s += String.fromCharCode(out[i]);
  return btoa(s);
}
export function b64ToGrid(b64) {
  const g = new Uint8Array(256);
  try {
    const s = atob(b64);
    for (let i = 0; i < 256; i++) g[i] = (s.charCodeAt(i >> 2) >> ((i & 3) * 2)) & 3;
  } catch (e) { /* 空 */ }
  return g;
}

export { CARD };
