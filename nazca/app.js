'use strict';

import { IS_FIREBASE_CONFIGURED, postTrack, subscribeToTracks, deleteTrack } from './firebase.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const LS_KEY       = 'nazca_tracks';
const LS_USER_KEY  = 'nazca_user';
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

// Pre-start location awareness
let locateDot       = null;
let preLocateWatchId = null;

// Bearing lock
let bearingLocked       = false;
let orientationHandler  = null;

// Layers owned by gallery / global mode
let galleryLayers = [];
let globalLayers  = [];

// Global gallery — Firebase subscription handle & track cache
let globalUnsubscribe  = null;
let cachedGlobalTracks = [];
let globalTracksLoaded = false;

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
  initUserName();
  initConfirmDialog();
  switchMode('record');
}

// ─── Map initialisation ───────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [35.681, 139.767], zoom: 13, zoomControl: true,
    rotate: true, touchRotate: true, bearing: 0,
    renderer: L.canvas()
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);
  initMapControls();
  startPreLocate();
}

// ─── Map buttons (N / locate / bearing-lock) — placed in Leaflet's top-left control area ────
function initMapControls() {
  const MapBtnsControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'map-controls-group');
      div.innerHTML =
        '<button id="btn-north"        title="北を上に">N</button>' +
        '<button id="btn-locate"       title="現在地">📍</button>' +
        '<button id="btn-bearing-lock" title="方位固定">🧭</button>';
      L.DomEvent.disableClickPropagation(div);
      return div;
    }
  });
  new MapBtnsControl().addTo(map);
  document.getElementById('btn-north').addEventListener('click', () => {
    if (map.setBearing) map.setBearing(0, { animate: true });
  });
  document.getElementById('btn-locate').addEventListener('click', locateUser);
  document.getElementById('btn-bearing-lock').addEventListener('click', toggleBearingLock);
}

// ─── Pre-start GPS locate ─────────────────────────────────────────────────────
function startPreLocate() {
  if (!navigator.geolocation) return;
  let gotFirst = false;
  preLocateWatchId = navigator.geolocation.watchPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    if (!locateDot) {
      if (!gotFirst) {
        map.setView([lat, lng], 16);
        gotFirst = true;
      }
      locateDot = L.marker([lat, lng], {
        icon: L.divIcon({
          html: '<div style="width:16px;height:16px;border-radius:50%;background:#4fc3f7;border:2px solid #fff;box-shadow:0 0 8px rgba(79,195,247,0.8)"></div>',
          iconSize: [16, 16], iconAnchor: [8, 8], className: ''
        }),
        zIndexOffset: 900,
        interactive: false
      }).addTo(map);
    } else {
      locateDot.setLatLng([lat, lng]);
      if (!gotFirst) {
        map.setView([lat, lng], 16);
        gotFirst = true;
      }
    }
  }, err => {
    console.warn('Pre-locate error:', err.message);
  }, GPS_OPTIONS);
}

function locateUser() {
  // During active recording, pan to the most recent GPS point
  if (isRecording && currentPath.length > 0) {
    const last = currentPath[currentPath.length - 1];
    map.setView([last[0], last[1]], map.getZoom());
    return;
  }
  // Use the pre-locate dot position if available
  if (locateDot) {
    map.setView(locateDot.getLatLng(), map.getZoom());
    return;
  }
  // Fallback: request a fresh one-shot position
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 16);
    }, () => {
      showToast('現在地を取得できません', 'error');
    }, GPS_OPTIONS);
  } else {
    showToast('このデバイスはGPSに対応していません', 'error');
  }
}

// ─── Bearing lock ─────────────────────────────────────────────────────────────
async function toggleBearingLock() {
  if (bearingLocked) {
    bearingLocked = false;
    if (orientationHandler) {
      window.removeEventListener('deviceorientationabsolute', orientationHandler, true);
      window.removeEventListener('deviceorientation', orientationHandler, true);
      orientationHandler = null;
    }
    document.getElementById('btn-bearing-lock').classList.remove('active');
    return;
  }

  // iOS 13+ requires permission
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== 'granted') {
        showToast('コンパスの使用を許可してください', 'error');
        return;
      }
    } catch (e) {
      showToast('コンパスの使用を許可してください', 'error');
      return;
    }
  }

  bearingLocked = true;
  document.getElementById('btn-bearing-lock').classList.add('active');

  orientationHandler = e => {
    let heading = null;
    if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
      heading = e.webkitCompassHeading;
    } else if (e.absolute && e.alpha !== null) {
      heading = (360 - e.alpha) % 360;
    } else if (!e.absolute && e.alpha !== null) {
      heading = (360 - e.alpha) % 360;
    }
    if (heading !== null && map.setBearing) {
      map.setBearing(heading, { animate: false });
    }
  };

  const hasAbsolute = 'ondeviceorientationabsolute' in window;
  if (hasAbsolute) {
    window.addEventListener('deviceorientationabsolute', orientationHandler, true);
  } else {
    window.addEventListener('deviceorientation', orientationHandler, true);
  }
}


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
  exitGlobalMode();

  if (mode === 'record') {
    // Re-display active recording polyline/marker if any
    if (currentPolyline && !map.hasLayer(currentPolyline)) map.addLayer(currentPolyline);
    if (currentMarker   && !map.hasLayer(currentMarker))   map.addLayer(currentMarker);
    // Show locate dot if not recording
    if (!isRecording && locateDot && !map.hasLayer(locateDot)) map.addLayer(locateDot);
  } else {
    // Hide recording layers while browsing other modes
    if (currentPolyline && map.hasLayer(currentPolyline)) map.removeLayer(currentPolyline);
    if (currentMarker   && map.hasLayer(currentMarker))   map.removeLayer(currentMarker);
    // Hide locate dot in other modes
    if (locateDot && map.hasLayer(locateDot)) map.removeLayer(locateDot);
  }

  if (mode === 'gallery') {
    showGalleryListView();
    renderGalleryList();
    renderGalleryMap();
  } else if (mode === 'global') {
    enterGlobalMode();
  }
}

// ─── Mode A — Record ──────────────────────────────────────────────────────────
function bindRecordPanel() {
  document.getElementById('btn-start').addEventListener('click', startRecording);
  document.getElementById('btn-stop').addEventListener('click', stopRecording);
  document.getElementById('btn-resume').addEventListener('click', resumeRecording);
  document.getElementById('btn-save').addEventListener('click', confirmSave);
  document.getElementById('btn-reset').addEventListener('click', resetRecording);
  document.getElementById('btn-record-post').addEventListener('click', postFromRecord);
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

  // Hide locate dot while recording (replaced by red rec marker)
  if (locateDot && map.hasLayer(locateDot)) map.removeLayer(locateDot);

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

  // Restore locate dot
  if (locateDot && !map.hasLayer(locateDot)) map.addLayer(locateDot);

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
    id:        generateId(),
    title,
    path:      [...currentPath],
    stats:     { distance: round2(dist), calories: Math.round(BODY_WEIGHT * dist) },
    date:      new Date().toISOString().slice(0, 10),
    startTime: currentPath[0][2],
    endTime:   currentPath[currentPath.length - 1][2],
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

function resetRecording() {
  // Clear the current track display (the track is already saved)
  currentPath = [];
  lastSavedId = null;
  if (currentPolyline) { map.removeLayer(currentPolyline); currentPolyline = null; }
  if (currentMarker)   { map.removeLayer(currentMarker);   currentMarker   = null; }
  updateStats();
  setRecordUI('idle');
}

async function postFromRecord() {
  if (!lastSavedId) return;

  const tracks = getTracks();
  const track  = tracks.find(t => t.id === lastSavedId);
  if (!track) return;

  const name = getUserName();
  if (!name) {
    showToast('記録タブで名前を入力してから投稿してください', 'error');
    return;
  }

  if (!IS_FIREBASE_CONFIGURED) {
    showToast('Firebase が未設定です。nazca/firebase-config.js を編集してください', 'error');
    return;
  }

  const btn = document.getElementById('btn-record-post');
  btn.disabled = true;
  btn.textContent = '送信中…';

  try {
    await postTrack({ ...track, user: name });
    track.posted = true;
    track.user   = name;
    saveTracks(tracks);
    showToast('グローバルに投稿しました！', 'success');
    btn.textContent = '☁ 投稿済み';
  } catch (e) {
    console.error('postTrack failed:', e);
    showToast('投稿に失敗しました: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '☁ 投稿';
  }
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
  const rv = document.getElementById('btn-resume');
  const sv = document.getElementById('btn-save');
  const rs = document.getElementById('btn-reset');
  const rp = document.getElementById('btn-record-post');
  const ti = document.getElementById('track-title-row');
  const ri = document.getElementById('rec-indicator');

  // reset all
  [s, st, rv, sv, rs, rp].forEach(b => b.classList.add('hidden'));
  ti.classList.add('hidden');
  ri.classList.add('hidden');

  if (state === 'idle') {
    s.classList.remove('hidden');
  } else if (state === 'recording') {
    st.classList.remove('hidden');
    ri.classList.remove('hidden');
  } else if (state === 'stopped') {
    sv.classList.remove('hidden');
    rs.classList.remove('hidden');
    rv.classList.remove('hidden');
    ti.classList.remove('hidden');
    document.getElementById('track-title-input').value = '';
  } else if (state === 'saved') {
    s.classList.remove('hidden');
    rs.classList.remove('hidden');
    rp.classList.remove('hidden');
    rp.disabled = false;
    rp.textContent = '☁ 投稿';
  }
}

function resumeRecording() {
  if (isRecording || currentPath.length === 0) return;
  if (!navigator.geolocation) {
    showToast('このデバイスはGPSに対応していません', 'error');
    return;
  }

  isRecording = true;

  // Hide locate dot while recording
  if (locateDot && map.hasLayer(locateDot)) map.removeLayer(locateDot);

  setRecordUI('recording');
  showToast('GPS取得中…', 'info');

  watchId = navigator.geolocation.watchPosition(onGPSUpdate, onGPSError, GPS_OPTIONS);
}

// ─── Mode B — My Gallery ──────────────────────────────────────────────────────
function bindGalleryPanel() {
  document.getElementById('btn-gallery-back').addEventListener('click', () => {
    stopReplay();
    galleryLayers.forEach(l => map.removeLayer(l)); galleryLayers = [];
    selectedGalleryTrack = null;
    showGalleryListView();
    renderGalleryList();
    renderGalleryMap();
  });

  document.getElementById('btn-gallery-replay').addEventListener('click', () => {
    if (selectedGalleryTrack) startReplay(selectedGalleryTrack.path, MY_COLOR);
  });

  document.getElementById('btn-gallery-post').addEventListener('click', () => {
    if (selectedGalleryTrack) postFromGallery(selectedGalleryTrack.id);
  });

  document.getElementById('btn-gallery-delete').addEventListener('click', () => {
    if (!selectedGalleryTrack) return;
    const tracks = getTracks().filter(t => t.id !== selectedGalleryTrack.id);
    saveTracks(tracks);
    galleryLayers.forEach(l => map.removeLayer(l)); galleryLayers = [];
    selectedGalleryTrack = null;
    showGalleryListView();
    renderGalleryList();
    renderGalleryMap();
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

function renderGalleryMap() {
  galleryLayers.forEach(l => map.removeLayer(l)); galleryLayers = [];

  const tracks = getTracks();
  if (tracks.length === 0) return;

  const allLatLng = [];
  tracks.forEach(track => {
    const latlngs = track.path.map(p => [p[0], p[1]]);
    const poly = L.polyline(latlngs, { color: MY_COLOR, weight: 3, opacity: 0.7 }).addTo(map);
    poly.on('click', () => selectGalleryTrack(track));
    galleryLayers.push(poly);
    allLatLng.push(...latlngs);
  });

  if (allLatLng.length > 0) {
    map.fitBounds(L.latLngBounds(allLatLng), { padding: [20, 20] });
  }
}

function selectGalleryTrack(track) {
  selectedGalleryTrack = track;

  galleryLayers.forEach(l => map.removeLayer(l)); galleryLayers = [];

  const poly = L.polyline(track.path.map(p => [p[0], p[1]]), {
    color: MY_COLOR, weight: 4, opacity: 0.92
  }).addTo(map);
  galleryLayers.push(poly);
  map.fitBounds(poly.getBounds(), { padding: [30, 30] });

  renderGalleryDetailStats(track);
  showGalleryDetailView();
}

function renderGalleryDetailStats(track) {
  document.getElementById('gallery-detail-stats').innerHTML =
    `<div id="gallery-title-line">` +
    `<strong>${esc(track.title)}</strong>` +
    `<button id="btn-edit-title" class="gallery-edit-title-btn">✏ 編集</button>` +
    `</div>` +
    `📏 ${track.stats.distance} km &nbsp;` +
    `👣 ${Math.round(track.stats.distance * STEPS_PER_KM).toLocaleString('ja-JP')} 歩 &nbsp;` +
    `🔥 ${track.stats.calories} kcal<br>` +
    `🕐 ${formatTimeRange(track)}${track.posted ? ' &nbsp;☁ 投稿済み' : ''}`;

  document.getElementById('btn-edit-title').addEventListener('click', () => startEditTitle(track));

  const btn = document.getElementById('btn-gallery-post');
  if (track.posted) {
    btn.classList.add('hidden');
  } else {
    btn.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = '☁ 投稿';
  }
}

function startEditTitle(track) {
  const titleLine = document.getElementById('gallery-title-line');
  if (!titleLine) return;
  const current = track.title;
  titleLine.innerHTML = '';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.maxLength = 30;
  input.autocomplete = 'off';
  input.className = 'gallery-title-input';

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '✓';
  confirmBtn.className = 'gallery-title-confirm-btn';

  titleLine.appendChild(input);
  titleLine.appendChild(confirmBtn);
  input.focus();
  input.select();

  let done = false;
  const commit = () => {
    if (done) return; done = true;
    const newTitle = input.value.trim() || current;
    if (newTitle !== current) {
      const tracks = getTracks();
      const t = tracks.find(t => t.id === track.id);
      if (t) { t.title = newTitle; saveTracks(tracks); }
      track.title = newTitle;
      if (selectedGalleryTrack && selectedGalleryTrack.id === track.id) {
        selectedGalleryTrack.title = newTitle;
      }
      showToast('作品名を変更しました', 'success');
      renderGalleryList();
    }
    renderGalleryDetailStats(track);
  };

  confirmBtn.addEventListener('click', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { done = true; renderGalleryDetailStats(track); }
  });
  input.addEventListener('blur', () => setTimeout(commit, 150));
}

async function postFromGallery(id) {
  const tracks = getTracks();
  const track  = tracks.find(t => t.id === id);
  if (!track) return;

  const name = getUserName();
  if (!name) {
    showToast('記録タブで名前を入力してから投稿してください', 'error');
    return;
  }

  if (!IS_FIREBASE_CONFIGURED) {
    showToast('Firebase が未設定です。nazca/firebase-config.js を編集してください', 'error');
    return;
  }

  const btn = document.getElementById('btn-gallery-post');
  btn.disabled = true;
  btn.textContent = '送信中…';

  try {
    await postTrack({ ...track, user: name });
    track.posted = true;
    track.user   = name;
    saveTracks(tracks);
    selectedGalleryTrack = track;
    renderGalleryDetailStats(track);
    showToast('グローバルに投稿しました！', 'success');
  } catch (e) {
    console.error('postTrack failed:', e);
    showToast('投稿に失敗しました: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '☁ 投稿';
  }
}

// ─── Mode C — Global Gallery ──────────────────────────────────────────────────
function enterGlobalMode() {
  if (IS_FIREBASE_CONFIGURED) {
    cachedGlobalTracks  = [];
    globalTracksLoaded  = false;
  } else {
    // Firebase 未設定時はサンプルデータにローカル投稿済みトラックを合わせて表示
    const posted = getTracks()
      .filter(t => t.posted)
      .map(t => ({ ...t, path: t.path.map(p => [...p]), user: t.user || 'あなた' }));
    cachedGlobalTracks = [...MOCK_GLOBAL, ...posted];
    globalTracksLoaded = true;
  }

  showGlobalListView();
  renderGlobalList();
  renderGlobalMap();

  if (IS_FIREBASE_CONFIGURED) {
    globalUnsubscribe = subscribeToTracks((tracks, err) => {
      if (err) {
        showToast('グローバルデータの取得に失敗しました', 'error');
        return;
      }
      globalTracksLoaded = true;
      cachedGlobalTracks = tracks;
      if (currentMode === 'global') {
        renderGlobalList();
        if (!selectedGlobalTrack) renderGlobalMap();
      }
    });
  }
}

function exitGlobalMode() {
  if (globalUnsubscribe) { globalUnsubscribe(); globalUnsubscribe = null; }
}

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

  document.getElementById('btn-global-delete').addEventListener('click', () => {
    if (!selectedGlobalTrack) return;
    showConfirmDialog(
      'この地上絵をグローバル鑑賞から削除すると、誰も見ることができなくなります。\n本当に削除しますか？',
      () => deleteGlobalTrack(selectedGlobalTrack)
    );
  });
}

async function deleteGlobalTrack(track) {
  if (IS_FIREBASE_CONFIGURED) {
    try {
      await deleteTrack(track.id);
    } catch (e) {
      showToast('削除に失敗しました: ' + e.message, 'error');
      return;
    }
  } else {
    // Remove from mock / locally-posted cache
    cachedGlobalTracks = cachedGlobalTracks.filter(t => t.id !== track.id);
  }

  stopReplay();
  globalLayers.forEach(l => map.removeLayer(l)); globalLayers = [];
  selectedGlobalTrack = null;
  showGlobalListView();
  renderGlobalList();
  renderGlobalMap();
  showToast('削除しました', 'info');
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
  return cachedGlobalTracks;
}

function renderGlobalList() {
  const tracks    = getGlobalTracks();
  const container = document.getElementById('global-list');
  container.innerHTML = '';

  // Firebase 設定済みで未ロードの場合はローディング表示
  if (IS_FIREBASE_CONFIGURED && !globalTracksLoaded) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🌐</span>
        <span class="empty-text">読み込み中…</span>
      </div>`;
    return;
  }

  // Firebase 未設定の場合はサンプルデータ利用中バナーを表示
  if (!IS_FIREBASE_CONFIGURED) {
    const banner = document.createElement('div');
    banner.className = 'firebase-notice';
    banner.textContent = '⚠️ Firebase 未設定 — サンプルデータを表示中';
    container.appendChild(banner);
  }

  if (tracks.length === 0) {
    container.innerHTML += `
      <div class="empty-state">
        <span class="empty-icon">🌐</span>
        <span class="empty-text">まだ投稿がありません</span>
        <span class="empty-sub">マイ鑑賞から地上絵を投稿しましょう</span>
      </div>`;
    return;
  }

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

    // Name + title label at track midpoint
    const midPt = track.path[Math.floor(track.path.length / 2)];
    const label = L.marker([midPt[0], midPt[1]], {
      icon: L.divIcon({
        html: `<div class="track-label" style="border-color:${color};color:${color}">${esc(track.user)}<br>${esc(track.title)}</div>`,
        iconSize: [1, 1], iconAnchor: [0, 0], className: ''
      }),
      interactive: false, zIndexOffset: 200
    }).addTo(map);
    globalLayers.push(label);
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
    const color = trackColor(t.user, i);
    const poly = L.polyline(t.path.map(p => [p[0], p[1]]), {
      color,
      weight:  selected ? 5 : 2,
      opacity: selected ? 0.95 : 0.28
    }).addTo(map);
    poly.on('click', () => selectGlobalTrack(t, i));
    globalLayers.push(poly);

    // Show label for selected track
    if (selected) {
      const midPt = t.path[Math.floor(t.path.length / 2)];
      const label = L.marker([midPt[0], midPt[1]], {
        icon: L.divIcon({
          html: `<div class="track-label" style="border-color:${color};color:${color}">${esc(t.user)}<br>${esc(t.title)}</div>`,
          iconSize: [1, 1], iconAnchor: [0, 0], className: ''
        }),
        interactive: false, zIndexOffset: 300
      }).addTo(map);
      globalLayers.push(label);
    }
  });

  // Fit to selected track
  map.fitBounds(
    L.latLngBounds(track.path.map(p => [p[0], p[1]])),
    { padding: [30, 30] }
  );

  document.getElementById('global-detail-info').innerHTML =
    `<strong>${esc(track.title)}</strong><br>` +
    `👤 ${esc(track.user)} &nbsp; 🕐 ${formatTimeRange(track)}<br>` +
    `📏 ${track.stats.distance} km &nbsp; 🔥 ${track.stats.calories} kcal`;

  showGlobalDetailView();
}

// ─── Timelapse Replay ─────────────────────────────────────────────────────────
function getReplayPolylines() {
  return [...galleryLayers, ...globalLayers].filter(l => l instanceof L.Polyline);
}

function startReplay(path, color) {
  stopReplay();
  if (!path || path.length === 0) return;

  // Hide existing track polylines so the animation builds the picture from scratch
  getReplayPolylines().forEach(l => {
    l._savedOpacity = l.options.opacity;
    l.setStyle({ opacity: 0 });
  });

  if (replayPolyline) { map.removeLayer(replayPolyline); replayPolyline = null; }
  replayPolyline = L.polyline([], { color, weight: 5, opacity: 0.95 }).addTo(map);

  map.fitBounds(L.latLngBounds(path.map(p => [p[0], p[1]])), { padding: [30, 30] });
  document.getElementById('replay-overlay').classList.remove('hidden');

  let i = 0;
  const drawn = [];

  function step() {
    if (i >= path.length) {
      restoreReplayLayers();
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
      restoreReplayLayers();
      document.getElementById('replay-overlay').classList.add('hidden');
    }
  }

  step();
}

function restoreReplayLayers() {
  getReplayPolylines().forEach(l => {
    if (l._savedOpacity !== undefined) {
      l.setStyle({ opacity: l._savedOpacity });
      delete l._savedOpacity;
    }
  });
}

function stopReplay() {
  if (replayTimer !== null) { clearTimeout(replayTimer); replayTimer = null; }
  if (replayPolyline) { map.removeLayer(replayPolyline); replayPolyline = null; }
  restoreReplayLayers();
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

function getUserName() {
  return localStorage.getItem(LS_USER_KEY) || '';
}
function saveUserName(name) {
  localStorage.setItem(LS_USER_KEY, name);
}

function initUserName() {
  const input = document.getElementById('user-name-input');
  input.value = getUserName();
  input.addEventListener('change', () => saveUserName(input.value.trim()));
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function calcDistance(path) {
  if (path.length < 2) return 0;
  try {
    const line = turf.lineString(path.map(p => [p[1], p[0]])); // GeoJSON [lng,lat]
    return turf.length(line, { units: 'kilometers' });
  } catch (err) {
    console.warn('turf.length failed, falling back to Haversine:', err);
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

function formatTimeRange(track) {
  const startTs = track.startTime
    || (track.path && track.path.length > 0 && track.path[0][2] ? track.path[0][2] : null);
  const endTs   = track.endTime
    || (track.path && track.path.length > 0 && track.path[track.path.length - 1][2] ? track.path[track.path.length - 1][2] : null);
  if (!startTs) return track.date || '';
  const d = new Date(startTs);
  const dateStr = d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' });
  const fmtTime = ts => new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return endTs ? `${dateStr} ${fmtTime(startTs)}〜${fmtTime(endTs)}` : `${dateStr} ${fmtTime(startTs)}`;
}

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

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
function initConfirmDialog() {
  document.getElementById('confirm-dialog-cancel').addEventListener('click', closeConfirmDialog);
  document.getElementById('confirm-dialog-overlay').addEventListener('click', closeConfirmDialog);
}

function closeConfirmDialog() {
  document.getElementById('confirm-dialog').classList.add('hidden');
}

function showConfirmDialog(msg, onOk) {
  const dialog = document.getElementById('confirm-dialog');
  document.getElementById('confirm-dialog-msg').textContent = msg;
  dialog.classList.remove('hidden');

  const okBtn = document.getElementById('confirm-dialog-ok');
  const handler = () => {
    okBtn.removeEventListener('click', handler);
    closeConfirmDialog();
    onOk();
  };
  // Remove any previous listener by cloning
  const newOkBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOkBtn, okBtn);
  newOkBtn.addEventListener('click', handler);
}
