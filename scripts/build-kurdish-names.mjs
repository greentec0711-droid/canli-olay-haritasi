// Kürdistan sınırları içindeki yerleşimlerin Kürtçe adlarını Wikidata'dan toplar (bir kez çalıştırılır).
// Harita, Kürtçe seçildiğinde önce OpenStreetMap'teki Kürtçe adı (name:ku / name:ckb) gösterir;
// orada yoksa buradaki tablodan yerel ada (Türkçe/Arapça/Farsça/Soranî) bakarak Kürtçesini bulur.
// Kullanım: node scripts/build-kurdish-names.mjs   ->  data/kurdish-names.json
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KURDISTAN } from './lib/kurdistan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = { 'User-Agent': 'canli-olay-haritasi/1.0 (https://github.com/greentec0711-droid/canli-olay-haritasi)', Accept: 'application/sparql-results+json' };

const inRing = (lon, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inKurdistan = (lon, lat) => KURDISTAN.some((r) => inRing(lon, lat, r));

async function query(w, s, e, n) {
  const q = `SELECT ?item ?loc ?ku ?ckb ?tr ?ar ?fa WHERE {
    SERVICE wikibase:box { ?item wdt:P625 ?loc . bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral .
      bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral . }
    OPTIONAL { ?item rdfs:label ?ku FILTER(LANG(?ku) = "ku") }
    OPTIONAL { ?item rdfs:label ?ckb FILTER(LANG(?ckb) = "ckb") }
    FILTER(BOUND(?ku) || BOUND(?ckb))
    OPTIONAL { ?item rdfs:label ?tr FILTER(LANG(?tr) = "tr") }
    OPTIONAL { ?item rdfs:label ?ar FILTER(LANG(?ar) = "ar") }
    OPTIONAL { ?item rdfs:label ?fa FILTER(LANG(?fa) = "fa") }
  }`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(q), { headers: UA, signal: AbortSignal.timeout(90000) });
    if (res.ok) return (await res.json()).results.bindings;
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error(`Wikidata yanıt vermedi: ${w},${s}`);
}

const pairs = { ku: new Map(), ckb: new Map() }; // yerel ad -> Set(Kürtçe ad)
let seen = 0, inside = 0;
const add = (target, local, value) => {
  if (!local || !value || local === value) return;
  if (!pairs[target].has(local)) pairs[target].set(local, new Set());
  pairs[target].get(local).add(value);
};

for (let w = 36; w < 49; w++) {
  for (let s = 32; s < 41; s++) {
    let rows;
    try { rows = await query(w, s, w + 1, s + 1); } catch (e) { console.warn(e.message); continue; }
    for (const r of rows) {
      seen++;
      const m = r.loc.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
      if (!m || !inKurdistan(+m[1], +m[2])) continue;
      inside++;
      const v = (k) => r[k]?.value?.trim();
      // Haritadaki "name" etiketi ülkeye göre Türkçe, Arapça, Farsça ya da Soranî olabilir: hepsinden Kürtçeye bağ kurulur.
      for (const local of [v('tr'), v('ar'), v('fa'), v('ckb')]) add('ku', local, v('ku'));
      for (const local of [v('tr'), v('ar'), v('fa'), v('ku')]) add('ckb', local, v('ckb'));
    }
    process.stdout.write(`\r${w}°D ${s}°K  incelenen ${seen}, Kürdistan içinde ${inside}   `);
    await new Promise((r) => setTimeout(r, 1200)); // Wikidata'yı yormamak için
  }
}

// Aynı yerel ada birden fazla farklı Kürtçe ad düşüyorsa (ör. birçok "Yeşilöz" köyü) güvenilmez: atlanır.
const out = {};
for (const t of ['ku', 'ckb']) {
  out[t] = {};
  let dropped = 0;
  for (const [local, set] of pairs[t]) {
    if (set.size === 1) out[t][local] = [...set][0];
    else dropped++;
  }
  console.log(`\n${t}: ${Object.keys(out[t]).length} ad (${dropped} belirsiz ad atlandı)`);
}
await fs.writeFile(path.join(ROOT, 'data', 'kurdish-names.json'), JSON.stringify(out));
