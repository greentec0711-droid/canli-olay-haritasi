// Uydu yörünge verileri (TLE) — CelesTrak, ücretsiz ve anahtarsız.
// CelesTrak verileri birkaç saatte bir güncelliyor ve sık indirilmesini istemiyor: dosya 6 saatten eskiyse yenilenir.
// Konumlar sunucuda değil, ziyaretçinin tarayıcısında yörünge modeliyle (SGP4) hesaplanır.
import fs from 'node:fs/promises';
import path from 'node:path';
import { get } from './http.mjs';

const MAX_AGE = 6 * 3600e3;
// Starlink tek başına ~10.000 uydu (1,7 MB); ayrı dosyada tutulur, sadece katmanı açılınca indirilir.
const FILES = {
  'sats.json': ['stations', 'visual', 'gps-ops', 'galileo', 'beidou', 'weather', 'science', 'geo'],
  'sats-starlink.json': ['starlink'],
};

async function age(file) {
  try { return Date.now() - JSON.parse(await fs.readFile(file, 'utf8')).updated; } catch { return Infinity; }
}

export async function updateSats(dataDir) {
  for (const [name, groups] of Object.entries(FILES)) {
    const file = path.join(dataDir, name);
    if (await age(file) < MAX_AGE) continue;
    try {
      const out = { updated: Date.now(), groups: {} };
      for (const g of groups) {
        const txt = await (await get(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`, 60000)).text();
        // Her uydu 3 satır: ad, TLE 1, TLE 2. Sadece geçerli üçlüler alınır.
        const lines = txt.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
        const sats = [];
        for (let i = 0; i + 2 < lines.length; i += 3) {
          if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) sats.push([lines[i].trim(), lines[i + 1], lines[i + 2]]);
        }
        out.groups[g] = sats;
      }
      await fs.writeFile(file, JSON.stringify(out));
      console.log(`Uydular (${name}):`, Object.entries(out.groups).map(([g, s]) => `${g} ${s.length}`).join(', '));
    } catch (e) {
      console.warn(`Uydular (${name}) atlandı:`, e.message);
    }
  }
}
