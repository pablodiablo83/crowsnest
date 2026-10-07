#!/usr/bin/env node
// Tide diagnostics (run inside the container: docker exec crowsnest-hor node tools/tide-check.js [analyse <code>])
//   no arguments     last positions, the nearest gauge, analysed gauges and each one's next high/low waters
//   analyse <code>   fetch and analyse a gauge now (e.g. mill), printing progress; the server picks it up at once
'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const T = require('../engine/tide.js');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = new Database(path.join(DATA_DIR, 'crowsnest.db'));
db.pragma('journal_mode = WAL');
process.env.NO_TIDE_WARMUP = '1';
const noop = () => {};
const tides = require('../tides.js')({ get: noop, post: noop, put: noop, delete: noop }, { db, auditRaw: noop, getSetting: noop });
const [cmd, code] = process.argv.slice(2);
const hm = t => new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' });

if (cmd === 'analyse') {
  if (!tides.STATIONS.find(s => s.code === code)) { console.error('unknown gauge: ' + code + ' (codes in tide-stations.js)'); process.exit(1); }
  const job = tides.analyseStation(code, true), t0 = Date.now();
  const iv = setInterval(() => {
    if (job.state === 'failed') { clearInterval(iv); console.log('FAILED ' + code + ': ' + job.error); process.exit(1); }
    if (!tides.jobs.has(code)) { clearInterval(iv); const s = db.prepare('SELECT n, rms, datum, data_from, data_to FROM tide_stations WHERE code = ?').get(code);
      console.log('OK ' + code + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s: ' + JSON.stringify(s)); process.exit(0); }
    console.log(code + ': ' + job.done + '/' + job.total + ' months');
  }, 5000);
} else {
  const pos = db.prepare('SELECT lat, lon, ts, source FROM positions WHERE deleted_at IS NULL ORDER BY ts DESC LIMIT 3').all();
  console.log('last positions: ' + (pos.length ? pos.map(p => `${(+p.lat).toFixed(3)},${(+p.lon).toFixed(3)} ${p.ts} ${p.source || ''}`).join(' | ') : 'none'));
  const n = tides.nearest(tides.lastPosition());
  console.log('nearest gauge to last position: ' + (n ? `${n.name} (${n.code}) ${Math.round(n.distanceNm)} nm` : 'none (home port used)'));
  const rows = db.prepare('SELECT code, analysed_at, n, rms, datum FROM tide_stations').all();
  if (!rows.length) console.log('no gauge analysed yet');
  for (const r of rows) {
    try {
      const now = Date.now(), p = tides.predictPort(r.code, now, now + 86400000);
      const ev = p.body.extremes.slice(0, 2).map(e => `${e.type} ${hm(e.t)} ${e.h.toFixed(2)}m`).join(', ');
      console.log(`${r.code}: ${r.n} readings, fit ${(+r.rms).toFixed(3)} m, ${r.datum}, analysed ${r.analysed_at.slice(0, 16)} -> ${ev}`);
    } catch (e) { console.log(`${r.code}: PREDICTION ERROR ${e.message}`); }
  }
}
