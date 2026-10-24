// Afetler (GDACS: BM ve AB ortak küresel afet uyarı sistemi) ve yaklaşan roket fırlatmaları (Launch Library 2).
// İkisi de ücretsiz ve anahtarsız.
import { get } from './http.mjs';
import { inRegion } from './region.mjs';

// Bölgedeki her afet alınır; bölge dışından sadece turuncu ve kırmızı alarmlılar.
// Depremler zaten USGS'den geliyor; GDACS'tan alınmaz.
const TYPES = { FL: 'flood', TC: 'cyclone', VO: 'volcano', WF: 'wildfire', DR: 'drought' };

export async function fetchDisasters() {
  // Servis en fazla 100 kayıt döndürüyor ve küçük orman yangınları listeyi dolduruyor; bu yüzden her tür ayrı istenir.
  // Servis bazen yavaşlıyor; olmazsa önceki afet kayıtları events.json'da kalır.
  const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const features = [];
  for (const type of Object.keys(TYPES)) {
    try {
      const url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=${type}&fromDate=${from}&alertlevel=Green;Orange;Red`;
      features.push(...((await (await get(url, 45000)).json()).features || []));
    } catch (e) {
      if (!/^40[04]/.test(e.message)) console.warn(`  GDACS ${type} atlandı:`, e.message); // 400/404 = o türde güncel afet yok
    }
  }
  const out = [];
  for (const f of features) {
    const p = f.properties;
    const sub = TYPES[p.eventtype];
    if (!sub || String(p.iscurrent) !== 'true' || f.geometry?.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates;
    if (!inRegion(lat, lon) && p.alertlevel === 'Green') continue;
    out.push({
      id: `gd${p.eventtype}${p.eventid}`,
      t: Date.parse(`${p.datemodified || p.fromdate}Z`) || Date.now(),
      lat, lon,
      cat: 'disaster',
      sub,
      alert: String(p.alertlevel || 'Green').toLowerCase(),
      title: p.name || p.description,
      place: p.country || '',
      url: p.url?.report || 'https://www.gdacs.org',
      src: 'GDACS',
      lang: 'en',
      kind: 'gdacs',
      mentions: 1,
    });
  }
  return out;
}

export async function fetchLaunches() {
  const json = await (await get('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=15', 30000)).json();
  return (json.results || [])
    .filter((l) => l.pad?.latitude && l.pad?.longitude && Date.parse(l.net) > Date.now() - 6 * 3600e3)
    .map((l) => ({
      id: 'll' + l.id,
      name: l.name,
      net: Date.parse(l.net),
      status: l.status?.abbrev || '',
      provider: l.launch_service_provider?.name || '',
      pad: l.pad.name,
      place: l.pad.location?.name || '',
      lat: +l.pad.latitude,
      lon: +l.pad.longitude,
      img: /^https:\/\//.test(l.image || '') ? l.image : undefined,
    }));
}
