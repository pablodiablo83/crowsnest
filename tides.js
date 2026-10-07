// Crow's Nest - tides service: standard ports from a year of open gauge data, secondary ports by the Admiralty method.
//   Standard port: the last ~year of 15-minute readings from the UK National Tide Gauge Network (via the IOC Sea Level
//   Station Monitoring Facility, open access) -> harmonic analysis (engine/tide.js) -> stored constants. Re-analysed
//   when older than 30 days. Predictions are astronomical: weather (surge, pressure) is not included.
//   Secondary port: the user's own time/height differences from their almanac (UKHO copyright, so never shipped here)
//   applied to the standard port's predictions by the Admiralty method.
'use strict';
const T = require('./engine/tide.js');
const STATIONS = require('./tide-stations.js');
const IOC = process.env.IOC_BASE || 'https://www.ioc-sealevelmonitoring.org';
const DAY = 86400000;

module.exports = function tides(app, { db, auditRaw, getSetting }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tide_stations (
      code TEXT PRIMARY KEY, analysed_at TEXT, data_from TEXT, data_to TEXT, n INTEGER, rms REAL, z0 REAL,
      cons TEXT, levels TEXT, datum TEXT, datum_offset REAL
    );
    CREATE TABLE IF NOT EXISTS tide_secondary (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL, lon REAL, std_code TEXT NOT NULL, hw_times TEXT NOT NULL, lw_times TEXT NOT NULL,
      std_levels TEXT NOT NULL, diffs TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
  `);
  const station = code => STATIONS.find(s => s.code === code) || null;
  const nm = (a, b) => {
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const loadStation = code => {
    const r = db.prepare('SELECT * FROM tide_stations WHERE code = ?').get(code);
    return r ? Object.assign(r, { cons: JSON.parse(r.cons), levels: JSON.parse(r.levels) }) : null;
  };

  // ---- analysis jobs (one at a time; a few seconds of maths after ~13 gentle requests to the IOC service)
  const jobs = new Map();   // code -> { state: 'running'|'failed', started, done, total, error }
  let queue = Promise.resolve();
  async function fetchChunk(code, from, to) {
    const a = new Date(from).toISOString().slice(0, 10), b = new Date(to).toISOString().slice(0, 10);
    const r = await fetch(`${IOC}/service.php?query=data&code=${encodeURIComponent(code)}&timestart=${a}&timestop=${b}&format=json`,
      { signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'CrowsNest/1.0 (private marine dashboard)' } });
    if (!r.ok) throw new Error('gauge data service answered ' + r.status);
    const d = await r.json();
    return (Array.isArray(d) ? d : []).map(x => ({ t: Date.parse(String(x.stime).replace(' ', 'T') + 'Z'), h: +x.slevel })).filter(o => Number.isFinite(o.t) && Number.isFinite(o.h));
  }
  function analyseStation(code) {
    if (jobs.get(code) && jobs.get(code).state === 'running') return jobs.get(code);
    const job = { state: 'running', started: new Date().toISOString(), done: 0, total: 13 };
    jobs.set(code, job);
    queue = queue.then(async () => {
      try {
        // walk back month by month from today until a year of readings is in hand (or 4 years searched)
        const obs = new Map(); let end = Date.now(), months = 0, span = 0;
        while (months < 48) {
          const chunk = await fetchChunk(code, end - 30 * DAY, end);
          chunk.forEach(o => obs.set(o.t, o));
          job.done = ++months; end -= 30 * DAY;
          const ts = [...obs.keys()];
          span = ts.length ? (Math.max(...ts) - Math.min(...ts)) / DAY : 0;
          if (span >= 364 && obs.size > 20000) break;
          if (!chunk.length && span >= 300) break;
          job.total = Math.max(job.total, months + 1);
        }
        if (obs.size < 2000) throw new Error('not enough gauge data for this station (' + obs.size + ' readings)');
        const r = T.analyse([...obs.values()]);
        const L = T.levels(r.cons, r.z0);
        // UK gauge records are normally on Chart Datum already (Millport: LAT from the analysis = 0.03 m above the gauge
        // zero). Keep the gauge datum when the computed LAT is within 0.3 m of it; otherwise refer heights to LAT.
        const onCD = Math.abs(L.LAT) <= 0.3, off = onCD ? 0 : L.LAT;
        const levels = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, Math.round((v - off) * 1000) / 1000]));
        db.prepare(`INSERT INTO tide_stations (code, analysed_at, data_from, data_to, n, rms, z0, cons, levels, datum, datum_offset)
          VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET analysed_at=excluded.analysed_at, data_from=excluded.data_from,
          data_to=excluded.data_to, n=excluded.n, rms=excluded.rms, z0=excluded.z0, cons=excluded.cons, levels=excluded.levels,
          datum=excluded.datum, datum_offset=excluded.datum_offset`)
          .run(code, new Date().toISOString(), new Date(r.from).toISOString(), new Date(r.to).toISOString(), r.n, r.rms, r.z0 - off,
            JSON.stringify(r.cons.map(c => ({ name: c.name, H: +c.H.toFixed(5), G: +c.G.toFixed(3) }))), JSON.stringify(levels), onCD ? 'CD' : 'LAT', off);
        jobs.delete(code);
      } catch (e) {
        job.state = 'failed'; job.error = String(e.message || e);
      }
    });
    return job;
  }
  // a station's constants, starting (re-)analysis when missing or over 30 days old
  function constantsFor(code) {
    const s = loadStation(code), job = jobs.get(code);
    if (!s || Date.now() - Date.parse(s.analysed_at) > 30 * DAY) { if (!job || job.state !== 'running') analyseStation(code); }
    return s;
  }

  // ---- secondary ports
  const secView = r => r && { id: r.id, name: r.name, lat: r.lat, lon: r.lon, std: r.std_code, hwTimes: JSON.parse(r.hw_times), lwTimes: JSON.parse(r.lw_times),
    stdLevels: JSON.parse(r.std_levels), diffs: JSON.parse(r.diffs), notes: r.notes || '' };
  const LV = ['MHWS', 'MHWN', 'MLWN', 'MLWS'];
  function checkSecondary(b) {
    const e = m => { throw Object.assign(new Error(m), { status: 400 }); };
    const name = String(b.name || '').trim().slice(0, 60); if (!name) e('give the port a name');
    if (!station(b.std)) e('choose its standard port');
    const times = (x, what) => {
      if (!Array.isArray(x) || x.length !== 2) e(what + ': two standard-port times with their differences');
      const out = x.map(([t, d]) => { const m = String(t).match(/^(\d{1,2}):?(\d{2})$/); if (!m || +m[1] > 23 || +m[2] > 59) e(what + ': times as HHMM'); const n = Math.round(+d); if (!Number.isFinite(n) || Math.abs(n) > 600) e(what + ': differences in minutes'); return [m[1].padStart(2, '0') + m[2], n]; });
      const a = (+out[0][0].slice(0, 2) * 60 + +out[0][0].slice(2)) % 720, c = (+out[1][0].slice(0, 2) * 60 + +out[1][0].slice(2)) % 720;
      if (a === c) e(what + ': the two times must differ (e.g. 0000 and 0600)');
      return out;
    };
    const lv = (o, what, lo, hi) => Object.fromEntries(LV.map(k => { const v = +((o || {})[k]); if (!Number.isFinite(v) || v < lo || v > hi) e(what + ' ' + k + ' must be a number of metres'); return [k, Math.round(v * 100) / 100]; }));
    const stdLevels = lv(b.stdLevels, 'standard port', -5, 20), diffs = lv(b.diffs, 'difference', -10, 10);
    if (stdLevels.MHWS === stdLevels.MHWN || stdLevels.MLWS === stdLevels.MLWN) e('spring and neap heights of the standard port must differ');
    const num = (v, lo, hi) => v === '' || v == null ? null : (Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : e('latitude/longitude out of range'));
    return { name, std: b.std, lat: num(b.lat, -90, 90), lon: num(b.lon, -180, 180), hwTimes: times(b.hwTimes, 'high water'), lwTimes: times(b.lwTimes, 'low water'), stdLevels, diffs, notes: String(b.notes || '').slice(0, 300) };
  }
  app.get('/api/tides/secondary', (req, res) => res.json(db.prepare('SELECT * FROM tide_secondary WHERE deleted_at IS NULL ORDER BY name').all().map(secView)));
  app.post('/api/tides/secondary', (req, res) => {
    let v; try { v = checkSecondary(req.body || {}); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const id = 'sp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), now = new Date().toISOString();
    db.prepare('INSERT INTO tide_secondary (id, name, lat, lon, std_code, hw_times, lw_times, std_levels, diffs, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, v.name, v.lat, v.lon, v.std, JSON.stringify(v.hwTimes), JSON.stringify(v.lwTimes), JSON.stringify(v.stdLevels), JSON.stringify(v.diffs), v.notes, now, now);
    auditRaw('tide-port-add', 'tideport:' + id, null, null, Object.assign({ id }, v), req.get('X-Source') || 'api');
    res.json(secView(db.prepare('SELECT * FROM tide_secondary WHERE id = ?').get(id)));
  });
  app.put('/api/tides/secondary/:id', (req, res) => {
    const old = db.prepare('SELECT * FROM tide_secondary WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'not found' });
    let v; try { v = checkSecondary(req.body || {}); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    db.prepare('UPDATE tide_secondary SET name=?, lat=?, lon=?, std_code=?, hw_times=?, lw_times=?, std_levels=?, diffs=?, notes=?, updated_at=? WHERE id=?')
      .run(v.name, v.lat, v.lon, v.std, JSON.stringify(v.hwTimes), JSON.stringify(v.lwTimes), JSON.stringify(v.stdLevels), JSON.stringify(v.diffs), v.notes, new Date().toISOString(), old.id);
    auditRaw('tide-port-edit', 'tideport:' + old.id, null, secView(old), v, req.get('X-Source') || 'api');
    res.json(secView(db.prepare('SELECT * FROM tide_secondary WHERE id = ?').get(old.id)));
  });
  app.delete('/api/tides/secondary/:id', (req, res) => {
    const old = db.prepare('SELECT * FROM tide_secondary WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (old) { db.prepare('UPDATE tide_secondary SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), old.id); auditRaw('tide-port-delete', 'tideport:' + old.id, null, secView(old), null, req.get('X-Source') || 'api'); }
    res.json({ ok: true });
  });

  // ---- ports near a position
  app.get('/api/tides/stations', (req, res) => {
    const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon), here = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    const analysed = Object.fromEntries(db.prepare('SELECT code, analysed_at, data_from, data_to, rms, datum FROM tide_stations').all().map(r => [r.code, r]));
    const std = STATIONS.map(s => ({ kind: 'std', id: s.code, name: s.name, lat: s.lat, lon: s.lon, distanceNm: here ? Math.round(nm(here, s) * 10) / 10 : null,
      analysed: analysed[s.code] ? { at: analysed[s.code].analysed_at, from: analysed[s.code].data_from, to: analysed[s.code].data_to, rms: analysed[s.code].rms, datum: analysed[s.code].datum } : null,
      analysing: !!(jobs.get(s.code) && jobs.get(s.code).state === 'running') }));
    const sec = db.prepare('SELECT * FROM tide_secondary WHERE deleted_at IS NULL').all().map(secView).map(p => {
      const ref = p.lat != null && p.lon != null ? p : station(p.std);
      return { kind: 'sec', id: p.id, name: p.name, std: p.std, stdName: (station(p.std) || {}).name, lat: p.lat, lon: p.lon, distanceNm: here && ref ? Math.round(nm(here, ref) * 10) / 10 : null };
    });
    if (here) { std.sort((a, b) => a.distanceNm - b.distanceNm); sec.sort((a, b) => (a.distanceNm == null ? 1e9 : a.distanceNm) - (b.distanceNm == null ? 1e9 : b.distanceNm)); }
    res.json({ standard: std, secondary: sec });
  });
  app.post('/api/tides/analyse/:code', (req, res) => {
    if (!station(req.params.code)) return res.status(404).json({ error: 'unknown station' });
    res.status(202).json({ status: 'analysing', job: analyseStation(req.params.code) });
  });

  // ---- predictions for a port: ?port=<station code> | sec:<id>  &from=<ms>&days=<1-14>
  function predictPort(port, from, to) {
    const sec = /^sec:/.test(port) ? secView(db.prepare('SELECT * FROM tide_secondary WHERE id = ? AND deleted_at IS NULL').get(port.slice(4))) : null;
    if (/^sec:/.test(port) && !sec) return { status: 404, body: { error: 'secondary port not found' } };
    const code = sec ? sec.std : port, st = station(code);
    if (!st) return { status: 404, body: { error: 'unknown port' } };
    const s = constantsFor(code), job = jobs.get(code);
    if (!s) return { status: 202, body: { status: job && job.state === 'failed' ? 'failed' : 'analysing', error: job && job.error, progress: job ? { done: job.done, total: job.total } : null, station: st } };
    const STEP = 10 * 60000, pad = sec ? DAY : 0;
    const ts = []; for (let t = Math.floor((from - pad) / STEP) * STEP; t <= to + pad; t += STEP) ts.push(t);
    const hs = T.predict(s.cons, s.z0, ts);
    const ext = T.extremes(s.cons, s.z0, from - pad, to + pad, 10).map(e => ({ t: e.t, h: Math.round(e.h * 100) / 100, type: e.type }));
    const quality = { analysedAt: s.analysed_at, from: s.data_from, to: s.data_to, days: Math.round((Date.parse(s.data_to) - Date.parse(s.data_from)) / DAY), readings: s.n, rmsM: Math.round(s.rms * 100) / 100 };
    const datum = s.datum === 'CD' ? { code: 'CD', label: 'above Chart Datum', note: 'Gauge record is referenced to Chart Datum (LAT from the analysis ' + (s.levels.LAT >= 0 ? '+' : '') + s.levels.LAT.toFixed(2) + ' m).' }
      : { code: 'LAT', label: 'above LAT', note: 'Heights above Lowest Astronomical Tide computed from the gauge record (approximately Chart Datum).' };
    if (!sec) {
      return { status: 200, body: { port: { kind: 'std', id: code, name: st.name, lat: st.lat, lon: st.lon }, datum, levels: s.levels, quality,
        extremes: ext.filter(e => e.t >= from && e.t <= to), curve: ts.map((t, i) => [t, Math.round(hs[i] * 1000) / 1000]).filter(p => p[0] >= from && p[0] <= to) } };
    }
    const sx = T.secondaryExtremes(ext, { hwTimes: sec.hwTimes, lwTimes: sec.lwTimes, std: sec.stdLevels, diff: sec.diffs });
    const curve = T.secondaryCurve(ts, hs, ext, sx).filter(p => p.t >= from && p.t <= to).map(p => [p.t, Math.round(p.h * 1000) / 1000]);
    const lv = Object.fromEntries(LV.map(k => [k, Math.round((sec.stdLevels[k] + sec.diffs[k]) * 100) / 100]));
    return { status: 200, body: { port: { kind: 'sec', id: sec.id, name: sec.name, lat: sec.lat, lon: sec.lon, std: { id: code, name: st.name } }, datum, levels: lv, quality, secondary: sec,
      extremes: sx.filter(e => e.t >= from && e.t <= to).map(e => ({ t: e.t, h: Math.round(e.h * 100) / 100, type: e.type, std: { t: e.std.t, h: e.std.h }, dt: Math.round(e.dt), dh: Math.round(e.dh * 100) / 100 })), curve } };
  }
  app.get('/api/tides/predict', (req, res) => {
    const days = Math.min(14, Math.max(1, parseInt(req.query.days, 10) || 7));
    const from = Number.isFinite(+req.query.from) && +req.query.from > 0 ? +req.query.from : Date.now() - 6 * 3600000;
    const r = predictPort(String(req.query.port || 'mill'), from, from + days * DAY);
    res.status(r.status).json(Object.assign({ source: 'Crow\'s Nest harmonic prediction from UK National Tide Gauge Network data (IOC Sea Level Monitoring Facility)' }, r.body));
  });

  // ---- dashboard card (kept compatible with older app builds: { configured, events: [{ type, time, heightM }] })
  app.get('/api/tides', (req, res) => {
    let port = String(req.query.port || '');
    if (!port) {
      const last = db.prepare('SELECT lat, lon FROM positions WHERE deleted_at IS NULL ORDER BY ts DESC LIMIT 1').get();
      port = last ? STATIONS.slice().sort((a, b) => nm(last, a) - nm(last, b))[0].code : 'mill';
    }
    const now = Date.now(), r = predictPort(port, now - 2 * 3600000, now + 36 * 3600000);
    if (r.status === 202) return res.json({ configured: true, analysing: true, port: r.body.station && r.body.station.name, events: [] });
    if (r.status !== 200) return res.status(r.status).json(Object.assign({ configured: true }, r.body));
    const b = r.body, cur = b.curve, i = cur.findIndex(p => p[0] >= now);
    res.json({ configured: true, source: b.source, port: b.port.name, portId: port, datum: b.datum.label,
      now: i > 0 ? { h: cur[i][1], rising: cur[i][1] > cur[i - 1][1] } : null,
      events: b.extremes.filter(e => e.t > now).slice(0, 4).map(e => ({ type: e.type === 'HW' ? 'high' : 'low', time: new Date(e.t).toISOString(), heightM: e.h })),
      curve: cur.filter(p => p[0] >= now - 2 * 3600000 && p[0] <= now + 12 * 3600000 && p[0] % (20 * 60000) === 0) });
  });

  // keep the vessel's nearest standard port analysed (startup, then daily check)
  setTimeout(() => {
    const last = db.prepare('SELECT lat, lon FROM positions WHERE deleted_at IS NULL ORDER BY ts DESC LIMIT 1').get();
    const code = last ? STATIONS.slice().sort((a, b) => nm(last, a) - nm(last, b))[0].code : 'mill';
    if (!process.env.NO_TIDE_WARMUP) constantsFor(code);
  }, 5000).unref();

  return { STATIONS, analyseStation, constantsFor, jobs };
};
