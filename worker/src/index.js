// Canlı Olay Haritası — uçak verisi aracısı (Cloudflare Workers, ücretsiz plan).
// adsb.lol ve adsb.fi (gönüllü ADS-B alıcı ağları) tarayıcıdan doğrudan erişime (CORS) izin vermiyor;
// bu küçük servis isteği iletir ve sadece haritanın ihtiyaç duyduğu alanları döndürür.
//
//   /area?lat=37.5&lon=43.7&dist=250   bir noktanın çevresindeki uçaklar (en fazla 250 deniz mili)
//   /mil                               dünya genelindeki askeri uçuşlar

const ALLOWED = ['https://greentec0711-droid.github.io', 'http://localhost:8080'];
const SOURCES = ['https://api.adsb.lol/v2', 'https://opendata.adsb.fi/api/v2'];

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '';
  return { 'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0], Vary: 'Origin' };
}

// İlk kaynak yanıt vermezse ikincisi denenir.
async function upstream(path) {
  let last;
  for (const base of SOURCES) {
    try {
      const res = await fetch(base + path, { headers: { 'User-Agent': 'canli-olay-haritasi' }, cf: { cacheTtl: 15 } });
      if (res.ok) return await res.json();
      last = new Error(`${res.status} ${base}`);
    } catch (e) { last = e; }
  }
  throw last;
}

// Haritaya sadece gereken alanlar gider: veri küçülür, ziyaretçinin interneti yorulmaz.
const slim = (a) => ({
  h: a.hex, f: (a.flight || '').trim(), r: a.r || '', t: a.t || '',
  lat: a.lat, lon: a.lon, alt: a.alt_baro, gs: a.gs, trk: a.track ?? a.true_heading ?? 0,
  sq: a.squawk || '', mil: (a.dbFlags & 1) ? 1 : 0,
});

export default {
  async fetch(req) {
    const cors = corsHeaders(req);
    const url = new URL(req.url);
    let path;
    if (url.pathname === '/mil') {
      path = '/mil';
    } else if (url.pathname === '/area') {
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      const dist = Math.min(250, Math.max(25, Number(url.searchParams.get('dist')) || 250));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return new Response('lat/lon geçersiz', { status: 400, headers: cors });
      }
      // Yuvarlanmış koordinatlar: yakın istekler aynı önbellek kaydını kullanır.
      path = `/lat/${lat.toFixed(1)}/lon/${lon.toFixed(1)}/dist/${Math.round(dist / 25) * 25}`;
    } else {
      return new Response('Canlı Olay Haritası uçak servisi: /area?lat=&lon=&dist= veya /mil', { headers: cors });
    }
    try {
      const j = await upstream(path);
      const ac = (j.ac || j.aircraft || []).filter((a) => a.lat != null && a.lon != null).map(slim);
      return new Response(JSON.stringify({ now: j.now || Date.now(), ac }), {
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  },
};
