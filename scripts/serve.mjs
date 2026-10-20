// Bilgisayarda çalıştırmak için küçük sunucu:  node scripts/serve.mjs  ->  http://localhost:8080
// Açık kaldığı sürece haberleri 5 dakikada bir kendisi yeniler (UPDATE_MIN ile değiştirilebilir).
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' }).end(body);
  } catch {
    res.writeHead(404).end('Bulunamadı');
  }
}).listen(PORT, () => console.log(`Site açık: http://localhost:${PORT}  (kapatmak için bu pencereyi kapatın)`));

const UPDATE_MIN = Number(process.env.UPDATE_MIN || 5);
let running = false;
function update() {
  if (running) return;
  running = true;
  console.log(`[${new Date().toLocaleTimeString('tr-TR')}] Haberler güncelleniyor…`);
  spawn(process.execPath, [path.join(ROOT, 'scripts', 'fetch.mjs')], { stdio: 'inherit' })
    .on('exit', () => { running = false; });
}
update();
setInterval(update, UPDATE_MIN * 60e3);
