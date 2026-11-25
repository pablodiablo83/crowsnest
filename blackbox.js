// Crow's Nest - black box recorder (server side, 25 Nov 2026). Every phone/browser records its own state (position, speed, course,
// connectivity, battery, queue sizes, errors) and uploads it automatically (public/blackbox.js). Here the records are appended to plain
// text files, one per UTC day: DATA_DIR/blackbox/bb-YYYY-MM-DD.jsonl (one JSON object per line), so they stay readable with any
// editor even if the database is damaged, and are downloaded later as JSON lines or CSV (master only) when something went wrong.
// Routes (behind the sign-in gate; /api/v1/... for the phone app): POST /api/blackbox (any signed-in device: a batch of records,
// idempotent by record id), GET /api/blackbox/status, GET /api/blackbox/download?day=YYYY-MM-DD|all&format=jsonl|csv (master only).
// Limits: 300 records per upload, 1500 characters of detail each, 8 MB a day, files kept 400 days.
'use strict';
const fs = require('fs'), path = require('path');
const DAY_MS = 86400000, MAX_BATCH = 300, MAX_DETAIL = 1500, MAX_DAY_BYTES = 8 * 1024 * 1024, KEEP_DAYS = 400;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/, FILE_RE = /^bb-(\d{4}-\d{2}-\d{2})\.jsonl$/;

module.exports = function blackbox(app, { DATA_DIR, curDevice, BRAND, csvCell }) {
  const dir = path.join(DATA_DIR, 'blackbox');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { console.error('blackbox: cannot create ' + dir + ': ' + e.message); }
  const fileOf = day => path.join(dir, 'bb-' + day + '.jsonl');
  const ids = new Map();   // day -> Set of record ids already stored (loaded from the file on first use)
  const idsFor = day => {
    let s = ids.get(day);
    if (!s) {
      s = new Set();
      try { for (const line of fs.readFileSync(fileOf(day), 'utf8').split('\n')) { if (!line) continue; try { s.add(JSON.parse(line).id); } catch (e) {} } } catch (e) {}
      ids.set(day, s);
      if (ids.size > 5) ids.delete(ids.keys().next().value);
    }
    return s;
  };
  const days = () => { try { return fs.readdirSync(dir).map(f => (f.match(FILE_RE) || [])[1]).filter(Boolean).sort(); } catch (e) { return []; } };
  function prune() { const cut = new Date(Date.now() - KEEP_DAYS * DAY_MS).toISOString().slice(0, 10); for (const d of days()) if (d < cut) { try { fs.unlinkSync(fileOf(d)); } catch (e) {} } }
  if (!process.env.NO_BB_PRUNE) { setTimeout(prune, 20000).unref(); setInterval(prune, DAY_MS).unref(); }

  const master = res => { const d = curDevice && curDevice(); if (d && d.role !== 'master') { res.status(403).json({ error: 'only the master can read the black box' }); return false; } return true; };
  const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, n);

  // one record from the wire -> a clean stored record, or null
  function clean(r, now) {
    if (!r || typeof r !== 'object') return null;
    const id = str(r.id, 48), t = +r.t, k = str(r.k, 24);
    if (!/^[A-Za-z0-9_.:-]{6,48}$/.test(id) || !/^[a-z0-9._-]{1,24}$/.test(k)) return null;
    if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > Date.UTC(2100, 0, 1) || t > now + DAY_MS) return null;   // dates 2000-2100 only; a clock a day ahead is refused
    let d = r.d && typeof r.d === 'object' && !Array.isArray(r.d) ? r.d : {};
    let j = JSON.stringify(d); if (j.length > MAX_DETAIL) d = { truncated: true, text: j.slice(0, MAX_DETAIL - 40) };
    return { id, t: Math.round(t), k, d };
  }

  app.post('/api/blackbox', (req, res) => {
    const b = req.body || {}, list = Array.isArray(b.records) ? b.records : null;
    if (!list || !list.length) return res.status(400).json({ error: 'send { device, records: [ { id, t, k, d } ] }' });
    if (list.length > MAX_BATCH) return res.status(400).json({ error: 'at most ' + MAX_BATCH + ' records at a time' });
    const now = Date.now(), dev = str(b.device, 24), who = curDevice && curDevice(), by = who ? str(who.name || who.role, 40) : '';
    const out = new Map(); let stored = 0, dup = 0, rejected = 0, full = 0;
    for (const raw of list) {
      const r = clean(raw, now); if (!r) { rejected++; continue; }
      const day = new Date(r.t).toISOString().slice(0, 10), seen = idsFor(day);
      if (seen.has(r.id)) { dup++; continue; }
      seen.add(r.id);
      if (!out.has(day)) out.set(day, []);
      out.get(day).push(JSON.stringify({ id: r.id, t: r.t, k: r.k, dev, by, rx: now, d: r.d }));
    }
    for (const [day, lines] of out) {
      let size = 0; try { size = fs.statSync(fileOf(day)).size; } catch (e) {}
      const forget = () => { const s = idsFor(day); for (const l of lines) s.delete(JSON.parse(l).id); };   // so a retry is stored, not seen as a duplicate
      if (size > MAX_DAY_BYTES) { full += lines.length; forget(); continue; }
      try { fs.appendFileSync(fileOf(day), lines.join('\n') + '\n'); stored += lines.length; } catch (e) { forget(); console.error('blackbox write failed: ' + e.message); return res.status(500).json({ error: 'could not write the black box file' }); }
    }
    res.json({ ok: true, stored, dup, rejected, full });
  });

  app.get('/api/blackbox/status', (req, res) => {
    if (!master(res)) return;
    res.set('Cache-Control', 'no-store');
    const list = days().map(day => { let n = 0, bytes = 0; try { const s = fs.readFileSync(fileOf(day), 'utf8'); bytes = Buffer.byteLength(s); n = s.split('\n').filter(Boolean).length; } catch (e) {} return { day, records: n, bytes }; });
    // last record per device over the newest two days
    const devs = new Map(); let last = null;
    for (const day of days().slice(-2)) {
      try { for (const line of fs.readFileSync(fileOf(day), 'utf8').split('\n')) { if (!line) continue; let r; try { r = JSON.parse(line); } catch (e) { continue; } const key = r.dev || '?'; const o = devs.get(key) || { device: key, by: r.by, records: 0, lastT: 0, lastKind: '' }; o.records++; if (r.t >= o.lastT) { o.lastT = r.t; o.lastKind = r.k; o.by = r.by; } devs.set(key, o); if (!last || r.t > last.t) last = { t: r.t, k: r.k, dev: key }; } } catch (e) {}
    }
    res.json({ ok: true, days: list.reverse(), totalRecords: list.reduce((a, d) => a + d.records, 0), totalBytes: list.reduce((a, d) => a + d.bytes, 0), devices: [...devs.values()].sort((a, b) => b.lastT - a.lastT), last, keepDays: KEEP_DAYS });
  });

  app.get('/api/blackbox/download', (req, res) => {
    if (!master(res)) return;
    const day = String(req.query.day || ''), fmt = req.query.format === 'csv' ? 'csv' : 'jsonl';
    if (day !== 'all' && !DAY_RE.test(day)) return res.status(400).json({ error: 'day must be YYYY-MM-DD or all' });
    const want = day === 'all' ? days() : [day];
    if (day !== 'all' && !days().includes(day)) return res.status(404).json({ error: 'no black box records for ' + day });
    const rows = [];
    for (const d of want) { try { for (const line of fs.readFileSync(fileOf(d), 'utf8').split('\n')) { if (!line) continue; try { rows.push(JSON.parse(line)); } catch (e) { rows.push({ t: 0, k: 'corrupt-line', d: { text: line.slice(0, 200) } }); } } } catch (e) {} }
    rows.sort((a, b) => a.t - b.t);
    const name = 'crows-nest-black-box-' + day + '.' + (fmt === 'csv' ? 'csv' : 'jsonl');
    res.set({ 'Content-Type': (fmt === 'csv' ? 'text/csv' : 'text/plain') + '; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + name + '"', 'Cache-Control': 'no-store' });
    const notice = BRAND.notice() + ' Exported from ' + BRAND.NAME + ' ' + new Date().toISOString() + '. The data is the vessel\'s own.';
    if (fmt === 'jsonl') return res.send(rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '') + JSON.stringify({ k: 'export', generator: BRAND.NAME, copyright: notice, records: rows.length }) + '\n');
    const head = ['time_utc', 'device', 'signed_in_as', 'kind', 'lat', 'lon', 'sog_kn', 'cog_deg', 'message', 'detail_json'];
    const body = rows.map(r => { const d = r.d || {}; return [r.t ? new Date(r.t).toISOString() : '', r.dev, r.by, r.k, d.lat, d.lon, d.sog, d.cog, d.msg, JSON.stringify(d)].map(csvCell).join(','); });
    res.send([head.map(csvCell).join(','), ...body].join('\r\n') + '\r\n' + csvCell(notice));
  });
  return { dir, days };
};
