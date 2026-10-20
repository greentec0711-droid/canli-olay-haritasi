// Haber başlıklarını sitenin 5 diline çevirir (Google Çeviri'nin ücretsiz, anahtarsız ucu).
// Her başlık bir kez çevrilir ve events.json'da saklanır; sonraki çalıştırmalarda tekrar çevrilmez.
// Resmi bir API değildir: erişim engellenirse çeviri o çalıştırmada atlanır, başlıklar özgün dilinde görünür.

const TARGETS = ['tr', 'ku', 'ckb', 'en', 'ar'];
const GOOGLE_CODE = { he: 'iw' };
const MAX_CHARS = 4000;
const MAX_LINES = 40;

async function translateLines(lines, sl, tl) {
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${GOOGLE_CODE[sl] || sl}&tl=${tl}`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'q=' + encodeURIComponent(lines.join('\n')),
  });
  if (!res.ok) throw new Error(`çeviri ${res.status}`);
  const out = (await res.json())[0].map((s) => s[0]).join('').split('\n').map((s) => s.trim());
  return out.length === lines.length ? out : null; // satır sayısı tutmazsa güvenme
}

// Aynı dildeki başlıkları gruplar halinde gönderir. Dili bilinmeyenler tek tek gönderilir,
// çünkü karışık dilli bir grupta otomatik dil algılama yanılıyor.
function makeBatches(items) {
  const byLang = new Map();
  const batches = [];
  for (const e of items) {
    if (!e.lang) { batches.push({ sl: 'auto', items: [e] }); continue; }
    if (!byLang.has(e.lang)) byLang.set(e.lang, []);
    byLang.get(e.lang).push(e);
  }
  for (const [sl, list] of byLang) {
    let cur = [], chars = 0;
    for (const e of list) {
      if (cur.length && (cur.length >= MAX_LINES || chars + e.title.length > MAX_CHARS)) {
        batches.push({ sl, items: cur });
        cur = []; chars = 0;
      }
      cur.push(e);
      chars += e.title.length + 1;
    }
    if (cur.length) batches.push({ sl, items: cur });
  }
  return batches;
}

export async function translateTitles(events, maxItems) {
  // Önce RSS/Telegram (daha iyi başlıklar), sonra en yeni GDELT kayıtları.
  const rank = (e) => (e.kind === 'gdelt' ? 1 : 0);
  const todo = events
    .filter((e) => !e.tt && e.title && e.kind !== 'usgs')
    .sort((a, b) => rank(a) - rank(b) || b.t - a.t)
    .slice(0, maxItems);
  if (!todo.length) return;

  const jobs = [];
  for (const b of makeBatches(todo)) {
    for (const tl of TARGETS) if (tl !== b.sl) jobs.push({ ...b, tl });
  }
  let done = 0, blocked = false, i = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (i < jobs.length && !blocked) {
      const job = jobs[i++];
      try {
        const out = await translateLines(job.items.map((e) => e.title.replace(/\s+/g, ' ')), job.sl, job.tl);
        if (!out) continue;
        job.items.forEach((e, k) => { if (out[k]) (e.tt ||= {})[job.tl] = out[k]; });
        done++;
      } catch (err) {
        console.warn('  Çeviri durdu:', err.message);
        blocked = true;
      }
    }
  }));
  console.log(`Çeviri: ${todo.length} başlık, ${done}/${jobs.length} istek başarılı`);
}
