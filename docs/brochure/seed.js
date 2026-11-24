// Fictional demo data: vessel, three crew, a 6-day voyage with watches, a Clyde track.
const B = 'http://localhost:8091';
(async () => {
  await require('/home/user/crowsnest/tests/lib/session.js')(B);
  const J = (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', 'X-Source': 'web' }, body: b && JSON.stringify(b) }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) console.log('ERR', m, p, r.status, JSON.stringify(d).slice(0, 200)); return d; });
  await J('PUT', '/api/vessel', { vessel: 'Sea Lark', officialNumber: 'DEMO 0001', flag: 'United Kingdom' });
  const H = 3600000, now = Date.now(), day0 = Math.floor((now - 6 * 86400000) / 86400000) * 86400000; // midnight UTC 6 days ago
  const decl = { rested: 'yes', ackRecords: true, ackEmergency: true, under18: false, declaredBy: 'seafarer' };
  const crew = [['A. Morgan', 'Master'], ['J. Reid', 'Mate'], ['S. Okafor', 'Deckhand']];
  const iso = t => new Date(t).toISOString();
  for (let k = 0; k < crew.length; k++) {
    const c = await J('POST', '/api/crew', { name: crew[k][0], role: crew[k][1] });
    await J('POST', `/api/crew/${c.id}/voyages`, { start: iso(day0 + 6 * H), declaration: decl });
    // 4-on/8-off style watches with a day-work block, offset per person
    let t = day0 + 6 * H; const stop = now - 2 * H;
    const pat = k === 0 ? [[4, 'work'], [4, 'rest'], [3, 'work'], [7, 'rest'], [2, 'work'], [4, 'rest']]
              : k === 1 ? [[4, 'rest'], [4, 'work'], [8, 'rest'], [4, 'work'], [4, 'rest']]
              : [[8, 'rest'], [4, 'work'], [2, 'rest'], [3, 'work'], [7, 'rest']];
    let i = 0;
    while (t < stop) { const [h, ty] = pat[i++ % pat.length]; const e = Math.min(t + h * H, stop); await J('POST', `/api/crew/${c.id}/entries`, { type: ty, start: iso(t), end: iso(e) }); t = e; }
    await J('POST', `/api/crew/${c.id}/quicklog`, { type: k === 1 ? 'rest' : 'work' });
  }
  // track: Largs -> Cumbrae -> Arran (Lamlash) -> Campbeltown -> Mull of Kintyre -> Gigha (fictional passage)
  const wp = [[55.796, -4.870], [55.760, -4.905], [55.700, -4.960], [55.620, -5.030], [55.535, -5.085], [55.440, -5.230], [55.420, -5.540], [55.320, -5.580], [55.280, -5.700], [55.400, -5.760], [55.560, -5.790], [55.680, -5.745]];
  const tStart = day0 + 8 * H, tEnd = now - 1 * H, N = 160;
  for (let n = 0; n <= N; n++) {
    const f = n / N * (wp.length - 1), a = Math.floor(f), b = Math.min(a + 1, wp.length - 1), r = f - a;
    const lat = wp[a][0] + (wp[b][0] - wp[a][0]) * r + 0.002 * Math.sin(n), lon = wp[a][1] + (wp[b][1] - wp[a][1]) * r + 0.003 * Math.cos(n * 1.3);
    await J('POST', '/api/positions', { id: 'demo' + n, ts: iso(tStart + (tEnd - tStart) * n / N), lat: +lat.toFixed(5), lon: +lon.toFixed(5), acc: 12, sog: +(5 + 1.5 * Math.sin(n / 7)).toFixed(1), cog: 200, source: n % 5 ? 'phone (background)' : 'tap' });
  }
  console.log('seeded');
})();
