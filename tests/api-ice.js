// Ice (ice.js) against a FAKE ERDDAP on 8099. Needs a fresh server on 8091 with ICE_BASE=http://127.0.0.1:8099 (tests/run-all.sh does this).
const http = require('http'), ICE = require('../ice.js');
const B = process.env.BASE || 'http://localhost:8091';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
let calls = 0, mode = 'ok';
// synthetic field: 90 % ice north of 62.0 N (by true latitude), land flag 2.54 in the corner, y axis DEscending like NSIDC
const field = (x, y) => { const p = ICE.inv(x, y); return x > 400000 && y < -3600000 ? 2.54 : p.lat >= 62 ? 0.9 : 0; };
const fake = http.createServer((q, r) => {
  calls++;
  const u = new URL(q.url, 'http://x');
  if (mode === 'down') { r.writeHead(403); return r.end('blocked'); }
  if (u.pathname.includes('/info/')) {
    r.writeHead(200, { 'Content-Type': 'text/csv' });
    return r.end(['Row Type,Variable Name,Attribute Name,Data Type,Value', 'dimension,time,,double,"nValues=100, evenlySpaced=true"', 'dimension,ygrid,,double,"nValues=448, evenlySpaced=true"', 'dimension,xgrid,,double,"nValues=304, evenlySpaced=true"',
      'variable,cdr_seaice_conc,,float,', 'attribute,cdr_seaice_conc,units,String,1', 'variable,cdr_seaice_conc_stdev,,float,', 'variable,qa_of_cdr_seaice_conc,,byte,'].join('\n'));
  }
  const m = decodeURIComponent(u.search).match(/cdr_seaice_conc\[\(last\)\]\[\((-?\d+)\):\((-?\d+)\)\]\[\((-?\d+)\):\((-?\d+)\)\]/);
  if (!m) { r.writeHead(400); return r.end('bad'); }
  const [y0, y1, x0, x1] = m.slice(1).map(Number);
  if (y0 < y1) { r.writeHead(404); return r.end('Your query produced no matching results (axis is descending)'); }   // y must be given high to low
  const rows = [];
  for (let y = y0; y >= y1; y -= 25000) for (let x = x1 < x0 ? x1 : x0; x <= (x1 < x0 ? x0 : x1); x += 25000) rows.push(['2026-11-24T00:00:00Z', y, x, field(x, y)]);
  r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ table: { columnNames: ['time', 'ygrid', 'xgrid', 'cdr_seaice_conc'], rows } }));
}).listen(8099);
(async () => {
  const p = ICE.fwd(59.8, -43.9);
  ok(Math.abs(ICE.inv(p.x, p.y).lat - 59.8) < 1e-6 && Math.abs(ICE.inv(p.x, p.y).lon + 43.9) < 1e-6, 'projection round-trips');
  ok(Math.abs(ICE.fwd(70, -45).x) < 1e-6 && Math.abs(ICE.fwd(70, -45).y + 2187928) < 5, '70N 45W is on the central meridian, 2188 km from the pole');
  ok((await fetch(B + '/api/ice')).status === 401, 'ice needs a sign-in');
  await require('./lib/session')(B);
  let d = await (await fetch(B + '/api/ice?lat=40&lon=-20')).json();
  ok(d.relevant === false, 'south of 45N: not relevant');
  d = await (await fetch(B + '/api/ice?lat=60.0&lon=-44')).json();   // ice starts at 62N: about 120 nm north
  ok(d.relevant && !d.failed && d.near15 && d.near15.distNm > 90 && d.near15.distNm < 150 && (d.near15.bearing < 25 || d.near15.bearing > 335), 'nearest ice about 120 nm to the north (' + JSON.stringify(d.near15) + ')');
  ok(d.here === 0 && d.date === '2026-11-24' && d.grid.length === 25 && /NOT shown/.test(d.warning), 'open water here, date and warning present');
  ok(d.grid.flat().some(v => v >= 90) && d.grid.flat().some(v => v === 0), 'the local grid has ice and open water');
  const n = calls; await fetch(B + '/api/ice?lat=60.0&lon=-44'); ok(calls === n, 'cached: no second fetch');
  d = await (await fetch(B + '/api/ice?lat=66&lon=-44')).json();
  ok(d.here === 90, 'inside the ice: concentration here 90 %');
  mode = 'down'; d = await (await fetch(B + '/api/ice?lat=72&lon=-30')).json();
  ok(d.failed === true && d.links.length >= 1, 'service down: says unavailable and links to the ice charts');
  fake.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
