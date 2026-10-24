// Gemiler — AISStream (ücretsiz, anahtar gerekir). Anahtar GitHub'da gizli değişken olarak durur: AISSTREAM_API_KEY.
// Sitenin sürekli çalışan bir sunucusu olmadığı için gemiler canlı akmaz: her güncellemede bölgeyi
// LISTEN_MS boyunca dinleyip o anki görüntüyü data/ships.json'a yazarız.
import fs from 'node:fs/promises';
import path from 'node:path';
import { REGION } from './region.mjs';

const LISTEN_MS = Number(process.env.SHIPS_LISTEN_MS || 60000);
const KEEP_MS = 3 * 3600e3; // 3 saattir sinyal vermeyen gemi listeden düşer

// AIS gemi tipi kodu -> kategori
function shipType(code) {
  if (code === 35) return 'military';
  if (code === 30) return 'fishing';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code >= 70 && code <= 79) return 'cargo';
  if (code >= 80 && code <= 89) return 'tanker';
  return 'other';
}

export async function updateShips(dataDir) {
  // Kopyalarken yanına gelen boşluk ya da satır sonu anahtarı geçersiz kılar; temizlenir.
  const key = (process.env.AISSTREAM_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!key) return; // anahtar yoksa gemi katmanı boş kalır
  const file = path.join(dataDir, 'ships.json');
  const ships = new Map();
  try {
    const old = JSON.parse(await fs.readFile(file, 'utf8'));
    for (const s of old.ships) if (Date.now() - s.seen < KEEP_MS) ships.set(s.mmsi, s);
  } catch {}

  let messages = 0;
  // Bağlantının nasıl bittiği ships.json'a da yazılır: sorun olursa dışarıdan görülebilsin (anahtarın kendisi yazılmaz).
  const status = { opened: false, closeCode: null, error: '' };
  await new Promise((resolve) => {
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    const done = () => { try { ws.close(); } catch {} resolve(); };
    const timer = setTimeout(done, LISTEN_MS);
    ws.addEventListener('open', () => (status.opened = true) && ws.send(JSON.stringify({
      APIKey: key,
      BoundingBoxes: [[[REGION.minLat, REGION.minLon], [REGION.maxLat, REGION.maxLon]]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    })));
    ws.addEventListener('message', async (ev) => {
      let m;
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch { return; }
      if (m.error) { status.error = String(m.error).slice(0, 200); return; }
      const meta = m.MetaData || {};
      const mmsi = String(meta.MMSI || '');
      if (!mmsi) return;
      messages++;
      const s = ships.get(mmsi) || { mmsi, name: '', type: 'other' };
      if (meta.ShipName?.trim()) s.name = meta.ShipName.trim();
      if (m.MessageType === 'PositionReport') {
        const p = m.Message.PositionReport;
        s.lat = Math.round(p.Latitude * 1e4) / 1e4;
        s.lon = Math.round(p.Longitude * 1e4) / 1e4;
        s.sog = p.Sog;
        s.cog = p.Cog;
        s.hdg = p.TrueHeading !== 511 ? p.TrueHeading : p.Cog;
        s.seen = Date.now();
      } else if (m.MessageType === 'ShipStaticData') {
        const d = m.Message.ShipStaticData;
        s.type = shipType(d.Type);
        if (d.Destination?.trim()) s.dest = d.Destination.trim();
      }
      ships.set(mmsi, s);
    });
    ws.addEventListener('error', (e) => { status.error ||= `bağlantı hatası ${e.message || ''}`.trim(); clearTimeout(timer); done(); });
    ws.addEventListener('close', (e) => { status.closeCode = e.code; clearTimeout(timer); resolve(); });
  });

  const list = [...ships.values()].filter((s) => s.lat != null && s.seen);
  await fs.writeFile(file, JSON.stringify({ updated: Date.now(), messages, status, ships: list }));
  console.log(`Gemiler: ${messages} mesaj, ${list.length} gemi`, status.error || '');
}
