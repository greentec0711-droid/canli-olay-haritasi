// Haber metnindeki yer adından konum bulur. Türkçe, Kurmancî, Soranî, Arapça, Farsça ve İngilizce
// yazımları ortak bir biçime indirger: "Çölemerik", "Colemêrg", "جۆلەمێرگ", "Hakkari'de" -> Hakkari.
import { PLACES } from './places.mjs';

const ARABIC = /[؀-ۿ]/;
const LATIN = /[a-zA-ZÀ-ɏ]/;
const MAP = { 'ة': 'ه', 'ى': 'ي', 'ی': 'ي', 'ې': 'ي', 'ێ': 'ي', 'ک': 'ك', 'ڪ': 'ك', 'ە': 'ه', 'ھ': 'ه', 'ۆ': 'و', 'ۇ': 'و', 'ڕ': 'ر', 'ڵ': 'ل', 'ڤ': 'ف', 'ء': '' };

export function normalizeToken(tok) {
  let t = tok.replace(/^ئ/, '').replace(/[İIı]/g, 'i').toLowerCase();
  t = t.normalize('NFD').replace(/\p{M}/gu, '');
  return t.replace(/[ةىیېێکڪەھۆۇڕڵڤء]/g, (c) => MAP[c]);
}

export function tokenize(text) {
  const orig = String(text).replace(/[‌‍ـ]/g, '').split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  return { orig, norm: orig.map(normalizeToken) };
}

const LEVEL = 2, CS = 9;
const index = new Map();   // normalleştirilmiş ad -> yer
const rawIndex = new Map(); // birebir (=) adlar

PLACES.forEach((p, id) => {
  const place = { id, lat: p[0], lon: p[1], level: p[LEVEL], cs: p[8].split(';').includes('!cs') };
  const names = [p[3], p[4], p[5], p[6], p[7], ...p[8].split(';')].filter((n) => n && n !== '!cs');
  for (const n of names) {
    if (n.startsWith('=')) {
      const key = tokenize(n.slice(1)).orig.map((t) => t.toLocaleLowerCase('tr')).join(' ');
      if (!rawIndex.has(key)) rawIndex.set(key, place);
    } else {
      const key = tokenize(n).norm.join(' ');
      if (key && !index.has(key)) index.set(key, place);
    }
  }
});

// Ekli yazımlar: Arapça "بالموصل", "والقدس"; Kürtçe "Amedê", "Hewlêrê"; Soranî "هەولێرەوە", "سلێمانیدا".
function prefixVariants(t) {
  const out = [t];
  if (ARABIC.test(t)) {
    for (const p of ['وال', 'بال', 'فال', 'لل', 'و', 'ب', 'ل', 'ف']) {
      if (t.startsWith(p) && t.length - p.length >= 3) out.push(t.slice(p.length));
    }
  }
  return out;
}

function suffixVariants(t) {
  const out = [t];
  const list = ARABIC.test(t) ? ['هوه', 'وه', 'دا', 'ي', 'ه'] : ['ye', 'ya', 'yi', 'e', 'a'];
  const min = ARABIC.test(t) ? 3 : 4;
  for (const s of list) if (t.endsWith(s) && t.length - s.length >= min) out.push(t.slice(0, -s.length));
  return out;
}

function lookup(words, origFirst) {
  const n = words.length;
  const firsts = prefixVariants(words[0]);
  const lasts = n === 1 ? null : suffixVariants(words[n - 1]);
  const keys = [];
  if (n === 1) {
    for (const f of firsts) for (const v of suffixVariants(f)) keys.push(v);
  } else {
    for (const f of firsts) for (const l of lasts) keys.push([f, ...words.slice(1, -1), l].join(' '));
  }
  for (const k of keys) {
    const p = index.get(k);
    if (!p) continue;
    // "Van", "Batman" gibi adlar sadece büyük harfle yazılmışsa sayılır.
    if (p.cs && LATIN.test(origFirst) && origFirst[0] === origFirst[0].toLowerCase()) continue;
    return p;
  }
  return null;
}

// Metindeki en belirgin yeri döndürür: ilçe > şehir > bölge > ülke; eşitse ilk geçen.
export function geocode(text) {
  const { orig, norm } = tokenize(text);
  let best = null, bestPos = Infinity;
  for (let i = 0; i < norm.length; i++) {
    for (let n = Math.min(4, norm.length - i); n >= 1; n--) {
      let p = lookup(norm.slice(i, i + n), orig[i]);
      if (!p) {
        const raw = rawIndex.get(orig.slice(i, i + n).map((t) => t.toLocaleLowerCase('tr')).join(' '));
        if (raw && !(raw.cs && orig[i][0] === orig[i][0].toLocaleLowerCase('tr'))) p = raw;
      }
      if (p) {
        if (!best || p.level > best.level || (p.level === best.level && i < bestPos)) { best = p; bestPos = i; }
        break;
      }
    }
  }
  return best;
}

// Site için her yerin 5 dildeki adı: [tr, en, ku, ckb, ar]
export function placeNames() {
  return PLACES.map((p) => [p[3], p[4], p[5], p[6], p[7]].map((n) => n.replace(/^=/, '')));
}
