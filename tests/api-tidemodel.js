// World tide model (tides.js, port model:<lat>,<lon>) against a FAKE Open-Meteo marine API on 8098.
// Needs a fresh server on 8091 with OPEN_METEO_MARINE_BASE=http://127.0.0.1:8098 NO_TIDE_WARMUP=1 (tests/run-all.sh does this).
const http = require('http');
const B = process.env.BASE || 'http://localhost:8091';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const H = 3600e3, start = Math.floor(Date.now() / H) * H - 92 * 24 * H;
let calls = 0;
// a synthetic tide: M2 1.5 m (period 12.4206 h) + S2 0.5 m (12 h), 0.3 m of slow pressure drift; "land" at lat 50.0
const fake = http.createServer((q, r) => {
  calls++;
  const u = new URL(q.url, 'http://x'), la = +u.searchParams.get('latitude');
  const time = [], h = [];
  for (let t = start; t <= start + 93 * 24 * H; t += H) {
    time.push(new Date(t).toISOString().slice(0, 16));
    const x = (t - start) / H;
    h.push(la === 50 ? null : +(1.5 * Math.cos(2 * Math.PI * x / 12.4206 + 0.7) + 0.5 * Math.cos(2 * Math.PI * x / 12) + 0.3 * Math.sin(x / 90)).toFixed(3));
  }
  r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ latitude: la, hourly: { time, sea_level_height_msl: h } }));
}).listen(8098);
(async () => {
  await require('./lib/session')(B);
  let r = await fetch(B + '/api/tides?lat=64.2&lon=-51.7');   // Nuuk: no gauge within 25 nm
  let d = await r.json();
  ok(r.status === 200 && d.model === true && /LAT \(model\)/.test(d.datum), 'far from a gauge: the world model is used (' + d.port + ')');
  ok(d.events && d.events.length >= 3 && d.curve && d.curve.length > 20, 'events and a curve come back');
  ok(/not for navigation/i.test(d.warning || ''), 'the warning is sent');
  const hw = d.events.filter(e => e.type === 'high').map(e => e.heightM), lw = d.events.filter(e => e.type === 'low').map(e => e.heightM);
  ok(Math.min(...lw) >= -0.2 && Math.max(...hw) > 2.5 && Math.max(...hw) < 5, 'heights above LAT look sensible (HW ' + Math.max(...hw) + ', LW ' + Math.min(...lw) + ')');
  const n = calls; await fetch(B + '/api/tides?lat=64.2&lon=-51.7');
  ok(calls === n, 'the fit is stored: no second fetch');
  r = await fetch(B + '/api/tides/predict?port=model:64.2,-51.7&days=3'); d = await r.json();
  ok(r.status === 200 && d.model && d.extremes.length >= 8 && d.quality.rmsM < 0.25, 'predict works for a model port (rms ' + (d.quality && d.quality.rmsM) + ')');
  r = await fetch(B + '/api/tides/predict?port=model:999,5'); ok(r.status === 400, 'a bad position is refused');
  r = await fetch(B + '/api/tides?port=model:50.0,-30.0'); d = await r.json();
  ok(d.failed === true && /over land|no sea level/i.test(d.error || ''), 'over land: says so instead of inventing tides');
  r = await fetch(B + '/api/tides?lat=55.62&lon=-4.92'); d = await r.json();   // Millport area: a gauge is near
  ok(!d.model, 'near a gauge: the gauge, not the model');
  fake.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
