// LIVE tide checks (CI only: the sandbox cannot reach NOAA or IOC).
//  1. The engine's astronomy: NOAA's published constants -> our predictions vs NOAA's official predictions.
//  2. Real analysis: a year of Millport gauge data (IOC) -> constants, fit quality, levels, next high/low waters.
const T = require('../engine/tide.js');
const fail = m => { console.log('FAIL ' + m); process.exitCode = 1; };
const NAME = { NU2: 'nu2', MU2: 'mu2', LAM2: 'lambda2', RHO: 'rho1', MM: 'Mm', SSA: 'Ssa', SA: 'Sa', MSF: 'MSf', MF: 'Mf' };
const get = async u => { const r = await fetch(u, { headers: { 'User-Agent': 'CrowsNest/1.0 (private marine dashboard)' } }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
(async () => {
  // ---- 1. NOAA
  const begin = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())), end = new Date(begin.getTime() + 6 * 86400000);
  for (const [id, label] of [['9414290', 'San Francisco'], ['8518750', 'New York Battery'], ['1612340', 'Honolulu']]) {
    const hc = await get(`https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${id}/harcon.json?units=metric`);
    const cons = hc.HarmonicConstituents.filter(c => c.amplitude > 0).map(c => ({ name: NAME[c.name] || c.name, H: c.amplitude, G: c.phase_GMT }))
      .filter(c => { if (!T.CONSTITUENTS.includes(c.name)) { console.log(`  (${label}: no ${c.name}, ${c.H} m)`); return false; } return true; });
    const q = `station=${id}&datum=MSL&units=metric&time_zone=gmt&format=json&begin_date=${ymd(begin)}&end_date=${ymd(end)}&application=crowsnest`;
    const hourly = (await get(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${q}&product=predictions&interval=h`)).predictions;
    const hilo = (await get(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${q}&product=predictions&interval=hilo`)).predictions;
    const ts = hourly.map(p => Date.parse(p.t.replace(' ', 'T') + 'Z'));
    const ours = T.predict(cons, 0, ts);
    let ss = 0, mx = 0; hourly.forEach((p, i) => { const d = ours[i] - +p.v; ss += d * d; mx = Math.max(mx, Math.abs(d)); });
    const rms = Math.sqrt(ss / hourly.length);
    const ext = T.extremes(cons, 0, ts[0], ts[ts.length - 1], 6);
    let dtMax = 0, dhMax = 0, matched = 0;
    for (const h of hilo) {
      const t = Date.parse(h.t.replace(' ', 'T') + 'Z'), typ = h.type === 'H' ? 'HW' : 'LW';
      const e = ext.filter(x => x.type === typ).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
      if (!e || Math.abs(e.t - t) > 3 * 3600000) continue;
      matched++; dtMax = Math.max(dtMax, Math.abs(e.t - t) / 60000); dhMax = Math.max(dhMax, Math.abs(e.h - +h.v));
    }
    console.log(`NOAA ${label}: ${cons.length} constituents | hourly rms ${(rms * 100).toFixed(2)} cm, max ${(mx * 100).toFixed(2)} cm | HW/LW matched ${matched}/${hilo.length}, worst time ${dtMax.toFixed(1)} min, worst height ${(dhMax * 100).toFixed(1)} cm`);
    if (rms > 0.015 || mx > 0.04) fail(label + ' hourly heights differ from NOAA');
    if (matched < hilo.length - 1 || dtMax > 6 || dhMax > 0.03) fail(label + ' high/low waters differ from NOAA');
  }
  // ---- 2. Millport, a year of gauge data
  const code = 'mill', obs = [];
  const now = Date.now(), from = now - 366 * 86400000;
  for (let t = from; t < now; t += 30 * 86400000) {
    const a = new Date(t).toISOString().slice(0, 10), b = new Date(Math.min(now, t + 30 * 86400000)).toISOString().slice(0, 10);
    const d = await get(`https://www.ioc-sealevelmonitoring.org/service.php?query=data&code=${code}&timestart=${a}&timestop=${b}&format=json`);
    for (const x of d) obs.push({ t: Date.parse(x.stime.replace(' ', 'T') + 'Z'), h: +x.slevel });
  }
  const uniq = [...new Map(obs.map(o => [o.t, o])).values()];
  const t0 = Date.now(); const r = T.analyse(uniq); const ms = Date.now() - t0;
  console.log(`Millport: ${uniq.length} readings over ${r.days.toFixed(0)} days, ${r.cons.length} constituents, rms ${(r.rms * 100).toFixed(1)} cm (includes weather), ${r.rejected} rejected, analysed in ${ms} ms`);
  console.log('  Z0 ' + r.z0.toFixed(3) + ' | ' + r.cons.slice().sort((a, b) => b.H - a.H).slice(0, 14).map(c => `${c.name} ${c.H.toFixed(3)}/${c.G.toFixed(1)}`).join('  '));
  const t1 = Date.now(); const L = T.levels(r.cons, r.z0); console.log(`  levels (gauge datum) computed in ${Date.now() - t1} ms: ` + Object.entries(L).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  '));
  const ex = T.extremes(r.cons, r.z0, now, now + 2 * 86400000, 6);
  console.log('  next: ' + ex.map(e => `${e.type} ${new Date(e.t).toISOString().slice(5, 16)}Z ${e.h.toFixed(2)} (${(e.h - L.LAT).toFixed(2)} above LAT)`).join(' | '));
  if (r.rms > 0.4) fail('Millport fit is poor');
  // NTSLF's published Millport high/low waters, for a by-eye comparison (page structure not parsed yet)
  try {
    const html = await (await fetch('https://ntslf.org/tides/tidepred?port=Millport', { headers: { 'User-Agent': 'CrowsNest/1.0' } })).text();
    const txt = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const i = txt.search(/High|HW|Low water|Time/); console.log('NTSLF Millport page text: ' + txt.slice(Math.max(0, i - 100), i + 1500));
  } catch (e) { console.log('NTSLF fetch failed: ' + e.message); }
})().catch(e => { console.log('ERROR', e.stack); process.exit(1); });
