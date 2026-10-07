// LIVE check of /api/wind against the real Open-Meteo, every model, at a Firth of Clyde position (run in CI: the sandbox cannot
// reach Open-Meteo). Needs a server on 8091 WITHOUT OPEN_METEO_BASE. Fails only if the default model (UK Met Office) fails.
const B = process.env.BASE || 'http://localhost:8091', LAT = 55.85, LON = -4.95;   // off Cumbrae
(async () => {
  await require('./lib/session')(B);
  const r = await fetch(`${B}/api/wind?lat=${LAT}&lon=${LON}&compare=1`);
  const d = await r.json();
  if (!r.ok) { console.log('FAIL default model', d.model && d.model.id, d.detail || d.error); process.exit(1); }
  const all = [{ model: d.model, t: d.t, kn: d.kn, dir: d.dir, gust: d.gust }].concat(d.compare || []);
  const now = Date.now();
  for (const m of all) {
    if (m.error) { console.log(`--   ${m.model.id.padEnd(22)} no data: ${m.error}`); continue; }
    const i = m.t.findIndex(t => t >= now - 3600000), nn = a => a.filter(v => v != null).length;
    console.log(`ok   ${m.model.id.padEnd(22)} ${m.t.length} h, speed ${nn(m.kn)}, gust ${nn(m.gust)}, dir ${nn(m.dir)} | now ${m.kn[i]} kn from ${m.dir[i]}°, gust ${m.gust[i]}`);
  }
  console.log(`grid ${d.gridLat}, ${d.gridLon}`);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
