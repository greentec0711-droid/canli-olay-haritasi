// Haber sayfasının kendisinden gerçek başlığı ve paylaşım görselini (og:title, og:image) alır.
//   - GDELT kayıtları: adresten üretilen "how to start a ..." gibi başlıklar yerine gerçek başlık
//   - Görseli olmayan RSS haberleri: küçük resim
// Her haber bir kez denenir (enriched işareti); çalıştırma başına sınırlı sayıda sayfa açılır.
import { decodeEntities, pool } from './http.mjs';

const MAX_BYTES = 400_000; // sayfanın sadece başını oku; meta etiketleri <head> içinde

function meta(html, names) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content).trim();
  }
  return '';
}

async function readHead(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; free-event-map/1.0)', Accept: 'text/html' },
  });
  if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (Buffer.concat(chunks).includes('</head>')) break;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

// Başlık sonundaki " - Site Adı" / " | Site" ekini at: son parça sitenin adresine benziyorsa
// (ör. "… - Hawaii Tribune-Herald" ve hawaiitribune-herald.com). Başlığın kendi içindeki tireler korunur.
const letters = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
function cleanTitle(t, url) {
  t = t.replace(/\s+/g, ' ').trim();
  let host = '';
  try { host = letters(new URL(url).hostname.replace(/^www\./, '').replace(/\.[a-z.]+$/, '')); } catch {}
  if (host.length < 4) return t;
  const sep = /\s*[-|–—]\s*/g;
  let m;
  while ((m = sep.exec(t))) {
    if (m.index < 20) continue;
    const next = letters(t.slice(m.index + m[0].length).split(/\s+[-|–—]\s+|\s*[|–—]\s*/)[0]);
    if (next.length >= 3 && (host.includes(next.slice(0, 6)) || next.includes(host.slice(0, 6)))) return t.slice(0, m.index).trim();
  }
  return t;
}

export async function enrich(events, maxPages) {
  const todo = events
    .filter((e) => !e.enriched && e.url && /^https?:/.test(e.url) &&
      (e.kind === 'gdelt' || (e.kind === 'rss' && !e.img)))
    .sort((a, b) => b.t - a.t)
    .slice(0, maxPages);
  let titles = 0, images = 0;
  await pool(todo, 8, async (e) => {
    e.enriched = true;
    try {
      const html = await readHead(e.url);
      if (!html) return;
      // GDELT'in çeviri akışından gelen haberlerin dili bilinmiyor; sayfanın kendi dil etiketinden öğren.
      if (!e.lang) {
        const l = html.match(/<html[^>]*\slang=["']?([a-zA-Z-]+)/i)?.[1]?.toLowerCase() || '';
        e.lang = l.startsWith('ckb') ? 'ckb' : /^(ku|kmr)/.test(l) ? 'ku' : l.slice(0, 2);
      }
      if (e.kind === 'gdelt') {
        const title = cleanTitle(meta(html, ['og:title', 'twitter:title']) ||
          decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || ''), e.url);
        if (title.length >= 15 && title !== e.title) {
          e.title = title.slice(0, 220);
          delete e.tt; // başlık değişti: çeviriler yeniden yapılacak
          titles++;
        }
      }
      const img = meta(html, ['og:image', 'og:image:url', 'twitter:image']);
      if (/^https:\/\//.test(img) && !e.img) { e.img = img; images++; }
    } catch {}
  });
  console.log(`Sayfa bilgisi: ${todo.length} sayfa, ${titles} başlık, ${images} görsel`);
}
