// fake IOC / Open-Meteo / inshore on 8095 (copied from tests/pw-passage.js)
const http = require('http'), fs = require('fs'), path = require('path');
const R = '/home/user/crowsnest';
const T = require(R + '/engine/tide.js');
const FIXTURE = fs.readFileSync(R + '/tests/fixtures/inshore.html', 'utf8');
const TRUTH = [['M2', 1.130, 342.2], ['S2', 0.305, 34.0], ['N2', 0.213, 315.6], ['K1', 0.106, 192.1], ['O1', 0.100, 45.9], ['M4', 0.092, 92.4]].map(([name, H, G]) => ({ name, H, G }));
http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/inshore') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(FIXTURE); }
  if (u.pathname === '/service.php') {
    const a = Date.parse(u.searchParams.get('timestart') + 'T00:00:00Z'), b = Date.parse(u.searchParams.get('timestop') + 'T00:00:00Z');
    const ts = []; for (let t = a; t <= b; t += 15 * 60000) ts.push(t);
    const h = T.predict(TRUTH, 2.19, ts);
    r.writeHead(200, { 'Content-Type': 'application/json' });
    return r.end(JSON.stringify(ts.map((t, i) => ({ slevel: +h[i].toFixed(3), stime: new Date(t).toISOString().slice(0, 19).replace('T', ' ') }))));
  }
  const days = +u.searchParams.get('forecast_days') || 7, t0 = Math.floor(Date.now() / 86400000) * 86400 - 86400, t = [], kn = [], dir = [], gust = [];
  for (let i = 0; i < (days + 1) * 24; i++) { const s = 12 + 7 * Math.sin(i / 9) + 3 * Math.sin(i / 3.1); t.push(t0 + i * 3600); kn.push(+s.toFixed(1)); dir.push(Math.round(220 + 30 * Math.sin(i / 14))); gust.push(+(s * 1.45).toFixed(1)); }
  r.writeHead(200, { 'Content-Type': 'application/json' });
  r.end(JSON.stringify({ latitude: 55.75, longitude: -4.9, hourly: { time: t, wind_speed_10m: kn, wind_direction_10m: dir, wind_gusts_10m: gust }, current: { time: t0, wind_speed_10m: 14, wind_direction_10m: 225, wind_gusts_10m: 21 } }));
}).listen(8095, () => console.log('fake up'));
