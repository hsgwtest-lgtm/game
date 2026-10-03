// テスト用の Firebase Realtime Database もどき（REST ＋ ストリーミング）
//   node tools/mockdb.mjs [port=8124]
// 使い方: http://127.0.0.1:8123/?db=http://127.0.0.1:8124
import http from 'http';

const PORT = +(process.argv[2] || 8124);
let root = {};
const listeners = new Set();
let pushCounter = 0;
const DENY = new Set((process.env.DENY || '').split(',').filter(Boolean));

function segs(p) { return p.split('/').filter(Boolean); }
function getAt(path) {
  let cur = root;
  for (const k of segs(path)) { if (cur == null || typeof cur !== 'object') return null; cur = cur[k]; }
  return cur === undefined ? null : cur;
}
function resolveSV(v, old) {
  if (Array.isArray(v)) return v.map((x, i) => resolveSV(x, old && old[i]));
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return Date.now();
    if (v['.sv'] && typeof v['.sv'] === 'object' && 'increment' in v['.sv']) return (typeof old === 'number' ? old : 0) + v['.sv'].increment;
    const o = {};
    for (const k in v) { const r = resolveSV(v[k], old && typeof old === 'object' ? old[k] : undefined); if (r !== null && r !== undefined) o[k] = r; }
    return Object.keys(o).length ? o : null;
  }
  return v;
}
function setAt(path, val) {
  const ks = segs(path);
  if (!ks.length) { root = val && typeof val === 'object' ? val : {}; return; }
  let cur = root;
  for (let i = 0; i < ks.length - 1; i++) {
    if (!cur[ks[i]] || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {};
    cur = cur[ks[i]];
  }
  const last = ks[ks.length - 1];
  if (val === null || val === undefined) delete cur[last]; else cur[last] = val;
  // 空になった親を消す
  prune(root);
}
function prune(o) {
  for (const k of Object.keys(o)) {
    if (o[k] && typeof o[k] === 'object') { prune(o[k]); if (!Object.keys(o[k]).length) delete o[k]; }
  }
}
function pushId() {
  const t = Date.now().toString(36).padStart(9, '0');
  return '-' + t + (pushCounter++).toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 8);
}

function notify(path, kind, data) {
  // kind: 'put'（path に data）/ 'patch'（path の子をいくつか）
  for (const l of listeners) {
    const L = l.path;
    const P = '/' + segs(path).join('/');
    const Ls = '/' + segs(L).join('/');
    if (P === Ls || P.startsWith(Ls === '/' ? '/' : Ls + '/')) {
      const rel = '/' + segs(P).slice(segs(Ls).length).join('/');
      send(l.res, kind, { path: rel, data });
    } else if (Ls.startsWith(P === '/' ? '/' : P + '/')) {
      send(l.res, 'put', { path: '/', data: getAt(L) });
    }
  }
}
function send(res, event, obj) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`); } catch (e) { /* closed */ }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (!u.pathname.endsWith('.json')) { res.writeHead(404); res.end('not found'); return; }
  const path = decodeURIComponent(u.pathname.slice(0, -5));
  if ([...DENY].some(d => path.startsWith(d))) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"Permission denied"}'); return; }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const accept = req.headers.accept || '';
    if (req.method === 'GET' && accept.includes('text/event-stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const l = { path, res };
      listeners.add(l);
      send(res, 'put', { path: '/', data: getAt(path) });
      const ka = setInterval(() => { try { res.write('event: keep-alive\ndata: null\n\n'); } catch (e) { /* */ } }, 15000);
      res.on('close', () => { listeners.delete(l); clearInterval(ka); });
      return;
    }
    const json = (code, v) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    let v = null;
    try { v = body ? JSON.parse(body) : null; } catch (e) { return json(400, { error: 'bad json' }); }
    if (req.method === 'GET') {
      let d = getAt(path);
      if (u.searchParams.get('shallow') === 'true' && d && typeof d === 'object') { const o = {}; for (const k in d) o[k] = true; d = o; }
      const lim = u.searchParams.get('limitToLast');
      if (lim && d && typeof d === 'object') { const ks = Object.keys(d).sort().slice(-(+lim)); const o = {}; for (const k of ks) o[k] = d[k]; d = o; }
      return json(200, d);
    }
    if (req.method === 'PUT') {
      const val = resolveSV(v, getAt(path));
      setAt(path, val);
      notify(path, 'put', val);
      return json(200, val);
    }
    if (req.method === 'PATCH') {
      const cur = getAt(path) || {};
      const out = {};
      for (const k in v) {
        const val = resolveSV(v[k], cur && typeof cur === 'object' ? getAt(path + '/' + k) : undefined);
        setAt(path + '/' + k, val);
        out[k] = val;
      }
      notify(path, 'patch', out);
      return json(200, out);
    }
    if (req.method === 'POST') {
      const id = pushId();
      const val = resolveSV(v, null);
      setAt(path + '/' + id, val);
      notify(path + '/' + id, 'put', val);
      return json(200, { name: id });
    }
    if (req.method === 'DELETE') {
      setAt(path, null);
      notify(path, 'put', null);
      return json(200, null);
    }
    json(405, { error: 'method' });
  });
});
server.listen(PORT, '127.0.0.1', () => console.log('mockdb on', PORT));
