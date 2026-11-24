// Atlantic weather engine (atlantic-wx.js) against a FAKE Open-Meteo (forecast + marine) on 8096.
// Needs a fresh server on 8091 started with OPEN_METEO_BASE=http://127.0.0.1:8096 OPEN_METEO_MARINE_BASE=http://127.0.0.1:8096
// and NO_WX_REFRESH=1 (tests/run-all.sh does both). Usage: node tests/api-atlantic.js
const http = require('http'), fs = require('fs'), path = require('path');
const AW = require('../atlantic-wx.js');
const B = process.env.BASE || 'http://localhost:8091';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const land = (la, lo) => la >= 20 && lo >= -16;   // a corner of "Africa": no waves there
let calls = 0;
const day0 = Math.floor(Date.now() / 86400e3) * 86400e3;
const hours = Array.from({ length: 240 }, (_, i) => new Date(day0 + i * 3600e3).toISOString().slice(0, 16));
const fake = http.createServer((q, r) => {
  calls++;
  const u = new URL(q.url, 'http://x'), la = u.searchParams.get('latitude').split(',').map(Number), lo = u.searchParams.get('longitude').split(',').map(Number);
  const marine = u.pathname === '/v1/marine';
  const out = la.map((a, i) => {
    const b = lo[i], h = { time: hours };
    if (marine) {
      const v = f => hours.map((_, k) => (land(a, b) ? null : f(k)));
      Object.assign(h, { wave_height: v(() => 2.14), wave_direction: v(() => 70), wave_period: v(() => 7.4), swell_wave_height: v(() => 1.46), swell_wave_direction: v(() => 45), swell_wave_period: v(() => 9.6) });
    } else {
      Object.assign(h, { wind_speed_10m: hours.map(() => 10 + a / 2), wind_direction_10m: hours.map(() => 80), wind_gusts_10m: hours.map(() => 14 + a / 2),
        pressure_msl: hours.map(() => 1013.24), precipitation: hours.map(() => 0.1), cape: hours.map(() => 847) });
    }
    return { latitude: a, longitude: b, hourly: h };
  });
  r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(out.length === 1 ? out[0] : out));
}).listen(8096);

(async () => {
  const unsigned = global.fetch;
  ok((await unsigned(B + '/api/atlantic/wx')).status === 401, 'forecast needs a sign-in');
  ok((await unsigned(B + '/api/v1/atlantic/wx')).status === 401, 'app route needs a device token');
  await require('./lib/session')(B);
  let r = await fetch(B + '/api/atlantic/wx');
  ok(r.status === 200 && r.headers.get('x-wx-source') === 'bundled', 'before any refresh: the bundled snapshot');
  let s = await (await fetch(B + '/api/atlantic/status')).json();
  ok(s.source === 'bundled' && s.steps >= 20, 'status says bundled (' + s.fetched + ')');
  ok(calls === 0, 'no fetches while NO_WX_REFRESH is set');

  r = await fetch(B + '/api/atlantic/refresh', { method: 'POST' });
  s = await r.json();
  ok(r.status === 200 && s.source === 'server' && !s.lastError, 'refresh by hand works (' + JSON.stringify(s).slice(0, 120) + ')');
  ok(calls === 16, '8 forecast + 8 marine requests of up to 50 points (' + calls + ')');
  r = await fetch(B + '/api/atlantic/wx'); const etag = r.headers.get('etag'); const wx = await r.json();
  ok(r.headers.get('x-wx-source') === 'server' && /no-cache/.test(r.headers.get('cache-control')), 'serves the fresh copy, revalidated each time');
  ok(wx.lats.length === 14 && wx.lons.length === 28 && wx.d.ws[0].length === 392, '2° grid, 392 points');
  const T = wx.times.map(t => Date.parse(t.replace(/Z$/, ':00Z')));
  ok(T.every((t, i) => !i || t - T[i - 1] === 6 * 3600e3) && T[0] >= Date.now() - 6 * 3600e3 - 60e3, wx.times.length + ' steps, 6-hourly, from 6 h ago');
  ok(Math.abs(Date.parse(wx.fetched.replace(/Z$/, ':00Z')) - Date.now()) < 120e3, 'fetched time is now');
  const at = (la, lo) => wx.lats.indexOf(la) * wx.lons.length + wx.lons.indexOf(lo);
  ok(wx.d.ws[0][at(16, -52)] === 18 && wx.d.wg[0][at(16, -52)] === 22 && wx.d.wd[0][at(16, -52)] === 80, 'wind, gust, direction at 16N 52W');
  ok(wx.d.p[0][at(16, -52)] === 10132 && wx.d.cape[0][at(16, -52)] === 850, 'pressure x10, CAPE to 10');
  ok(wx.d.r[1][at(16, -52)] === 6, 'rain = 6 h total x10');
  ok(wx.d.hs[0][at(16, -52)] === 21 && wx.d.sh[0][at(16, -52)] === 15 && wx.d.tp[0][at(16, -52)] === 7, 'waves and swell (m x10, s)');
  ok(wx.d.hs[0][at(28, -14)] === null, 'no waves on land');
  ok((await fetch(B + '/api/atlantic/wx', { headers: { 'If-None-Match': etag } })).status === 304, 'unchanged copy: 304, nothing downloaded');
  r = await fetch(B + '/api/atlantic/refresh', { method: 'POST' });
  ok(r.status === 429, 'a second refresh within 10 minutes is refused');
  const dir = process.env.DATA_DIR_FOR_TOOL;
  if (dir) ok(JSON.parse(fs.readFileSync(path.join(dir, 'atlantic-wx.json'), 'utf8')).fetched === wx.fetched, 'kept on disk for the next start');

  // the pure parts: a broken reply is never kept
  const pts = AW.POINTS, one = { hourly: { time: hours, wind_speed_10m: hours.map(() => null), wind_direction_10m: hours.map(() => 0), wind_gusts_10m: hours.map(() => 0), pressure_msl: hours.map(() => 1000), precipitation: hours.map(() => 0), cape: hours.map(() => 0) } };
  const sea = { hourly: { time: hours, wave_height: hours.map(() => 1), wave_direction: hours.map(() => 0), wave_period: hours.map(() => 6), swell_wave_height: hours.map(() => 1), swell_wave_direction: hours.map(() => 0), swell_wave_period: hours.map(() => 8) } };
  ok(/wind missing/.test(AW.check(AW.build(pts.map(() => one), pts.map(() => sea), Date.now()))), 'a forecast without wind is rejected');
  let threw = false; try { AW.build(pts.slice(1).map(() => one), pts.map(() => sea), Date.now()); } catch (e) { threw = true; }
  ok(threw, 'a reply with missing points is rejected');
  ok(/forecast steps/.test(AW.check(AW.build(pts.map(() => one), pts.map(() => sea), Date.now() + 30 * 86400e3))), 'a forecast that has run out is rejected');

  fake.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
