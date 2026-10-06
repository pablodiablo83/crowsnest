// Crow's Nest — dashboard extras: LOG, place-name lookup, AI bar placeholder
const AI_URL = process.env.AI_URL || '';

module.exports = function (app, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS log_entries (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_log_ts ON log_entries(ts);
  `);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // LOG is append-only on purpose: corrections are new entries, never edits.
  app.get('/api/log', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
    const since = typeof req.query.since === 'string' && !isNaN(Date.parse(req.query.since))
      ? new Date(req.query.since).toISOString() : null;
    const total = db.prepare('SELECT COUNT(*) AS n FROM log_entries').get().n;
    const today = since
      ? db.prepare('SELECT COUNT(*) AS n FROM log_entries WHERE ts >= ?').get(since).n : null;
    const entries = db.prepare(
      'SELECT id, ts, text FROM log_entries ORDER BY ts DESC, rowid DESC LIMIT ?').all(limit);
    res.json({ total, today, entries });
  });

  app.post('/api/log', (req, res) => {
    const text = typeof (req.body || {}).text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'text required' });
    if (text.length > 2000) return res.status(400).json({ error: 'max 2000 characters' });
    const entry = { id: uid(), ts: new Date().toISOString(), text };
    db.prepare('INSERT INTO log_entries (id, ts, text) VALUES (?, ?, ?)')
      .run(entry.id, entry.ts, entry.text);
    res.status(201).json(entry);
  });

  app.get('/api/log/export.txt', (req, res) => {
    const rows = db.prepare('SELECT ts, text FROM log_entries ORDER BY ts ASC, rowid ASC').all();
    const body = rows.map(r => `${r.ts}  ${r.text.replace(/\r?\n/g, '\n    ')}`).join('\n');
    res.type('text/plain; charset=utf-8').send(body + (rows.length ? '\n' : ''));
  });

  // Place name for a position (OpenStreetMap Nominatim, cached by ~1 km cell).
  const geoCache = new Map();
  app.get('/api/place', async (req, res) => {
    const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({ error: 'bad coordinates' });
    }
    const key = lat.toFixed(2) + ',' + lon.toFixed(2);
    if (geoCache.has(key)) return res.json({ name: geoCache.get(key) });
    try {
      const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=13&accept-language=en'
        + `&lat=${lat}&lon=${lon}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'CrowsNest-self-hosted/0.1' },
        signal: AbortSignal.timeout(6000)
      });
      if (!r.ok) throw new Error('status ' + r.status);
      const d = await r.json();
      const a = d.address || {};
      const place = a.hamlet || a.village || a.town || a.city || a.suburb
        || a.municipality || a.county || null;
      const region = a.state || a.country || null;
      const name = place ? (region && region !== place ? `${place}, ${region}` : place) : null;
      if (geoCache.size > 500) geoCache.clear();
      geoCache.set(key, name);
      res.json({ name });
    } catch (e) {
      res.json({ name: null, error: 'lookup failed' });
    }
  });

  // AI bar: holding endpoint only. Real routing (rules, then model at AI_URL) comes later.
  app.post('/api/agent', (req, res) => {
    const text = String((req.body || {}).text || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: 'text required' });
    res.json({
      ok: false,
      status: 'coming_soon',
      backend: AI_URL ? 'configured' : 'none',
      reply: 'The assistant is not connected yet. Coming soon.'
    });
  });
};
