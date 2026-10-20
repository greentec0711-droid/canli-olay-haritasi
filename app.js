// Canlı Olay Haritası — tamamen statik; veriyi data/events.js, data/places.js ve data/manual.json'dan okur.

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
  news:         { icon: 'news',          color: '#64748b' },
  manual:       { icon: 'pin',           color: '#111827' },
};
const NEWS_LANGS = ['tr', 'ku', 'ckb', 'ar', 'fa', 'en', 'other'];
const REFRESH_MS = 60e3;

const $ = (id) => document.getElementById(id);
// Paylaşılabilir bağlantılar: ?lang=ckb&region=kurdistan gibi.
const PARAMS = new URLSearchParams(location.search);
const state = {
  events: [], updated: 0, fresh: 0, off: new Set(), q: '', hours: 6, inView: true, activeId: null,
  lang: pickLang(), newsLang: 'all', region: null, panel: null,
};
const markers = new Map();
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

// --- Harita: OpenFreeMap koyu altlık (OpenStreetMap verisi), ücretsiz, anahtarsız, limitsiz ---
const map = L.map('map', { worldCopyJump: true, zoomControl: false, minZoom: 2, maxZoom: 18 }).setView([36.5, 40], 5);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
// Sol alttaki katman düğmesi: kategori katmanlarını açıp kapatan paneli açar.
const LayersButton = L.Control.extend({
  options: { position: 'bottomleft' },
  onAdd() {
    const el = L.DomUtil.create('div', 'leaflet-control layers-btn');
    el.id = 'layersBtn';
    el.innerHTML = '<i class="ti ti-stack-2"></i>';
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.on(el, 'click', () => togglePanel('layers'));
    return el;
  },
});
new LayersButton().addTo(map);
// Arapça harfli (Soranî, Arapça, Farsça) harita yazılarının doğru birleşmesi için.
try { maplibregl.setRTLTextPlugin('https://cdn.jsdelivr.net/npm/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js', true); } catch {}
const base = L.maplibreGL({
  style: 'https://tiles.openfreemap.org/styles/dark',
  attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · GDELT, USGS, RSS, Telegram',
}).addTo(map);
const gl = base.getMaplibreMap();
// Hazır koyu tema neredeyse siyah; kara, deniz, sınır ve yazıları biraz açıyoruz.
gl.on('load', () => {
  const set = (id, prop, val) => { if (gl.getLayer(id)) gl.setPaintProperty(id, prop, val); };
  set('background', 'background-color', '#262c37');
  set('water', 'fill-color', '#121821');
  set('waterway', 'line-color', '#121821');
  set('boundary_country_z0-4', 'line-color', '#6b7385');
  set('boundary_country_z5-', 'line-color', '#6b7385');
  set('boundary_state', 'line-color', '#454c5a');
  for (const l of gl.getStyle().layers) if (l.id.startsWith('place_')) set(l.id, 'text-color', '#a9b0bf');
  applyMapLanguage();
});
// Harita üzerindeki şehir/ülke adlarını seçili dilde göster; o dilde ad yoksa sıradaki dile düş.
const MAP_LANGS = { tr: ['tr', 'en'], ku: ['ku', 'kmr', 'en'], ckb: ['ckb', 'ar', 'fa'], en: ['en'], ar: ['ar', 'en'] };
function applyMapLanguage() {
  const style = gl.getStyle();
  if (!style) return;
  const field = ['coalesce', ...MAP_LANGS[state.lang].map((l) => ['get', `name:${l}`]), ['get', 'name']];
  for (const l of style.layers) {
    if (l.type === 'symbol' && /^(place_|water_name)/.test(l.id)) {
      try { gl.setLayoutProperty(l.id, 'text-field', field); } catch {}
    }
  }
}

const cluster = L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false, spiderfyOnMaxZoom: true });
map.addLayer(cluster);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cat = (e) => CATS[e.cat] || CATS.news;
const icoHtml = (e) => `<div class="ico" style="background:${cat(e).color}"><i class="ti ti-${cat(e).icon}"></i></div>`;
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

function translateLink(e) {
  if (e.lang === state.lang) return '';
  const url = `https://translate.google.com/?sl=auto&tl=${state.lang}&text=${encodeURIComponent(e.title)}&op=translate`;
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${T.translate}</a>`;
}

function sourceLink(e) {
  return e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.src || T.source)}</a>` : esc(e.src || '');
}

function popupHtml(e) {
  return `<div class="pop-title" dir="auto"><i class="ti ti-${cat(e).icon}" style="color:${cat(e).color}"></i> ${esc(e.title)}</div>
    ${e.text ? `<div class="pop-text" dir="auto">${esc(e.text.slice(0, 300))}${e.text.length > 300 ? '…' : ''}</div>` : ''}
    <div class="pop-meta">${esc(placeName(e))} · ${ago(e.t)} · ${T.cats[e.cat] || ''}</div>
    <div class="pop-meta">${T.source}: ${sourceLink(e)} ${translateLink(e) ? '· ' + translateLink(e) : ''}</div>`;
}

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
  return inRange().filter((e) => !state.off.has(e.cat) &&
    (!q || `${e.title} ${e.text || ''} ${placeName(e)} ${e.place || ''} ${e.src || ''}`.toLowerCase().includes(q)));
}

// Katmanlar paneli: her kategori için açma/kapama kutusu ve olay sayısı.
function renderLayers() {
  const counts = {};
  for (const e of inRange()) counts[e.cat] = (counts[e.cat] || 0) + 1;
  $('chips').innerHTML = Object.entries(CATS).filter(([k]) => counts[k]).map(([k, c]) =>
    `<label class="layer"><input type="checkbox" data-cat="${k}" ${state.off.has(k) ? '' : 'checked'}>
      <span class="ico sm" style="background:${c.color}"><i class="ti ti-${c.icon}"></i></span>${T.cats[k]}<span class="n">${counts[k]}</span></label>`).join('');
}

function renderMarkers(list) {
  cluster.clearLayers();
  markers.clear();
  const layers = list.map((e) => {
    const m = L.marker([e.lat, e.lon], {
      icon: L.divIcon({ className: 'marker-ico', html: icoHtml(e), iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).bindPopup(() => popupHtml(e), { maxWidth: 320 });
    m.on('click', () => highlight(e.id));
    markers.set(e.id, m);
    return m;
  });
  cluster.addLayers(layers);
}

function renderList(list) {
  const b = map.getBounds();
  const shown = state.inView ? list.filter((e) => b.contains([e.lat, e.lon])) : list;
  $('status').textContent = [
    T.listed(shown.length),
    state.updated ? `${T.updated}: ${ago(state.updated)}` : T.noData,
    state.fresh ? T.fresh(state.fresh) : '',
  ].filter(Boolean).join(' · ');
  $('list').innerHTML = shown.slice(0, 400).map((e) => `
    <li class="item ${e.id === state.activeId ? 'active' : ''} ${e.isNew ? 'new' : ''}" data-id="${esc(e.id)}">
      <div class="head">
        ${icoHtml(e)}
        <span class="when">${ago(e.t)}</span>
        ${e.url ? `<a class="src" href="${esc(e.url)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i>${T.source}</a>` : ''}
      </div>
      <div class="title" dir="auto">${e.isNew ? `<span class="badge">${T.badge}</span>` : ''}${esc(e.title)}</div>
      <div class="meta">${esc(placeName(e))} · ${esc(e.src || '')}${translateLink(e) ? ' · ' + translateLink(e) : ''}</div>
    </li>`).join('');
}

function render() {
  map.invalidateSize();
  const list = filtered();
  renderLayers();
  renderMarkers(list);
  renderList(list);
}

// Üstteki bölge sekmeleri: tıklayınca harita o bölgeye gider.
const REGIONS = {
  all: [[24, 25], [42.5, 63]],
  tr: [[35.8, 25.6], [42.2, 44.9]],
  kurdistan: [[34, 37.5], [39.5, 48]],
  sy: [[32.2, 35.6], [37.4, 42.5]],
  iq: [[29, 38.7], [37.4, 48.7]],
  ir: [[25, 44], [39.8, 63.4]],
  il: [[29.4, 34.1], [34.7, 36.7]],
  cy: [[34.5, 32.2], [35.8, 34.7]],
};

function renderRegions() {
  $('regions').innerHTML = Object.keys(REGIONS).map((k) =>
    `<button class="region ${state.region === k ? 'active' : ''}" data-region="${k}">${T.regions[k]}</button>`).join('');
}

// Sağ sütundaki Dil / Zaman sekmeleri ve sol alttaki Katmanlar paneli.
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
  $('inViewLabel').textContent = T.inView;
  $('newsLangLabel').textContent = T.newsLang;
  renderRegions();
  renderPanels();
  applyMapLanguage();
  render();
}

function highlight(id) {
  state.activeId = id;
  document.querySelectorAll('.item.active').forEach((el) => el.classList.remove('active'));
  const el = document.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
  if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

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
  const events = [...extra, ...(auto?.events || [])].sort((a, b) => b.t - a.t);
  // İlk yüklemeden sonra gelen olaylar "YENİ" olarak işaretlenir.
  const first = !state.events.length;
  const before = new Map(state.events.map((e) => [e.id, e]));
  let fresh = 0;
  for (const e of events) {
    e.isNew = !first && (!before.has(e.id) || before.get(e.id).isNew);
    if (e.isNew) fresh++;
  }
  state.events = events;
  state.updated = auto?.updated || 0;
  state.fresh = fresh;
  render();
}

// --- Olaylar ---
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
  map.flyToBounds(REGIONS[state.region], { duration: 0.8 });
});
document.querySelector('.feed-tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('.ftab');
  if (b) togglePanel(b.dataset.panel || null);
});
$('chips').addEventListener('change', (ev) => {
  const k = ev.target.dataset.cat;
  if (!k) return;
  ev.target.checked ? state.off.delete(k) : state.off.add(k);
  render();
});
$('list').addEventListener('click', (ev) => {
  if (ev.target.closest('a')) return;
  const li = ev.target.closest('.item');
  if (!li) return;
  const m = markers.get(li.dataset.id);
  if (!m) return;
  highlight(li.dataset.id);
  cluster.zoomToShowLayer(m, () => m.openPopup());
});
let t;
$('search').addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(() => { state.q = ev.target.value.trim(); render(); }, 200); });
$('newsLang').addEventListener('change', (ev) => { state.newsLang = ev.target.value; render(); });
$('inView').addEventListener('change', (ev) => { state.inView = ev.target.checked; renderList(filtered()); });
$('toggleFeed').addEventListener('click', () => { $('feed').classList.toggle('hidden'); map.invalidateSize(); });
map.on('moveend', () => { if (state.inView) renderList(filtered()); });

if (REGIONS[PARAMS.get('region')]) {
  state.region = PARAMS.get('region');
  map.fitBounds(REGIONS[state.region]);
}
if (['lang', 'time', 'layers'].includes(PARAMS.get('panel'))) togglePanel(PARAMS.get('panel'));
applyLanguage();
load();
setInterval(load, REFRESH_MS);
