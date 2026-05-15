'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const LS_KEY       = 'nazca_tracks';
const STEPS_PER_KM = 1300;
const BODY_WEIGHT  = 60;   // kg (spec value)
const REPLAY_SPEED = 1000; // 1000× real-time
const REPLAY_MIN   = 50;   // ms
const REPLAY_MAX   = 600;  // ms

const GPS_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15000
};

// Per-user colors for Global mode
const USER_COLORS = {
  'Yamada':    '#ff6b6b',
  'Suzuki':    '#ffd93d',
  'Tanaka':    '#6bcb77',
  'Nakamura':  '#4fc3f7',
  'Sato':      '#ce93d8'
};
const COLOR_POOL   = ['#ff6b6b','#ffd93d','#6bcb77','#4fc3f7','#ce93d8','#ff8a65','#80deea'];
const MY_COLOR     = '#63d2ff';
const REC_COLOR    = '#f87171';

// ─── Mock global data (stub – swap for fetch() call to replace MOCK_GLOBAL) ──
// To wire up a real backend: replace `getGlobalTracks()` body with
//   const res = await fetch('/api/tracks'); return res.json();
const MOCK_GLOBAL = [
  {
    id: 'g1', title: '上野公園の鶴', user: 'Yamada', date: '2025-05-08',
    path: [
      [35.7146, 139.7731, 1746648000000],
      [35.7162, 139.7751, 1746648120000],
      [35.7181, 139.7743, 1746648240000],
      [35.7192, 139.7721, 1746648360000],
      [35.7183, 139.7699, 1746648480000],
      [35.7163, 139.7689, 1746648600000],
      [35.7143, 139.7698, 1746648720000],
      [35.7131, 139.7719, 1746648840000],
      [35.7140, 139.7741, 1746648960000],
      [35.7146, 139.7731, 1746649080000]
    ],
    stats: { distance: 1.8, calories: 108 }
  },
  {
    id: 'g2', title: '渋谷の星形', user: 'Suzuki', date: '2025-05-10',
    path: [
      [35.6595, 139.7004, 1746835200000],
      [35.6615, 139.7024, 1746835360000],
      [35.6605, 139.7054, 1746835520000],
      [35.6575, 139.7034, 1746835680000],
      [35.6555, 139.7044, 1746835840000],
      [35.6565, 139.7014, 1746836000000],
      [35.6545, 139.6994, 1746836160000],
      [35.6575, 139.7004, 1746836320000],
      [35.6595, 139.6984, 1746836480000],
      [35.6615, 139.7004, 1746836640000],
      [35.6595, 139.7004, 1746836800000]
    ],
    stats: { distance: 2.2, calories: 132 }
  },
  {
    id: 'g3', title: '浅草スパイラル', user: 'Tanaka', date: '2025-05-12',
    path: [
      [35.7148, 139.7967, 1746921600000],
      [35.7160, 139.7978, 1746921750000],
      [35.7172, 139.7970, 1746921900000],
      [35.7175, 139.7957, 1746922050000],
      [35.7168, 139.7945, 1746922200000],
      [35.7156, 139.7940, 1746922350000],
      [35.7144, 139.7947, 1746922500000],
      [35.7138, 139.7959, 1746922650000],
      [35.7143, 139.7972, 1746922800000],
      [35.7153, 139.7978, 1746922950000],
      [35.7162, 139.7974, 1746923100000],
      [35.7166, 139.7964, 1746923250000]
    ],
    stats: { distance: 1.4, calories: 84 }
  },
  {
    id: 'g4', title: '新宿トライアングル', user: 'Nakamura', date: '2025-05-13',
    path: [
      [35.6896, 139.6985, 1747008000000],
      [35.6916, 139.7015, 1747008200000],
      [35.6936, 139.7045, 1747008400000],
      [35.6956, 139.7015, 1747008600000],
      [35.6966, 139.6985, 1747008800000],
      [35.6946, 139.6955, 1747009000000],
      [35.6926, 139.6945, 1747009200000],
      [35.6906, 139.6965, 1747009400000],
      [35.6896, 139.6985, 1747009600000]
    ],
    stats: { distance: 3.1, calories: 186 }
  },
  {
    id: 'g5', title: '銀座ウェーブ', user: 'Sato', date: '2025-05-14',
    path: [
      [35.6710, 139.7650, 1747094400000],
      [35.6725, 139.7670, 1747094520000],
      [35.6710, 139.7690, 1747094640000],
      [35.6725, 139.7710, 1747094760000],
      [35.6710, 139.7730, 1747094880000],
      [35.6725, 139.7750, 1747095000000],
      [35.6710, 139.7770, 1747095120000],
      [35.6725, 139.7790, 1747095240000],
      [35.6710, 139.7810, 1747095360000],
      [35.6725, 139.7830, 1747095480000],
      [35.6710, 139.7850, 1747095600000]
    ],
    stats: { distance: 2.4, calories: 144 }
  }
];

// ─── Application state ────────────────────────────────────────────────────────
let map;
let currentMode    = 'record';
let watchId        = null;
let isRecording    = false;
let currentPath    = [];
let currentPolyline = null;
let currentMarker   = null;
let lastSavedId     = null;

// Layers owned by gallery / global mode
let galleryLayers = [];
let globalLayers  = [];

// Selected tracks for detail view
let selectedGalleryTrack = null;
let selectedGlobalTrack  = null;

// Replay state
let replayTimer    = null;
let replayPolyline = null;

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

function init() {
  initMap();
  bindNav();
  bindRecordPanel();
  bindGalleryPanel();
  bindGlobalPanel();
  document.getElementById('btn-stop-replay').addEventListener('click', stopReplay);
  switchMode('record');
}

// ─── Map initialisation ───────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { center: [35.681, 139.767], zoom: 13, zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function bindNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });
}

function switchMode(mode) {
  if (isRecording && mode !== 'record') {
    showToast('記録中は他のモードに切り替えられません', 'error');
    return;
  }

  stopReplay();
  currentMode = mode;

  // Nav highlight
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );

  // Panel visibility
  document.getElementById('panel-record').classList.toggle('hidden', mode !== 'record');
  document.getElementById('panel-gallery').classList.toggle('hidden', mode !== 'gallery');
  document.getElementById('panel-global').classList.toggle('hidden', mode !== 'global');

  // Header label
  const LABELS = { record: '記録モード', gallery: 'マイ鑑賞', global: 'グローバル鑑賞' };
  document.getElementById('header-mode-label').textContent = LABELS[mode] || '';

  // Manage map layers
  galleryLayers.forEach(l => map.removeLayer(l)); galleryLayers = [];
  globalLayers.forEach(l => map.removeLayer(l));  globalLayers = [];

  if (mode === 'record') {
    // Re-display active recording polyline/marker if any
    if (currentPolyline && !map.hasLayer(currentPolyline)) map.addLayer(currentPolyline);
    if (currentMarker   && !map.hasLayer(currentMarker))   map.addLayer(currentMarker);
  } else {
    // Hide recording layers while browsing other modes
    if (currentPolyline && map.hasLayer(currentPolyline)) map.removeLayer(currentPolyline);
    if (currentMarker   && map.hasLayer(currentMarker))   map.removeLayer(currentMarker);
  }

  if (mode === 'gallery') {
    showGalleryListView();
    renderGalleryList();
  } else if (mode === 'global') {
    showGlobalListView();
    renderGlobalList();
    renderGlobalMap();
  }
}

// ─── Mode A — Record ──────────────────────────────────────────────────────────
function bindRecordPanel() {
  document.getElementById('btn-start').addEventListener('click', startRecording);
  document.getElementById('btn-stop').addEventListener('click', stopRecording);
  document.getElementById('btn-save').addEventListener('click', confirmSave);
  document.getElementById('btn-post').addEventListener('click', () => {
    if (lastSavedId) postTrack(lastSavedId);
  });
}

function startRecording() {
  if (!navigator.geolocation) {
    showToast('このデバイスはGPSに対応していません', 'error');
    return;
  }

  isRecording = true;
  currentPath = [];
  lastSavedId = null;

  // Remove previous recording layers
  if (currentPolyline) { map.removeLayer(currentPolyline); currentPolyline = null; }
  if (currentMarker)   { map.removeLayer(currentMarker);   currentMarker   = null; }

  // UI
  setRecordUI('recording');
  updateStats();
  showToast('GPS取得中…', 'info');

  watchId = navigator.geolocation.watchPosition(onGPSUpdate, onGPSError, GPS_OPTIONS);
}

function onGPSUpdate(pos) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  const ts = pos.timestamp;

  currentPath.push([lat, lng, ts]);

  if (!currentPolyline) {
    currentPolyline = L.polyline([[lat, lng]], {
      color: REC_COLOR, weight: 4, opacity: 0.92
    }).addTo(map);
    map.setView([lat, lng], 17);
    showToast('GPS取得完了', 'success');
  } else {
    currentPolyline.addLatLng([lat, lng]);
    map.panTo([lat, lng]);
  }

  // Current-position marker
  if (currentMarker) {
    currentMarker.setLatLng([lat, lng]);
  } else {
    const icon = L.divIcon({
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#f87171;border:2px solid #fff;box-shadow:0 0 8px rgba(248,113,113,0.8)"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7], className: ''
    });
    currentMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
  }

  // GPS accuracy badge
  const badge = document.getElementById('gps-accuracy');
  badge.textContent = `精度 ±${Math.round(accuracy)} m`;
  badge.classList.remove('hidden');

  updateStats();
}

function onGPSError(err) {
  const MSGS = { 1: 'GPS利用が許可されていません', 2: 'GPS位置を取得できません', 3: 'GPSタイムアウト' };
  showToast(MSGS[err.code] || `GPSエラー (${err.code})`, 'error');
}

function stopRecording() {
  if (!isRecording) return;

  isRecording = false;
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }

  document.getElementById('rec-indicator').classList.add('hidden');
  document.getElementById('gps-accuracy').classList.add('hidden');

  if (currentPath.length < 2) {
    showToast('記録が短すぎます（最低2点必要）', 'error');
    setRecordUI('idle');
    currentPath = [];
    if (currentPolyline) { map.removeLayer(currentPolyline); currentPolyline = null; }
    if (currentMarker)   { map.removeLayer(currentMarker);   currentMarker   = null; }
    return;
  }

  setRecordUI('stopped');
}

function confirmSave() {
  const rawTitle = document.getElementById('track-title-input').value.trim();
  const title = rawTitle || `記録 ${new Date().toLocaleDateString('ja-JP')}`;
  saveTrack(title);
}

function saveTrack(title) {
  const dist = calcDistance(currentPath);
  const track = {
    id:     generateId(),
    title,
    path:   [...currentPath],
    stats:  { distance: round2(dist), calories: Math.round(BODY_WEIGHT * dist) },
    date:   new Date().toISOString().slice(0, 10),
    posted: false
  };

  const tracks = getTracks();
  tracks.unshift(track);
  saveTracks(tracks);

  lastSavedId = track.id;
  setRecordUI('saved');
  updateStats();
  showToast(`「${esc(title)}」を保存しました`, 'success');
}

function postTrack(id) {
  const tracks = getTracks();
  const track  = tracks.find(t => t.id === id);
  if (!track) return;

  const btn = document.getElementById('btn-post');
  btn.disabled = true;
  btn.textContent = '送信中…';

  // Simulate upload — replace the setTimeout body with a real fetch() call:
  // fetch('/api/post', { method:'POST', body:JSON.stringify(track), headers:{'Content-Type':'application/json'} })
  //   .then(r => r.json()).then(...).catch(...);
  setTimeout(() => {
    track.posted = true;
    track.user   = 'あなた';
    saveTracks(tracks);
    btn.textContent = '✓ 投稿済み';
    showToast('グローバルに投稿しました！', 'success');
  }, 1200);
}

function updateStats() {
  const dist  = calcDistance(currentPath);
  const steps = Math.round(dist * STEPS_PER_KM);
  const cal   = Math.round(BODY_WEIGHT * dist);

  document.getElementById('stat-dist').textContent  = dist.toFixed(2);
  document.getElementById('stat-steps').textContent = steps.toLocaleString('ja-JP');
  document.getElementById('stat-cal').textContent   = cal;
}

/**
 * Centralise Record-mode UI transitions.
 * States: 'idle' | 'recording' | 'stopped' | 'saved'
 */
function setRecordUI(state) {
  const s  = document.getElementById('btn-start');
  const st = document.getElementById('btn-stop');
  const sv = document.getElementById('btn-save');
  const po = document.getElementById('btn-post');
  const ti = document.getElementById('track-title-row');
  const ri = document.getElementById('rec-indicator');

  // reset all
  [s, st, sv, po].forEach(b => b.classList.add('hidden'));
  ti.classList.add('hidden');
  ri.classList.add('hidden');
  po.disabled = false;

  if (state === 'idle') {
    s.classList.remove('hidden');
  } else if (state === 'recording') {
    st.classList.remove('hidden');
    ri.classList.remove('hidden');
  } else if (state === 'stopped') {
    sv.classList.remove('hidden');
    ti.classList.remove('hidden');
    document.getElementById('track-title-input').value = '';
  } else if (state === 'saved') {
    s.classList.remove('hidden');
    po.classList.remove('hidden');
    po.textContent = '☁ グローバルに投稿';
  }
}

// ─── Mode B — My Gallery ──────────────────────────────────────────────────────
function bindGalleryPanel() {
  document.getElementById('btn-gallery-back').addEventListener('click', () => {
    stopReplay();
    galleryLayers.forEach(l => map.removeLayer(l)); galleryLayers = [];
    selectedGalleryTrack = null;
    showGalleryListView();
    renderGalleryList();
  });

  document.getElementById('btn-gallery-replay').addEventListener('click', () => {
    if (selectedGalleryTrack) startReplay(selectedGalleryTrack.path, MY_COLOR);
  });

  document.getElementById('btn-gallery-delete').addEventListener('click', () => {
    if (!selectedGalleryTrack) return;
    const tracks = getTracks().filter(t => t.id !== selectedGalleryTrack.id);
    saveTracks(tracks);
    galleryLayers.forEach(l => map.removeLayer(l)); galleryLayers = [];
    selectedGalleryTrack = null;
    showGalleryListView();
    renderGalleryList();
    showToast('削除しました', 'info');
  });
}

function showGalleryListView() {
  document.getElementById('gallery-list-view').classList.remove('hidden');
  document.getElementById('gallery-detail-view').classList.add('hidden');
}
function showGalleryDetailView() {
  document.getElementById('gallery-list-view').classList.add('hidden');
  document.getElementById('gallery-detail-view').classList.remove('hidden');
}

function renderGalleryList() {
  const tracks    = getTracks();
  const container = document.getElementById('gallery-list');
  container.innerHTML = '';

  if (tracks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🗺</span>
        <span class="empty-text">保存された記録はありません</span>
        <span class="empty-sub">記録モードで歩いてみましょう</span>
      </div>`;
    return;
  }

  tracks.forEach(track => {
    const item = document.createElement('div');
    item.className = 'track-item';
    item.innerHTML = `
      <div class="track-color-dot" style="background:${MY_COLOR}"></div>
      <div class="track-item-info">
        <div class="track-item-title">${esc(track.title)}</div>
        <div class="track-item-sub">${track.stats.distance} km · ${track.stats.calories} kcal · ${track.date}</div>
      </div>
      <span class="track-item-chevron">›</span>`;
    item.addEventListener('click', () => selectGalleryTrack(track));
    container.appendChild(item);
  });
}

function selectGalleryTrack(track) {
  selectedGalleryTrack = track;

  galleryLayers.forEach(l => map.removeLayer(l)); galleryLayers = [];

  const poly = L.polyline(track.path.map(p => [p[0], p[1]]), {
    color: MY_COLOR, weight: 4, opacity: 0.92
  }).addTo(map);
  galleryLayers.push(poly);
  map.fitBounds(poly.getBounds(), { padding: [30, 30] });

  document.getElementById('gallery-detail-stats').innerHTML =
    `<strong>${esc(track.title)}</strong><br>` +
    `📏 ${track.stats.distance} km &nbsp;` +
    `👣 ${Math.round(track.stats.distance * STEPS_PER_KM).toLocaleString('ja-JP')} 歩 &nbsp;` +
    `🔥 ${track.stats.calories} kcal<br>` +
    `📅 ${track.date}${track.posted ? ' &nbsp;☁ 投稿済み' : ''}`;

  showGalleryDetailView();
}

// ─── Mode C — Global Gallery ──────────────────────────────────────────────────
function bindGlobalPanel() {
  document.getElementById('btn-global-back').addEventListener('click', () => {
    stopReplay();
    globalLayers.forEach(l => map.removeLayer(l)); globalLayers = [];
    selectedGlobalTrack = null;
    showGlobalListView();
    renderGlobalList();
    renderGlobalMap();
  });

  document.getElementById('btn-global-replay').addEventListener('click', () => {
    if (selectedGlobalTrack) {
      const idx   = getGlobalTracks().findIndex(t => t.id === selectedGlobalTrack.id);
      const color = trackColor(selectedGlobalTrack.user, idx);
      startReplay(selectedGlobalTrack.path, color);
    }
  });
}

function showGlobalListView() {
  document.getElementById('global-list-view').classList.remove('hidden');
  document.getElementById('global-detail-view').classList.add('hidden');
}
function showGlobalDetailView() {
  document.getElementById('global-list-view').classList.add('hidden');
  document.getElementById('global-detail-view').classList.remove('hidden');
}

function getGlobalTracks() {
  // Combine mock data with locally-posted tracks.
  // To replace with real API: `return fetch('/api/tracks').then(r => r.json());`
  const posted = getTracks()
    .filter(t => t.posted)
    .map(t => ({ ...t, user: t.user || 'あなた' }));
  return [...MOCK_GLOBAL, ...posted];
}

function renderGlobalList() {
  const tracks    = getGlobalTracks();
  const container = document.getElementById('global-list');
  container.innerHTML = '';

  tracks.forEach((track, i) => {
    const color = trackColor(track.user, i);
    const item  = document.createElement('div');
    item.className = 'track-item';
    item.innerHTML = `
      <div class="track-color-dot" style="background:${color}"></div>
      <div class="track-item-info">
        <div class="track-item-title">${esc(track.title)}</div>
        <div class="track-item-sub">${esc(track.user)} · ${track.stats.distance} km · ${track.date}</div>
      </div>
      <span class="track-item-chevron">›</span>`;
    item.addEventListener('click', () => selectGlobalTrack(track, i));
    container.appendChild(item);
  });
}

function renderGlobalMap() {
  globalLayers.forEach(l => map.removeLayer(l)); globalLayers = [];

  const tracks   = getGlobalTracks();
  const allLatLng = [];

  tracks.forEach((track, i) => {
    const color   = trackColor(track.user, i);
    const latlngs = track.path.map(p => [p[0], p[1]]);
    const poly    = L.polyline(latlngs, { color, weight: 3, opacity: 0.78 }).addTo(map);
    poly.on('click', () => selectGlobalTrack(track, i));
    globalLayers.push(poly);
    allLatLng.push(...latlngs);
  });

  if (allLatLng.length > 0) {
    map.fitBounds(L.latLngBounds(allLatLng), { padding: [20, 20] });
  }
}

function selectGlobalTrack(track, idx) {
  selectedGlobalTrack = track;

  // Highlight selected, dim others
  globalLayers.forEach(l => map.removeLayer(l)); globalLayers = [];

  const tracks = getGlobalTracks();
  tracks.forEach((t, i) => {
    const selected = t.id === track.id;
    const poly = L.polyline(t.path.map(p => [p[0], p[1]]), {
      color:   trackColor(t.user, i),
      weight:  selected ? 5 : 2,
      opacity: selected ? 0.95 : 0.28
    }).addTo(map);
    poly.on('click', () => selectGlobalTrack(t, i));
    globalLayers.push(poly);
  });

  // Fit to selected track
  map.fitBounds(
    L.latLngBounds(track.path.map(p => [p[0], p[1]])),
    { padding: [30, 30] }
  );

  document.getElementById('global-detail-info').innerHTML =
    `<strong>${esc(track.title)}</strong><br>` +
    `👤 ${esc(track.user)} &nbsp; 📅 ${track.date}<br>` +
    `📏 ${track.stats.distance} km &nbsp; 🔥 ${track.stats.calories} kcal`;

  showGlobalDetailView();
}

// ─── Timelapse Replay ─────────────────────────────────────────────────────────
function startReplay(path, color) {
  stopReplay();
  if (!path || path.length === 0) return;

  if (replayPolyline) { map.removeLayer(replayPolyline); replayPolyline = null; }
  replayPolyline = L.polyline([], { color, weight: 5, opacity: 0.95 }).addTo(map);

  map.fitBounds(L.latLngBounds(path.map(p => [p[0], p[1]])), { padding: [30, 30] });
  document.getElementById('replay-overlay').classList.remove('hidden');

  let i = 0;
  const drawn = [];

  function step() {
    if (i >= path.length) {
      document.getElementById('replay-overlay').classList.add('hidden');
      return;
    }
    drawn.push([path[i][0], path[i][1]]);
    replayPolyline.setLatLngs(drawn);
    i++;

    if (i < path.length) {
      let delay = 120;
      if (path[i] && path[i][2] && path[i - 1][2]) {
        delay = Math.max(REPLAY_MIN, Math.min(REPLAY_MAX, (path[i][2] - path[i - 1][2]) / REPLAY_SPEED));
      }
      replayTimer = setTimeout(step, delay);
    } else {
      document.getElementById('replay-overlay').classList.add('hidden');
    }
  }

  step();
}

function stopReplay() {
  if (replayTimer !== null) { clearTimeout(replayTimer); replayTimer = null; }
  if (replayPolyline) { map.removeLayer(replayPolyline); replayPolyline = null; }
  document.getElementById('replay-overlay').classList.add('hidden');
}

// ─── LocalStorage helpers ─────────────────────────────────────────────────────
function getTracks() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}
function saveTracks(tracks) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(tracks)); }
  catch { showToast('保存容量が不足しています', 'error'); }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function calcDistance(path) {
  if (path.length < 2) return 0;
  try {
    const line = turf.lineString(path.map(p => [p[1], p[0]])); // GeoJSON [lng,lat]
    return turf.length(line, { units: 'kilometers' });
  } catch {
    // Haversine fallback
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      total += haversine(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
    }
    return total;
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function trackColor(user, index) {
  return USER_COLORS[user] ?? COLOR_POOL[index % COLOR_POOL.length];
}

function generateId() {
  return 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function round2(n) { return Math.round(n * 100) / 100; }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, type = 'info') {
  const tc    = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  tc.appendChild(toast);
  setTimeout(() => toast.remove(), 3100);
}
