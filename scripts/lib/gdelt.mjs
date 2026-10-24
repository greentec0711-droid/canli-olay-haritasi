// GDELT 2.0: dünya basınından makineyle çıkarılmış, konumlu olaylar (15 dakikada bir).
// İki akış okunur: İngilizce haberler ve 65 dilden çevrilmiş haberler (Türkçe, Arapça, Farsça...).
import zlib from 'node:zlib';
import { geocode } from './geo.mjs';
import { isExcluded } from './classify.mjs';
import { inRegion } from './region.mjs';
import { get } from './http.mjs';

const BASE = 'http://data.gdeltproject.org/gdeltv2/';

// Sadece odak bölgedeki olaylar alınır (region.mjs): dünya geneli kayıtlar çoğunlukla konu dışıydı
// ve çeviri yükünün büyük kısmını oluşturuyordu.

// Odak ülkeler (FIPS kodları): burada sadece ülke düzeyinde konumlu haberler de alınır.
const FOCUS = new Set(['TU', 'IZ', 'SY', 'IR', 'IS', 'WE', 'GZ', 'LE', 'CY', 'JO']);

// CAMEO olay kodu -> kategori. Sıra önemli: ilk eşleşen kazanır.
const RULES = [
  [/^195/, 'airstrike'], [/^194/, 'artillery'], [/^183/, 'bombing'], [/^20/, 'massviolence'],
  [/^19/, 'clash'], [/^18/, 'attack'], [/^17/, 'security'], [/^15/, 'military'], [/^14/, 'protest'],
];
// GDELT'in siyaset kodları alınmaz: çok gürültülü (moda, magazin haberleri bile giriyor); siyaset RSS/Telegram'dan gelir.
const LANG_BY_TLD = { tr: 'tr', iq: 'ar', sy: 'ar', sa: 'ar', ae: 'ar', eg: 'ar', lb: 'ar', jo: 'ar', qa: 'ar', kw: 'ar', ps: 'ar', ir: 'fa', il: 'he' };

function categorize(code) {
  for (const [re, cat] of RULES) if (re.test(code)) return cat;
  return null;
}

function unzipFirst(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ZIP sonu bulunamadı');
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const compSize = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + compSize);
  return method === 0 ? data : zlib.inflateRawSync(data);
}

// GDELT başlık vermez; haber adresinden okunabilir bir başlık çıkarılır.
function titleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean).reverse();
    for (let p of parts) {
      p = decodeURIComponent(p).replace(/\.(s?html?|php|aspx?)$/i, '').replace(/[-_+]+/g, ' ');
      p = p.replace(/\b(?=[a-z\d]*\d)[a-z\d]{5,}\b/gi, '').replace(/\b(article|story|news|amp|haber|detay)\b/gi, '')
        .replace(/\s+/g, ' ').trim();
      if (p.split(' ').length >= 4 && /\p{L}/u.test(p)) return p.charAt(0).toUpperCase() + p.slice(1);
    }
  } catch {}
  return null;
}

export const gdeltTime = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
const stamp = (ms) => new Date(ms).toISOString().replace(/\D/g, '').slice(0, 14);

function parseExport(csv, translated) {
  const out = [];
  for (const line of csv.split('\n')) {
    const c = line.split('\t');
    if (c.length < 61 || c[25] !== '1') continue; // sadece haberin ana olayı
    const country = c[53];
    const focus = FOCUS.has(country);
    const cat = categorize(c[26]);
    if (!cat) continue;
    if (+c[51] === 1 && !focus) continue; // ülke merkezi: odak bölge dışında atla
    const lat = +c[56], lon = +c[57];
    if (!c[56] || !c[57] || Number.isNaN(lat) || Number.isNaN(lon) || !inRegion(lat, lon)) continue;
    const url = c[60].trim();
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    const known = geocode(c[52]);
    out.push({
      id: 'g' + c[0],
      t: gdeltTime(c[59]),
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      cat,
      place: c[52],
      pid: known && known.level >= 1 ? known.id : undefined,
      country,
      url,
      src: host,
      lang: translated ? (LANG_BY_TLD[host.split('.').pop()] || '') : 'en',
      kind: 'gdelt',
      mentions: +c[31] || 1,
    });
  }
  return out;
}

async function latestStamp() {
  const txt = await (await get(BASE + 'lastupdate.txt')).text();
  return txt.match(/(\d{14})\.export\.CSV\.zip/)[1];
}

export async function fetchGdelt(sinceStamp, hours) {
  const latest = await latestStamp();
  const latestMs = gdeltTime(latest);
  const fromMs = sinceStamp ? gdeltTime(sinceStamp) + 15 * 60e3 : latestMs - hours * 3600e3;
  const files = [];
  for (let t = latestMs; t >= fromMs; t -= 15 * 60e3) {
    files.push([`${stamp(t)}.export.CSV.zip`, false], [`${stamp(t)}.translation.export.CSV.zip`, true]);
  }
  console.log(`GDELT: ${files.length} dosya`);

  const events = [];
  for (let i = 0; i < files.length; i += 4) {
    await Promise.all(files.slice(i, i + 4).map(async ([name, translated]) => {
      try {
        const buf = Buffer.from(await (await get(BASE + name)).arrayBuffer());
        events.push(...parseExport(unzipFirst(buf).toString('utf8'), translated));
      } catch (e) {
        console.warn('  GDELT atlandı:', e.message);
      }
    }));
  }
  for (const e of events) e.title = titleFromUrl(e.url);
  return { events: events.filter((e) => !isExcluded(e.title || '', e.url)), latest };
}
