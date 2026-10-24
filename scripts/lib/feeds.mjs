// RSS akışları ve herkese açık Telegram kanalları (t.me/s/kanal sayfası). Anahtar veya hesap gerekmez.
// Mesajlarda konum yoktur; konum metindeki yer adından bulunur (geo.mjs).
import { geocode } from './geo.mjs';
import { classify, isExcluded } from './classify.mjs';
import { get, decodeEntities, stripTags, pool, hash } from './http.mjs';

function toEvent({ id, t, title, text, url, src, lang, kind, img }) {
  if (!title || isExcluded(`${title}\n${text}`, url)) return null;
  // Önce başlıkta ara; başlıkta ülkeden daha belirgin bir yer yoksa metne de bak.
  let place = geocode(title);
  if (!place || place.level < 2) {
    const deeper = geocode(`${title}\n${text}`);
    if (deeper && (!place || deeper.level > place.level)) place = deeper;
  }
  if (!place) return null;
  return {
    id, t, lat: place.lat, lon: place.lon, pid: place.id, cat: classify(`${title}\n${text}`),
    title: title.slice(0, 220), text: text && text !== title ? text.slice(0, 400) : undefined,
    url, src, lang, kind, mentions: 1, img: img || undefined,
  };
}

// RSS haberinin küçük resmi: media:content, media:thumbnail, enclosure ya da açıklamadaki ilk resim.
function rssImage(b) {
  const candidates = [
    b.match(/<media:(?:content|thumbnail)[^>]+url=["']([^"']+)["'][^>]*>/i)?.[0],
    b.match(/<enclosure[^>]+type=["']image[^>]*>/i)?.[0],
    decodeEntities(b).match(/<img[^>]+src=["']([^"']+)["']/i)?.[0],
  ];
  for (const c of candidates) {
    const u = c && decodeEntities(c.match(/(?:url|src)=["']([^"']+)["']/i)?.[1] || '');
    if (/^https:\/\//.test(u) && !/\.(mp4|mp3|webm)(\?|$)/i.test(u)) return u;
  }
  return '';
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

async function readRss(feed, since) {
  const xml = await (await get(feed.url)).text();
  const blocks = xml.split(/<item[\s>]|<entry[\s>]/i).slice(1);
  const out = [];
  for (const b of blocks) {
    const title = stripTags(tag(b, 'title'));
    let url = decodeEntities(tag(b, 'link')).trim();
    if (!url) url = (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    const date = tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated');
    const t = Date.parse(decodeEntities(date).trim()) || Date.now();
    if (t < since) continue;
    const text = stripTags(tag(b, 'description') || tag(b, 'summary')).replace(/\s+/g, ' ');
    const e = toEvent({ id: 'r' + hash(url || title), t: Math.min(t, Date.now()), title, text, url, src: feed.name, lang: feed.lang, kind: 'rss', img: rssImage(b) });
    if (e) out.push(e);
  }
  return out;
}

async function readTelegram(ch, since) {
  const html = await (await get(`https://t.me/s/${ch.channel}`)).text();
  const out = [];
  for (const chunk of html.split('tgme_widget_message_wrap').slice(1)) {
    const post = (chunk.match(/data-post="([^"]+)"/) || [])[1];
    const body = (chunk.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
    const time = (chunk.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
    if (!post || !body) continue;
    const t = Date.parse(time) || Date.now();
    if (t < since) continue;
    const full = stripTags(body);
    const [first, ...rest] = full.split('\n').filter((l) => l.trim());
    const title = first.length > 220 ? first.slice(0, 217) + '…' : first;
    const img = chunk.match(/tgme_widget_message_photo_wrap[^>]+background-image:url\('([^']+)'\)/)?.[1];
    const e = toEvent({ id: 'tg:' + post, t, title, text: [first.length > 220 ? first : '', ...rest].join(' ').trim(), url: `https://t.me/${post}`, src: ch.name, lang: ch.lang, kind: 'telegram', img });
    if (e) out.push(e);
  }
  return out;
}

export async function fetchFeeds(sources, since) {
  const jobs = [
    ...sources.rss.map((f) => ['RSS', f.name, () => readRss(f, since)]),
    ...sources.telegram.map((c) => ['Telegram', c.name, () => readTelegram(c, since)]),
  ];
  let ok = 0;
  const events = await pool(jobs, 6, async ([kind, name, run]) => {
    try {
      const r = await run();
      ok++;
      return r;
    } catch (e) {
      console.warn(`  ${kind} atlandı (${name}):`, e.message);
      return [];
    }
  });
  console.log(`RSS/Telegram: ${ok}/${jobs.length} kaynak okundu, ${events.length} konumlu haber`);
  return events;
}
