// Bölge sınırlarını data/regions.json'a yazar (bir kez çalıştırılır; sınırlar değişmedikçe tekrar gerekmez).
//   - Ülkeler: Natural Earth 1:50m (world-atlas paketi), basitleştirilmiş
//   - Kürdistan: scripts/lib/kurdistan.mjs içindeki yaklaşık çizim
// Kullanım: node scripts/build-regions.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KURDISTAN } from './lib/kurdistan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const topo = await (await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json')).json();

// TopoJSON yaylarını koordinatlara çevir.
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; });
});
const ring = (ids) => ids.flatMap((i, k) => {
  const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
  return k ? a.slice(1) : a;
});
const polygonsOf = (g) => (g.type === 'Polygon' ? [g.arcs] : g.arcs).map((p) => ring(p[0])); // sadece dış halka

// Douglas–Peucker basitleştirme (derece cinsinden tolerans).
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      // Kapalı halkada başla son aynı nokta: o zaman noktaya uzaklık kullanılır.
      const d = len < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
        : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

const byName = (name) => topo.objects.countries.geometries.find((g) => g.properties.name === name);
const country = (...names) => names.flatMap((n) => polygonsOf(byName(n)))
  .map((p) => simplify(p, 0.02)).filter((p) => p.length >= 4);

const regions = {
  tr: country('Turkey'),
  kurdistan: KURDISTAN,
  sy: country('Syria'),
  iq: country('Iraq'),
  ir: country('Iran'),
  il: country('Israel', 'Palestine'),
  cy: country('Cyprus', 'N. Cyprus'),
};
await fs.writeFile(path.join(ROOT, 'data', 'regions.json'), JSON.stringify(regions));
for (const [k, v] of Object.entries(regions)) console.log(k, v.length, 'çokgen,', v.reduce((n, p) => n + p.length, 0), 'nokta');
