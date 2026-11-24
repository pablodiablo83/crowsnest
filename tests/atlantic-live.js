// Live check (weekly CI; the dev sandbox cannot reach Open-Meteo): the Atlantic engine fetches the real ECMWF + Marine grid
// and the copy passes its own checks. Needs a server on 8091 (no NO_WX_REFRESH) and the tester account.
const B = process.env.BASE || 'http://localhost:8091';
(async () => {
  await require('./lib/session')(B);
  const r = await fetch(B + '/api/atlantic/refresh', { method: 'POST' }); const s = await r.json();
  console.log(JSON.stringify(s));
  const wx = await (await fetch(B + '/api/atlantic/wx')).json();
  const share = a => a.filter(v => v != null).length / a.length;
  const ok = r.status === 200 && s.source === 'server' && wx.times.length >= 36 && share(wx.d.ws[0]) > 0.95 && share(wx.d.hs[0]) > 0.6;
  console.log(`${ok ? 'PASS' : 'FAIL'} live Atlantic forecast: ${wx.times.length} steps, wind at ${Math.round(share(wx.d.ws[0]) * 100)}% of points, waves at ${Math.round(share(wx.d.hs[0]) * 100)}%`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
