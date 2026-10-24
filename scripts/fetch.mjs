// Ücretsiz veri toplayıcı. Hiçbir API anahtarı ya da ücretli servis gerektirmez; sadece Node 18+.
//   - GDELT 2.0: dünya basını, İngilizce + 65 dilden çeviri (15 dakikada bir), sadece odak bölge
//   - RSS: Türkçe, Kurmancî, Soranî, Arapça, Farsça, İngilizce haber siteleri (scripts/sources.json)
//   - Telegram: herkese açık kanallar (scripts/sources.json)
//   - USGS: depremler; GDACS: sel, kasırga, yanardağ, orman yangını, kuraklık
//   - Launch Library 2: yaklaşan roket fırlatmaları
//   - GDELT olaylarının gerçek başlığı ve haber görselleri haber sayfasının kendisinden alınır
//   - Başlıklar sitenin 5 diline çevrilir (Türkçe, Kurmancî, Soranî, İngilizce, Arapça)
//
// Kullanım:  node scripts/fetch.mjs
// Ortam değişkenleri (isteğe bağlı):
//   HOURS=6        İlk çalıştırmada kaç saat geriye gidilsin
//   KEEP_HOURS=48  Haritada kaç saatlik olay tutulsun
//   MAX_EVENTS=6000

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchGdelt } from './lib/gdelt.mjs';
import { fetchFeeds } from './lib/feeds.mjs';
import { placeNames } from './lib/geo.mjs';
import { get } from './lib/http.mjs';
import { translateTitles } from './lib/translate.mjs';
import { enrich } from './lib/enrich.mjs';
import { fetchDisasters, fetchLaunches } from './lib/hazards.mjs';
import { inRegion } from './lib/region.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const HOURS = Number(process.env.HOURS || 6);
const KEEP_HOURS = Number(process.env.KEEP_HOURS || 48);
const MAX_EVENTS = Number(process.env.MAX_EVENTS || 6000);
const MAX_TRANSLATE = Number(process.env.MAX_TRANSLATE || 400); // bir çalıştırmada çevrilecek en fazla başlık
const MAX_PAGES = Number(process.env.MAX_PAGES || 200); // bir çalıştırmada başlık/görsel için açılacak en fazla haber sayfası

const SEVERITY = ['news', 'politics', 'protest', 'military', 'security', 'attack', 'clash', 'artillery', 'bombing', 'airstrike', 'massviolence'];

// Aynı haber birden çok kez gelirse tek olaya indir: RSS/Telegram başlığı GDELT'inkinden iyidir,
// GDELT kayıtları arasında en ağır kategori kalır. Daha önce görülen haberin ilk görülme zamanı korunur.
function merge(oldEvents, newEvents) {
  const byKey = new Map();
  const firstSeen = new Map(oldEvents.map((e) => [e.id, e.t]));
  for (const e of [...oldEvents, ...newEvents]) {
    if (firstSeen.has(e.id)) e.t = Math.min(e.t, firstSeen.get(e.id));
    const key = e.url || e.id;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, e); continue; }
    const better = prev.kind === 'gdelt' && e.kind !== 'gdelt' ? true
      : prev.kind !== 'gdelt' && e.kind === 'gdelt' ? false
      : prev.kind === 'gdelt' ? SEVERITY.indexOf(e.cat) > SEVERITY.indexOf(prev.cat)
      : true;
    if (!better) continue;
    // Haber sayfasından alınmış bilgiler (gerçek başlık, görsel, dil) ve hazır çeviriler korunur.
    const keepTitle = e.kind === prev.kind && prev.enriched;
    byKey.set(key, {
      ...e,
      t: Math.min(e.t, prev.t),
      title: keepTitle ? prev.title : e.title,
      lang: e.lang || prev.lang,
      img: e.img || prev.img,
      enriched: e.enriched || prev.enriched,
      tt: e.tt || (keepTitle || e.title === prev.title ? prev.tt : undefined),
    });
  }
  return [...byKey.values()];
}

async function fetchQuakes() {
  const json = await (await get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson')).json();
  return json.features.map((f) => ({
    id: 'q' + f.id,
    t: f.properties.time,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    cat: 'earthquake',
    title: `M${f.properties.mag.toFixed(1)} — ${f.properties.place}`,
    place: f.properties.place,
    url: f.properties.url,
    src: 'USGS',
    lang: 'en',
    kind: 'usgs',
    mentions: Math.round(f.properties.mag * 10),
  }));
}

async function main() {
  let prev = { events: [], gdeltLast: null };
  try { prev = JSON.parse(await fs.readFile(path.join(DATA, 'events.json'), 'utf8')); } catch {}
  const sources = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts', 'sources.json'), 'utf8'));
  const cutoff = Date.now() - KEEP_HOURS * 3600e3;

  const skip = (name, fallback) => (e) => { console.warn(`${name} atlandı:`, e.message); return fallback; };
  const [gdelt, feeds, quakes, disasters, launches] = await Promise.all([
    fetchGdelt(prev.gdeltLast, HOURS).catch(skip('GDELT', { events: [], latest: prev.gdeltLast })),
    fetchFeeds(sources, cutoff),
    fetchQuakes().catch(skip('USGS', [])),
    fetchDisasters().catch(skip('GDACS', [])),
    fetchLaunches().catch(skip('Fırlatmalar', prev.launches || [])), // servis saatte 15 istekle sınırlı; olmazsa eskisi kalır
  ]);

  // Eski kayıtlardan: depremler her seferinde yeniden gelir; bölge dışındaki eski GDELT kayıtları atılır.
  const old = prev.events.filter((e) => e.kind !== 'usgs' && e.cat !== 'earthquake' && (e.kind !== 'gdelt' || inRegion(e.lat, e.lon)));
  const events = [...merge(old, [...gdelt.events, ...feeds, ...disasters]), ...quakes]
    .filter((e) => e.t >= cutoff && e.title)
    .sort((a, b) => b.t - a.t)
    .slice(0, MAX_EVENTS);

  await enrich(events, MAX_PAGES);
  await translateTitles(events, MAX_TRANSLATE);

  const json = JSON.stringify({ updated: Date.now(), gdeltLast: gdelt.latest, events, launches });
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(path.join(DATA, 'events.json'), json);
  // Site bu dosyaları <script> olarak yükler; dosyaya çift tıklayınca da çalışır.
  await fs.writeFile(path.join(DATA, 'events.js'), `window.__EVENTS__ = ${json};\n`);
  await fs.writeFile(path.join(DATA, 'places.js'), `window.__PLACES__ = ${JSON.stringify(placeNames())};\n`);
  const counts = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  console.log(`Tamam: ${events.length} olay yazıldı`, counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
