// Canlı Olay Haritası — tamamen statik; veriyi data/events.js, data/places.js ve data/manual.json'dan okur.
// Harita: MapLibre GL (küre görünümü), OpenFreeMap altlığı.

// Her kategori: renkli daire içinde beyaz simge (Tabler Icons).
const CATS = {
  massviolence: { icon: 'skull',         color: '#6d28d9' },
  airstrike:    { icon: 'drone',         color: '#dc2626' },
  bombing:      { icon: 'bomb',          color: '#be185d' },
  artillery:    { icon: 'rocket',        color: '#ea580c' },
  clash:        { icon: 'swords',        color: '#b45309' },
  attack:       { icon: 'crosshair',     color: '#ca8a04' },
  security:     { icon: 'shield-lock',   color: '#1d4ed8' },
  military:     { icon: 'helmet',        color: '#15803d' },
  protest:      { icon: 'speakerphone',  color: '#0f766e' },
  politics:     { icon: 'building-bank', color: '#0284c7' },
  earthquake:   { icon: 'activity',      color: '#78716c' },
  disaster:     { icon: 'alert-triangle', color: '#e8590c' },
  launch:       { icon: 'rocket',        color: '#4c6ef5' },
  news:         { icon: 'news',          color: '#64748b' },
  manual:       { icon: 'pin',           color: '#111827' },
};
// Afetlerde simge türe, renk GDACS alarm düzeyine göre.
const DISASTER_ICONS = { flood: 'ripple', cyclone: 'tornado', volcano: 'volcano', wildfire: 'flame', drought: 'sun-high' };
const ALERT_COLORS = { green: '#2f9e44', orange: '#e8590c', red: '#c92a2a' };
const ISS_CAT = { icon: 'satellite', color: '#7048e8' };
const NEWS_LANGS = ['tr', 'ku', 'ckb', 'ar', 'fa', 'en', 'other'];
const REFRESH_MS = 60e3;

// Haber akışındaki konu filtreleri.
const CONFLICT = new Set(['massviolence', 'airstrike', 'bombing', 'artillery', 'clash', 'attack', 'security', 'military']);
const KURD_WORDS = /kurd|kürt|kurdî|kurdistan|kürdistan|rojava|rojhilat|başûr|pkk|ypg|ypj|sdg|sdf|hsd|peşmerge|pêşmerge|peshmerga|کورد|كرد|كورد/i;
// Kürt nüfusun yoğun olduğu bölgeler, kaba kutular: [güney, batı, kuzey, doğu]
const KURD_AREAS = [[36.5, 37.5, 40.3, 44.8], [34.3, 42.3, 37.4, 46.4], [35.8, 36.5, 37.4, 42.4], [33.5, 44, 37.9, 48.5]];
const TOPICS = {
  all: () => true,
  conflict: (e) => CONFLICT.has(e.cat),
  politics: (e) => e.cat === 'politics',
  kurdistan: (e) => KURD_AREAS.some(([s, w, n, east]) => e.lat >= s && e.lat <= n && e.lon >= w && e.lon <= east) ||
    KURD_WORDS.test(`${e.title} ${e.text || ''}`),
  disaster: (e) => e.cat === 'earthquake' || e.cat === 'disaster',
  space: (e) => e.cat === 'launch',
};

// Üstteki bölge sekmeleri: [[batı, güney], [doğu, kuzey]]
const REGIONS = {
  all: [[25, 24], [63, 42.5]],
  tr: [[25.6, 35.8], [44.9, 42.2]],
  kurdistan: [[37.5, 34], [48, 39.5]],
  sy: [[35.6, 32.2], [42.5, 37.4]],
  iq: [[38.7, 29], [48.7, 37.4]],
  ir: [[44, 25], [63.4, 39.8]],
  il: [[34.1, 29.4], [36.7, 34.7]],
  cy: [[32.2, 34.5], [34.7, 35.8]],
};

const $ = (id) => document.getElementById(id);
// Paylaşılabilir bağlantılar: ?lang=ckb&region=kurdistan&topic=kurdistan gibi.
const PARAMS = new URLSearchParams(location.search);
const state = {
  events: [], updated: 0, fresh: 0, off: new Set(), q: '', hours: 6, inView: true, activeId: null,
  lang: pickLang(), newsLang: 'all', region: null, panel: null, topic: 'all',
};
const byId = new Map();
const PLACES = window.__PLACES__ || [];
let T = I18N[state.lang];

function pickLang() {
  if (I18N[PARAMS.get('lang')]) return PARAMS.get('lang');
  try { const saved = localStorage.getItem('lang'); if (I18N[saved]) return saved; } catch {}
  const nav = (navigator.language || 'tr').toLowerCase();
  if (nav.startsWith('ckb')) return 'ckb';
  if (nav.startsWith('ku') || nav.startsWith('kmr')) return 'ku';
  if (nav.startsWith('ar')) return 'ar';
  if (nav.startsWith('en')) return 'en';
  return 'tr';
}

// ---------------- Harita ----------------

// Arapça harfli (Soranî, Arapça, Farsça) harita yazılarının doğru birleşmesi için.
try { maplibregl.setRTLTextPlugin('https://cdn.jsdelivr.net/npm/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js', true); } catch {}

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/dark',
  center: [40, 36.5],
  zoom: 3.4,
  minZoom: 0.8,
  maxZoom: 17,
  attributionControl: {
    compact: true,
    customAttribution: 'GDELT, USGS, GDACS, Launch Library, wheretheiss.at, RSS, Telegram',
  },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'bottom-left');
map.addControl(new maplibregl.GlobeControl(), 'bottom-left');

// Sol alttaki katman düğmesi ve panel düzenini sıfırlama düğmesi.
class ButtonsControl {
  onAdd() {
    const el = document.createElement('div');
    el.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    el.innerHTML = `<button id="layersBtn" type="button"><i class="ti ti-stack-2"></i></button>
      <button id="resetPanelsBtn" type="button"><i class="ti ti-layout-off"></i></button>`;
    el.querySelector('#layersBtn').addEventListener('click', () => togglePanel('layers'));
    el.querySelector('#resetPanelsBtn').addEventListener('click', resetPanels);
    return el;
  }
  onRemove() {}
}
map.addControl(new ButtonsControl(), 'bottom-left');

// Harita üzerindeki şehir/ülke adlarını seçili dilde göster; o dilde ad yoksa sıradaki dile düş.
const MAP_LANGS = { tr: ['tr', 'en'], ku: ['ku', 'kmr', 'en'], ckb: ['ckb', 'ar', 'fa'], en: ['en'], ar: ['ar', 'en'] };
function applyMapLanguage() {
  const style = map.getStyle();
  if (!style) return;
  const field = ['coalesce', ...MAP_LANGS[state.lang].map((l) => ['get', `name:${l}`]), ['get', 'name']];
  for (const l of style.layers) {
    if (l.type === 'symbol' && /^(place_|water_name)/.test(l.id)) {
      try { map.setLayoutProperty(l.id, 'text-field', field); } catch {}
    }
  }
}

let mapReady = false;
map.on('style.load', () => {
  map.setProjection({ type: 'globe' });
  // Uzaktan bakınca Dünya'nın çevresinde ince bir atmosfer parıltısı.
  try { map.setSky({ 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] }); } catch {}
  // Hazır koyu tema neredeyse siyah; kara, deniz, sınır ve yazıları biraz açıyoruz.
  const set = (id, prop, val) => { if (map.getLayer(id)) map.setPaintProperty(id, prop, val); };
  set('background', 'background-color', '#262c37');
  set('water', 'fill-color', '#121821');
  set('waterway', 'line-color', '#121821');
  set('boundary_country_z0-4', 'line-color', '#6b7385');
  set('boundary_country_z5-', 'line-color', '#6b7385');
  set('boundary_state', 'line-color', '#454c5a');
  for (const l of map.getStyle().layers) if (l.id.startsWith('place_')) set(l.id, 'text-color', '#a9b0bf');
  applyMapLanguage();
  addEventLayers();
  mapReady = true;
  render();
});
// Kaynak bilgisi haritanın altını kaplamasın: başta kapalı, (i) düğmesiyle açılır.
map.once('load', () => document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));

// Olaylar tek bir GeoJSON kaynağında; yakın olaylar sayılı kümeler hâlinde birleşir.
function addEventLayers() {
  map.addSource('events', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 42, clusterMaxZoom: 8 });
  map.addLayer({
    id: 'clusters', type: 'circle', source: 'events', filter: ['has', 'point_count'],
    paint: {
      'circle-color': 'rgba(229,72,77,0.88)',
      'circle-radius': ['step', ['get', 'point_count'], 13, 10, 16, 50, 20, 200, 25],
      'circle-stroke-width': 6,
      'circle-stroke-color': 'rgba(229,72,77,0.28)',
    },
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'events', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: 'active', type: 'circle', source: 'events', filter: ['==', ['get', 'id'], ''],
    paint: { 'circle-radius': 21, 'circle-color': 'rgba(255,255,255,0.18)', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  });
  map.addLayer({
    id: 'points', type: 'symbol', source: 'events', filter: ['!', ['has', 'point_count']],
    layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
  });

  map.on('click', 'points', (ev) => {
    const e = byId.get(ev.features[0].properties.id);
    if (e) select(e, false);
  });
  map.on('click', 'clusters', async (ev) => {
    const f = ev.features[0];
    const zoom = await map.getSource('events').getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.2 });
  });
  for (const id of ['points', 'clusters']) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
}

// Haritadaki simgeler: renkli daire + beyaz Tabler simgesi, tuvalde bir kez çizilip haritaya eklenir.
const glyphCache = new Map();
function glyphOf(name) {
  if (!glyphCache.has(name)) {
    const i = document.createElement('i');
    i.className = `ti ti-${name}`;
    i.style.cssText = 'position:absolute;visibility:hidden';
    document.body.appendChild(i);
    glyphCache.set(name, getComputedStyle(i, '::before').content.replace(/^["']|["']$/g, ''));
    i.remove();
  }
  return glyphCache.get(name);
}
function ensureIcon(icon, color) {
  const key = `${icon}|${color}`;
  if (map.hasImage(key)) return key;
  const r = 2, size = 30 * r;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 4 * r;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 12 * r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2 * r;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `${15 * r}px tabler-icons`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyphOf(icon), size / 2, size / 2 + r);
  map.addImage(key, ctx.getImageData(0, 0, size, size), { pixelRatio: r });
  return key;
}

// Aynı noktadaki olaylar (ör. şehir merkezi) üst üste binmesin diye küçük bir çembere dağıtılır.
function spread(list) {
  const groups = new Map();
  for (const e of list) {
    const k = `${e.lat.toFixed(3)},${e.lon.toFixed(3)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const pos = new Map();
  for (const g of groups.values()) {
    g.forEach((e, i) => {
      if (g.length === 1) { pos.set(e.id, [e.lon, e.lat]); return; }
      const ring = 0.012 * Math.sqrt(g.length);
      const a = (i / g.length) * Math.PI * 2;
      pos.set(e.id, [e.lon + ring * Math.cos(a), e.lat + ring * Math.sin(a)]);
    });
  }
  return pos;
}

function renderMarkers(list) {
  if (!mapReady) return;
  const pos = spread(list);
  map.getSource('events').setData({
    type: 'FeatureCollection',
    features: list.map((e) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: pos.get(e.id) },
      properties: { id: e.id, icon: ensureIcon(iconOf(e), colorOf(e)) },
    })),
  });
}

// Uluslararası Uzay İstasyonu: tarayıcı 10 saniyede bir anlık konumunu çeker (wheretheiss.at, ücretsiz, anahtarsız).
let iss = null;
const issEl = document.createElement('div');
issEl.className = 'ico iss';
issEl.style.background = ISS_CAT.color;
issEl.innerHTML = '<i class="ti ti-satellite"></i>';
issEl.addEventListener('click', (ev) => { ev.stopPropagation(); openInfo('iss'); });
const issMarker = new maplibregl.Marker({ element: issEl });
async function updateIss() {
  if (state.off.has('iss')) { issMarker.remove(); return; }
  try {
    iss = await (await fetch('https://api.wheretheiss.at/v1/satellites/25544')).json();
    issMarker.setLngLat([iss.longitude, iss.latitude]).addTo(map);
    if (infoOpenFor === 'iss') openInfo('iss');
  } catch {}
}

// ---------------- Yardımcılar ----------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cat = (e) => CATS[e.cat] || CATS.news;
const iconOf = (e) => DISASTER_ICONS[e.sub] || cat(e).icon;
const colorOf = (e) => ALERT_COLORS[e.alert] || cat(e).color;
const icoHtml = (e) => `<div class="ico" style="background:${colorOf(e)}"><i class="ti ti-${iconOf(e)}"></i></div>`;
const imgHtml = (src, cls) => `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
const newsLangOf = (e) => (NEWS_LANGS.includes(e.lang) ? e.lang : 'other');

function placeName(e) {
  const names = e.pid != null ? PLACES[e.pid] : null;
  if (!names) return e.place || '';
  return names[PLACE_INDEX[state.lang]] || names[1] || names[0];
}

function ago(t) {
  const m = Math.round((Date.now() - t) / 60e3);
  if (m < 1) return T.now;
  if (m < 60) return T.min(m);
  const h = Math.floor(m / 60);
  return h < 24 ? T.hour(h) : T.day(Math.floor(h / 24));
}

// Fırlatmalar ileri tarihli: "2 gün 5 saat sonra" gibi geri sayım gösterilir.
function untilText(t) {
  const m = Math.max(0, Math.round((t - Date.now()) / 60e3));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return T.inTime(d ? `${d} ${T.dayWord} ${h} ${T.hourWord}` : h ? `${h} ${T.hourWord} ${m % 60} ${T.minWord}` : `${m} ${T.minWord}`);
}
const whenOf = (e) => (e.cat === 'launch' ? (e.t > Date.now() ? untilText(e.t) : T.launched) : ago(e.t));
const catLabel = (e) => (e.cat === 'disaster' ? `${T.subs[e.sub] || T.cats.disaster} · ${T.alerts[e.alert] || ''}` : T.cats[e.cat] || '');

// Başlık seçili dilde: haberin kendi dili buysa özgün başlık, değilse hazır çeviri, o da yoksa özgün başlık.
const isTranslated = (e) => e.lang !== state.lang && !!e.tt?.[state.lang];
const titleOf = (e) => (isTranslated(e) ? e.tt[state.lang] : e.title);
const origNote = (e) => (isTranslated(e) ? T.orig(T.langs[newsLangOf(e)] || '') : '');

function translateLink(e) {
  if (e.lang === state.lang || isTranslated(e) || e.cat === 'launch') return '';
  const url = `https://translate.google.com/?sl=auto&tl=${state.lang}&text=${encodeURIComponent(e.title)}&op=translate`;
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${T.translate}</a>`;
}

function sourceLink(e) {
  return e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.src || T.source)}</a>` : esc(e.src || '');
}

// ---------------- Bilgi paneli ----------------

let infoOpenFor = null;
function infoHtml(e) {
  return `${e.img ? imgHtml(e.img, 'info-img') : ''}
    <div class="info-cat">${icoHtml(e)}<span>${esc(catLabel(e))}</span></div>
    <h3 class="info-title" dir="auto">${esc(titleOf(e))}</h3>
    ${isTranslated(e) ? `<div class="info-orig" dir="auto"><b>${esc(origNote(e))}:</b> ${esc(e.title)}</div>` : ''}
    ${e.text ? `<p class="info-text" dir="auto">${esc(e.text.slice(0, 600))}${e.text.length > 600 ? '…' : ''}</p>` : ''}
    <dl class="info-facts">
      <dt><i class="ti ti-map-pin"></i></dt><dd>${esc(placeName(e))}</dd>
      <dt><i class="ti ti-clock"></i></dt><dd>${whenOf(e)}</dd>
      <dt><i class="ti ti-world"></i></dt><dd>${sourceLink(e)}${translateLink(e) ? ' · ' + translateLink(e) : ''}</dd>
      <dt><i class="ti ti-gps"></i></dt><dd>${e.lat.toFixed(3)}°, ${e.lon.toFixed(3)}°</dd>
    </dl>
    ${e.url ? `<a class="info-open" href="${esc(e.url)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> ${T.source}</a>` : ''}`;
}
function issHtml() {
  if (!iss) return T.cats.iss;
  return `<div class="info-cat"><div class="ico" style="background:${ISS_CAT.color}"><i class="ti ti-satellite"></i></div><span>${T.cats.iss}</span></div>
    <dl class="info-facts">
      <dt><i class="ti ti-arrow-up"></i></dt><dd>${T.altitude}: ${Math.round(iss.altitude)} km</dd>
      <dt><i class="ti ti-gauge"></i></dt><dd>${T.speed}: ${Math.round(iss.velocity).toLocaleString(T.locale)} km/h</dd>
      <dt><i class="ti ti-gps"></i></dt><dd>${iss.latitude.toFixed(2)}°, ${iss.longitude.toFixed(2)}°</dd>
    </dl>`;
}
function openInfo(target) {
  infoOpenFor = target === 'iss' ? 'iss' : target.id;
  $('infoTitle').textContent = T.details;
  $('infoBody').innerHTML = target === 'iss' ? issHtml() : infoHtml(target);
  const panel = $('infoPanel');
  panel.hidden = false;
  panel.classList.remove('collapsed');
}
function closeInfo() {
  $('infoPanel').hidden = true;
  infoOpenFor = null;
  setActive(null);
}

// Bir olayı seç: haritada işaretle, bilgi panelini aç, listede göster; istenirse haritayı oraya götür.
function select(e, fly) {
  setActive(e.id);
  openInfo(e);
  if (fly) map.flyTo({ center: [e.lon, e.lat], zoom: Math.max(map.getZoom(), 9), duration: 1200 });
}
function setActive(id) {
  state.activeId = id;
  if (mapReady) map.setFilter('active', ['==', ['get', 'id'], id || '']);
  document.querySelectorAll('.item.active').forEach((el) => el.classList.remove('active'));
  const el = id && document.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
  if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

// ---------------- Sürüklenebilir paneller ----------------
// Başlıktan tutup taşınır, kenara yaklaşınca kenara yapışır, katlanır; yerleri tarayıcıda hatırlanır.

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

function placePanel(panel, left, top) {
  const box = panel.parentElement.getBoundingClientRect();
  const w = panel.offsetWidth, h = panel.querySelector('.panel-head').offsetHeight;
  const SNAP = 16, M = 8;
  left = Math.min(Math.max(left, M), box.width - w - M);
  top = Math.min(Math.max(top, M), box.height - h - M);
  if (left < SNAP + M) left = M;
  if (box.width - (left + w) < SNAP + M) left = box.width - w - M;
  if (top < SNAP + M) top = M;
  panel.style.inset = 'auto';
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function makePanel(panel) {
  const head = panel.querySelector('.panel-head');
  const saved = store.get(`panel:${panel.id}`);
  if (saved?.collapsed) panel.classList.add('collapsed');
  const restore = () => { if (saved?.left != null && !panel.hidden) placePanel(panel, saved.left, saved.top); };
  new MutationObserver(restore).observe(panel, { attributes: true, attributeFilter: ['hidden'] });

  head.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.panel-btn')) return;
    const start = panel.getBoundingClientRect();
    const box = panel.parentElement.getBoundingClientRect();
    const dx = ev.clientX - start.left, dy = ev.clientY - start.top;
    head.setPointerCapture(ev.pointerId);
    panel.classList.add('dragging');
    const move = (m) => placePanel(panel, m.clientX - box.left - dx, m.clientY - box.top - dy);
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      panel.classList.remove('dragging');
      const r = panel.getBoundingClientRect();
      store.set(`panel:${panel.id}`, { left: r.left - box.left, top: r.top - box.top, collapsed: panel.classList.contains('collapsed') });
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });

  head.addEventListener('click', (ev) => {
    const act = ev.target.closest('.panel-btn')?.dataset.act;
    if (act === 'collapse') {
      panel.classList.toggle('collapsed');
      store.set(`panel:${panel.id}`, { ...(store.get(`panel:${panel.id}`) || {}), collapsed: panel.classList.contains('collapsed') });
    }
    if (act === 'close') panel.id === 'infoPanel' ? closeInfo() : togglePanel('layers');
  });
}

function resetPanels() {
  for (const p of document.querySelectorAll('.panel')) {
    store.del(`panel:${p.id}`);
    p.removeAttribute('style');
    p.classList.remove('collapsed');
  }
}

// ---------------- Filtreler ve liste ----------------

// Zaman aralığı son veri güncellemesine göre hesaplanır; veri eskiyse harita yine boş kalmaz.
function sinceMs() {
  return (state.updated || Date.now()) - state.hours * 3600e3;
}

function inRange() {
  const since = sinceMs();
  return state.events.filter((e) => e.t >= since && (state.newsLang === 'all' || newsLangOf(e) === state.newsLang));
}

function filtered() {
  const q = state.q.toLowerCase();
  return inRange().filter((e) => !state.off.has(e.cat) && TOPICS[state.topic](e) &&
    (!q || `${e.title} ${titleOf(e)} ${e.text || ''} ${placeName(e)} ${e.place || ''} ${e.src || ''}`.toLowerCase().includes(q)));
}

function renderTopics() {
  $('topics').innerHTML = Object.keys(TOPICS).map((k) =>
    `<button class="${state.topic === k ? 'active' : ''}" data-topic="${k}">${T.topics[k]}</button>`).join('');
}

// Katmanlar paneli: her kategori için açma/kapama kutusu ve olay sayısı.
function renderLayers() {
  const counts = {};
  for (const e of inRange()) counts[e.cat] = (counts[e.cat] || 0) + 1;
  const row = (k, c, n) =>
    `<label class="layer"><input type="checkbox" data-cat="${k}" ${state.off.has(k) ? '' : 'checked'}>
      <span class="ico sm" style="background:${c.color}"><i class="ti ti-${c.icon}"></i></span>${T.cats[k]}<span class="n">${n}</span></label>`;
  $('chips').innerHTML = Object.entries(CATS).filter(([k]) => counts[k]).map(([k, c]) => row(k, c, counts[k])).join('') +
    row('iss', ISS_CAT, '');
}

function renderList(list) {
  const b = mapReady ? map.getBounds() : null;
  // Fırlatmalar dünyanın her yerinde ve ileri tarihli: sadece "Uzay" konusunda, en yakını üstte listelenir.
  const shown = state.topic === 'space'
    ? list.slice().sort((x, y) => x.t - y.t)
    : list.filter((e) => e.cat !== 'launch' && (!state.inView || !b || b.contains([e.lon, e.lat])));
  $('status').textContent = [
    T.listed(shown.length),
    state.updated ? `${T.updated}: ${ago(state.updated)}` : T.noData,
    state.fresh ? T.fresh(state.fresh) : '',
  ].filter(Boolean).join(' · ');
  $('list').innerHTML = shown.slice(0, 400).map((e) => `
    <li class="item ${e.id === state.activeId ? 'active' : ''} ${e.isNew ? 'new' : ''}" data-id="${esc(e.id)}">
      <div class="head">
        ${icoHtml(e)}
        <span class="when">${whenOf(e)}</span>
        ${e.url ? `<a class="src" href="${esc(e.url)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i>${T.source}</a>` : ''}
      </div>
      <div class="row">
        <div class="title" dir="auto" ${isTranslated(e) ? `title="${esc(e.title)}"` : ''}>${e.isNew ? `<span class="badge">${T.badge}</span>` : ''}${esc(titleOf(e))}</div>
        ${e.img ? imgHtml(e.img, 'thumb') : ''}
      </div>
      <div class="meta">${esc(placeName(e))} · ${esc(e.src || '')}${e.cat === 'disaster' ? ' · ' + esc(catLabel(e)) : ''}${origNote(e) ? ' · ' + esc(origNote(e)) : ''}${translateLink(e) ? ' · ' + translateLink(e) : ''}</div>
    </li>`).join('');
}

function render() {
  const list = filtered();
  renderLayers();
  renderMarkers(list);
  renderList(list);
  if (infoOpenFor && infoOpenFor !== 'iss' && byId.has(infoOpenFor)) openInfo(byId.get(infoOpenFor));
}

function renderRegions() {
  $('regions').innerHTML = Object.keys(REGIONS).map((k) =>
    `<button class="region ${state.region === k ? 'active' : ''}" data-region="${k}">${T.regions[k]}</button>`).join('');
}

// Sağ sütundaki Dil / Zaman sekmeleri ve harita üstündeki Katmanlar paneli.
function togglePanel(name) {
  state.panel = state.panel === name ? null : name;
  $('langPanel').hidden = state.panel !== 'lang';
  $('timePanel').hidden = state.panel !== 'time';
  $('layersPanel').hidden = state.panel !== 'layers';
  $('layersBtn')?.classList.toggle('active', state.panel === 'layers');
  for (const b of document.querySelectorAll('.ftab')) b.classList.toggle('active', (b.dataset.panel || null) === state.panel);
}

function renderPanels() {
  $('uiLangs').innerHTML = Object.entries(I18N).map(([k, v]) =>
    `<button data-lang="${k}" class="${k === state.lang ? 'active' : ''}">${v.name}</button>`).join('');
  $('ranges').innerHTML = [1, 6, 24, 48].map((h) =>
    `<button data-hours="${h}" class="${h === state.hours ? 'active' : ''}">${T.range(h)}</button>`).join('');
  $('newsLang').innerHTML = `<option value="all">${T.all}</option>` +
    NEWS_LANGS.map((l) => `<option value="${l}">${T.langs[l]}</option>`).join('');
  $('newsLang').value = state.newsLang;
}

// Arayüz dilini uygula: metinler, yön (sağdan sola), tarih, harita adları.
function applyLanguage() {
  T = I18N[state.lang];
  const root = document.documentElement;
  root.lang = state.lang;
  root.dir = T.dir;
  document.title = T.title;
  $('brandText').textContent = T.title;
  $('search').placeholder = T.search;
  // Tarayıcılar Kürtçe ay adlarını bilmediği için Kurmancî ve Soranî'de ay adları i18n.js'den gelir.
  const d = new Date();
  let today;
  if (T.months) today = `${d.getDate()} ${T.months[d.getMonth()]} ${d.getFullYear()}`;
  else {
    try { today = new Intl.DateTimeFormat(T.locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d); }
    catch { today = d.toLocaleDateString(); }
  }
  $('today').textContent = today;
  for (const [id, key] of [['tabFeed', 'feed'], ['tabLang', 'lang'], ['tabTime', 'time'], ['tabLayers', 'layers']]) {
    $(id).querySelector('span').textContent = T.tabs[key];
  }
  $('layersTitle').textContent = T.tabs.layers;
  $('infoTitle').textContent = T.details;
  $('layersBtn')?.setAttribute('title', T.tabs.layers);
  $('resetPanelsBtn')?.setAttribute('title', T.resetPanels);
  $('inViewLabel').textContent = T.inView;
  $('newsLangLabel').textContent = T.newsLang;
  renderRegions();
  renderPanels();
  renderTopics();
  applyMapLanguage();
  render();
}

// ---------------- Veri ----------------

async function loadJson(url) {
  try {
    const r = await fetch(`${url}?v=${Date.now()}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Olaylar <script> ile yüklenir: dosyaya çift tıklayıp açınca (file://) da çalışır.
function loadEvents() {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `data/events.js?v=${Date.now()}`;
    s.onload = () => { s.remove(); resolve(window.__EVENTS__ || null); };
    s.onerror = () => { s.remove(); resolve(null); };
    document.head.appendChild(s);
  });
}

async function load() {
  const [auto, manual] = await Promise.all([loadEvents(), loadJson('data/manual.json')]);
  const extra = (manual?.events || []).map((e, i) => ({
    id: 'm' + i, cat: 'manual', src: '', ...e, t: new Date(e.time ?? e.t).getTime(),
  }));
  const launches = (auto?.launches || []).map((l) => ({
    id: l.id, cat: 'launch', kind: 'launch', t: l.net, lat: l.lat, lon: l.lon, title: l.name,
    place: l.place, src: l.provider, img: l.img, text: l.pad, lang: 'en',
  }));
  const events = [...extra, ...(auto?.events || []), ...launches].sort((a, b) => b.t - a.t);
  // İlk yüklemeden sonra gelen olaylar "YENİ" olarak işaretlenir.
  const first = !state.events.length;
  const before = new Map(state.events.map((e) => [e.id, e]));
  let fresh = 0;
  for (const e of events) {
    e.isNew = !first && (!before.has(e.id) || before.get(e.id).isNew);
    if (e.isNew) fresh++;
  }
  state.events = events;
  byId.clear();
  for (const e of events) byId.set(e.id, e);
  state.updated = auto?.updated || 0;
  state.fresh = fresh;
  render();
}

// ---------------- Olay dinleyicileri ----------------

$('uiLangs').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-lang]');
  if (!b) return;
  state.lang = b.dataset.lang;
  try { localStorage.setItem('lang', state.lang); } catch {}
  applyLanguage();
});
$('ranges').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-hours]');
  if (!b) return;
  state.hours = +b.dataset.hours;
  renderPanels();
  render();
});
$('regions').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-region]');
  if (!b) return;
  state.region = b.dataset.region;
  renderRegions();
  map.fitBounds(REGIONS[state.region], { padding: 30, duration: 1200 });
});
document.querySelector('.feed-tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('.ftab');
  if (b) togglePanel(b.dataset.panel || null);
});
$('chips').addEventListener('change', (ev) => {
  const k = ev.target.dataset.cat;
  if (!k) return;
  ev.target.checked ? state.off.delete(k) : state.off.add(k);
  if (k === 'iss') updateIss();
  render();
});
$('topics').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-topic]');
  if (!b) return;
  state.topic = b.dataset.topic;
  renderTopics();
  render();
  // Fırlatma rampaları dünyanın her yerinde: Uzay seçilince küre bütün olarak gösterilir.
  if (state.topic === 'space') map.flyTo({ center: [20, 25], zoom: 1.2, duration: 1200 });
});
$('list').addEventListener('click', (ev) => {
  if (ev.target.closest('a')) return;
  const li = ev.target.closest('.item');
  const e = li && byId.get(li.dataset.id);
  if (e) select(e, true);
});
let typing;
$('search').addEventListener('input', (ev) => { clearTimeout(typing); typing = setTimeout(() => { state.q = ev.target.value.trim(); render(); }, 200); });
$('newsLang').addEventListener('change', (ev) => { state.newsLang = ev.target.value; render(); });
$('inView').addEventListener('change', (ev) => { state.inView = ev.target.checked; renderList(filtered()); });
$('toggleFeed').addEventListener('click', () => { $('feed').classList.toggle('hidden'); map.resize(); });
map.on('moveend', () => { if (state.inView) renderList(filtered()); });
window.addEventListener('resize', () => {
  for (const p of document.querySelectorAll('.panel')) if (p.style.left) placePanel(p, parseFloat(p.style.left), parseFloat(p.style.top));
});

// ---------------- Başlangıç ----------------

makePanel($('infoPanel'));
makePanel($('layersPanel'));
if (TOPICS[PARAMS.get('topic')]) state.topic = PARAMS.get('topic');
if (REGIONS[PARAMS.get('region')]) {
  state.region = PARAMS.get('region');
  map.fitBounds(REGIONS[state.region], { padding: 30, duration: 0 });
} else if (state.topic === 'space') {
  map.jumpTo({ center: [20, 25], zoom: 1.2 });
}
if (['lang', 'time', 'layers'].includes(PARAMS.get('panel'))) togglePanel(PARAMS.get('panel'));
// Simgeler haritaya Tabler yazı tipinden çizildiği için önce yazı tipinin yüklenmesi beklenir.
document.fonts.load('16px tabler-icons').finally(() => {
  applyLanguage();
  load();
  updateIss();
  setInterval(load, REFRESH_MS);
  setInterval(updateIss, 10000);
});
