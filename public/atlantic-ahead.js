// Atlantic weather, option A "Now and ahead" (Pabs, 24 Nov 2026): the page opens on a list, the chart is behind a button.
// At sea in rough weather the answer must be readable at a glance: conditions at the boat now, then at the place the boat
// will be every 12 h until arrival (straight line from the boat to the finish at the set speed). Uses the same snapshot,
// grid and squall rule as the chart (atlantic.js calls CNAhead.ready / CNAhead.boat); nothing here is fetched separately.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const BF = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
  const beaufort = kn => { let i = 0; while (i < BF.length && kn >= BF[i]) i++; return i; };
  const PTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = d => PTS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = n => String(n).padStart(2, '0');
  // Beaufort chips: brightness rises with force so they still read in Night mode (red filter) and in sunlight
  const BC = ['#2B6CB0', '#2B6CB0', '#2E8FA8', '#2E8FA8', '#3FA36B', '#9BC34A', '#E8C547', '#F08A2C', '#D6453A', '#B02A6E', '#8A2390', '#6B1E8A', '#4B1470'];
  const BT = b => (b >= 5 && b <= 7 ? '#10151F' : '#FFFFFF');
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('arcwx_' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('arcwx_' + k, JSON.stringify(v)); } catch (e) {} }
  };
  const A = { wx: null, boat: null, fin: null, kn: Number(store.get('speed')) || 6.5 };
  if (!(A.kn >= 2 && A.kn <= 12)) A.kn = 6.5;
  const nowMs = () => (typeof window.__NOW === 'number' ? window.__NOW : Date.now());

  // bilinear value from the 2° grid, ignoring missing (land) corners; same method as the chart
  function val(arr, lat, lon) {
    const w = A.wx, NL = w.lats.length, NO = w.lons.length, dl = w.lats[1] - w.lats[0], dn = w.lons[1] - w.lons[0];
    const fi = (lat - w.lats[0]) / dl, fj = (lon - w.lons[0]) / dn;
    if (fi < -0.5 || fj < -0.5 || fi > NL - 0.5 || fj > NO - 0.5) return null;
    const i0 = Math.max(0, Math.min(NL - 2, Math.floor(fi))), j0 = Math.max(0, Math.min(NO - 2, Math.floor(fj)));
    const a = Math.max(0, Math.min(1, fi - i0)), b = Math.max(0, Math.min(1, fj - j0));
    let s = 0, ws = 0;
    for (const [i, j, k] of [[i0, j0, (1 - a) * (1 - b)], [i0, j0 + 1, (1 - a) * b], [i0 + 1, j0, a * (1 - b)], [i0 + 1, j0 + 1, a * b]]) {
      const v = arr[i * NO + j]; if (v != null && k > 0) { s += v * k; ws += k; }
    }
    return ws > 0.2 ? s / ws : null;
  }
  // directions are averaged as vectors (350° and 10° must give N, not S)
  function dir(arr, lat, lon) {
    const r = Math.PI / 180;
    const s = val(arr.map(d => (d == null ? null : Math.sin(d * r))), lat, lon), c = val(arr.map(d => (d == null ? null : Math.cos(d * r))), lat, lon);
    if (s == null || c == null) return null;
    return (Math.atan2(s, c) / r + 360) % 360;
  }
  function point(t, lat, lon) {
    const d = A.wx.d, ws = val(d.ws[t], lat, lon);
    if (ws == null) return null;
    const hs = val(d.hs[t], lat, lon), sh = val(d.sh[t], lat, lon), rain = (val(d.r[t], lat, lon) || 0) / 10, cape = val(d.cape[t], lat, lon) || 0;
    return {
      ws: Math.round(ws), bf: beaufort(Math.round(ws)),   // force from the knots shown, so "E 17" never reads F4
      wd: dir(d.wd[t], lat, lon), wg: Math.round(val(d.wg[t], lat, lon) || ws),
      hs: hs == null ? null : hs / 10, tp: val(d.tp[t], lat, lon), hd: dir(d.hd[t], lat, lon),
      sh: sh == null ? null : sh / 10, sd: dir(d.sd[t], lat, lon), rain, cape,
      squalls: rain >= 5 || (rain >= 1 && cape >= 800)   // the chart's rule (rainTxt): low confidence, grid is coarser than squalls
    };
  }
  function nmBetween(a, b) {   // rhumb line, nm
    const r = Math.PI / 180, dphi = (b[0] - a[0]) * r, dpsi = Math.log(Math.tan(Math.PI / 4 + b[0] * r / 2) / Math.tan(Math.PI / 4 + a[0] * r / 2));
    const q = Math.abs(dpsi) > 1e-12 ? dphi / dpsi : Math.cos(a[0] * r); return Math.hypot(dphi, q * (b[1] - a[1]) * r) / r * 60;
  }
  // the plan: positions along the line boat -> finish at the forecast steps from now until arrival
  function plan() {
    const w = A.wx, T = w.times.map(s => Date.parse(s)), now = nowMs();
    let t0 = T.findIndex(x => x >= now - 3 * 3600e3);
    if (t0 < 0) return { expired: true };
    const dist = nmBetween(A.boat, A.fin), etaMs = Math.round((T[t0] + dist / A.kn * 3600e3) / 600e3) * 600e3, rows = [];   // ETA to the nearest 10 min
    for (let t = t0; t < T.length; t++) {
      const h = (T[t] - T[t0]) / 3600e3, f = Math.min(1, h * A.kn / dist);
      const lat = A.boat[0] + (A.fin[0] - A.boat[0]) * f, lon = A.boat[1] + (A.fin[1] - A.boat[1]) * f;
      const p = point(t, lat, lon);
      rows.push({ t, ms: T[t], h, lat, lon, nm: Math.round(Math.min(dist, h * A.kn)), arrived: f >= 1, long: T[t] - T[0] > 5 * 86400e3, p });
      if (f >= 1) break;
    }
    return { t0, dist, etaMs, rows, beyond: etaMs > T[T.length - 1] };
  }

  const tl = ms => { const d = new Date(ms); return { day: DAY[d.getUTCDay()] + ' ' + d.getUTCDate(), hm: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) }; };
  const pos = (la, lo) => { const f = (v, p, n, w) => { const a = Math.abs(v); let d = Math.floor(a), m = Math.round((a - d) * 60); if (m === 60) { d++; m = 0; } return String(d).padStart(w, '0') + '°' + pad(m) + '′' + (v >= 0 ? p : n); }; return f(la, 'N', 'S', 2) + ' ' + f(lo, 'E', 'W', 3); };
  // arrow points the way the wind blows (from + 180), as everywhere in Crow's Nest
  const arrow = (from, size) => from == null ? '' : `<svg class="ah-arr" width="${size}" height="${size}" viewBox="-10 -10 20 20" aria-hidden="true" style="transform:rotate(${Math.round(from + 180)}deg)"><path d="M0 -8 L5 2 L1.6 1 L1.6 8 L-1.6 8 L-1.6 1 L-5 2Z" fill="currentColor"/></svg>`;
  const chip = (b, cls) => `<span class="${cls}" style="background:${BC[b]};color:${BT(b)}">F${b}</span>`;
  const m1 = v => (v == null ? '–' : v.toFixed(1) + ' m');

  function render() {
    const el = $('ahead'); if (!el || !A.wx) return;
    const ageH = (nowMs() - Date.parse(A.wx.fetched.replace(/Z$/, ':00Z'))) / 3600e3;
    const head = `<div class="ah-top"><a class="ah-back" href="/">‹ Dashboard</a><span class="ah-age${ageH > 12 ? ' old' : ''}">Forecast ${ageH < 1 ? '<1' : Math.round(ageH)} h old</span><button class="ah-night" id="ahNight" aria-pressed="${document.body.classList.contains('night')}">Night</button></div>`;
    const chartBtn = '<button class="ah-chart" id="ahChart">Show on chart</button>';
    if (!A.boat) { el.innerHTML = head + `<div class="ah-card ah-empty"><b>No position yet</b><p>Log a position on the dashboard (or tap WORK/REST on the phone), or plot one on the chart under “Your position”. Then this page shows the weather where you are and where you will be.</p></div>` + chartBtn; return wire(); }
    const P = plan();
    if (P.expired) { el.innerHTML = head + `<div class="ah-card ah-empty"><b>This forecast has run out</b><p>Every time in the bundled forecast is in the past. Update the app (or the server copy) to get a new forecast.</p></div>` + chartBtn; return wire(); }
    const now = P.rows[0];
    if (!now.p) { el.innerHTML = head + `<div class="ah-card ah-empty"><b>You are outside the forecast area</b><p>${pos(A.boat[0], A.boat[1])} is not covered by this chart (6–32°N, 64–10°W).</p></div>` + chartBtn; return wire(); }
    const n = now.p, T = tl(now.ms);
    const ahead = P.rows.slice(1).filter(r => r.p);
    const worst = ahead.length ? ahead.reduce((a, b) => (b.p.wg > a.p.wg ? b : a)) : null;
    const step12 = P.rows.filter((r, i) => i > 0 && r.p && (r.h % 12 === 0 || r.arrived));
    const lastArr = P.rows[P.rows.length - 1];
    const eta = tl(P.etaMs);
    const bars = P.rows.filter(r => r.p).map(r => `<i style="height:${Math.min(100, 12 + r.p.wg * 2.2)}%;background:${BC[r.p.bf]}"></i>`).join('');
    const row = r => { const t = tl(r.ms), p = r.p;
      return `<li class="ah-row${r.long ? ' long' : ''}">
        <div class="ah-when"><b>${t.day}</b><span>${t.hm} · +${Math.round(r.h)} h</span></div>
        ${chip(p.bf, 'ah-bf')}
        <div class="ah-wind">${arrow(p.wd, 22)}<div><b>${p.wd == null ? '' : compass(p.wd) + ' '}${p.ws}</b><span>gust ${p.wg}</span></div></div>
        <div class="ah-sea"><b>${m1(p.hs)}</b><span>${p.tp == null ? '' : Math.round(p.tp) + ' s'}</span></div>
        <div class="ah-flag">${p.squalls ? '<i class="sq">Squalls</i>' : ''}${r.arrived ? '<i class="arr">Arrive</i>' : ''}${r.long ? '<i class="tr">Trend only</i>' : ''}</div>
      </li>`; };
    el.innerHTML = head + `
      <section class="ah-card ah-now" aria-label="Conditions now">
        <div class="ah-lab">NOW · YOUR POSITION · ${T.hm} UTC</div>
        <div class="ah-pos">${pos(A.boat[0], A.boat[1])}</div>
        <div class="ah-big">${chip(n.bf, 'ah-bfbig')}<div class="ah-wbig">${arrow(n.wd, 44)}<div><b>${n.wd == null ? '' : compass(n.wd) + ' '}${n.ws}<small> kn</small></b><span>gusts ${n.wg} kn</span></div></div></div>
        <div class="ah-trio">
          <div><span>Sea</span><b>${m1(n.hs)}</b><em>${n.tp == null ? '' : Math.round(n.tp) + ' s'}${n.hd == null ? '' : ' · from ' + compass(n.hd)}</em></div>
          <div><span>Swell</span><b>${m1(n.sh)}</b><em>${n.sd == null ? '' : 'from ' + compass(n.sd)}</em></div>
          <div><span>Squalls</span><b class="${n.squalls ? 'warn' : ''}">${n.squalls ? 'Likely' : 'Unlikely'}</b><em>rain ${n.rain.toFixed(1)} mm/6 h</em></div>
        </div>
      </section>
      ${worst ? `<div class="ah-worst"><span>Worst ahead</span><b>${tl(worst.ms).day} ${tl(worst.ms).hm}: F${worst.p.bf}, gusts ${worst.p.wg} kn</b></div>` : ''}
      <div class="ah-card ah-spark" aria-hidden="true"><div class="ah-bars">${bars}</div><div class="ah-ax"><span>Now</span><span>${lastArr.arrived ? 'Arrive ' + eta.day + ' ' + eta.hm : 'End of forecast'}</span></div></div>
      <div class="ah-hd"><b>Ahead on your route</b>
        <div class="ah-spd"><button id="ahSlow" aria-label="Slower">−</button><span id="ahKn">${A.kn.toFixed(1)} kn</span><button id="ahFast" aria-label="Faster">+</button></div></div>
      <p class="ah-sub">${Math.round(P.dist)} nm to ${A.finName} · ${P.beyond ? 'arrival is beyond the forecast' : 'arrive ' + eta.day + ' ' + eta.hm + ' UTC'} · straight line from your position</p>
      <ol class="ah-list">${step12.map(row).join('')}</ol>
      ${chartBtn}
      <p class="ah-note">Model forecast (${A.wx.model.split('·')[0].trim()}), 2° grid. Squalls are a rain and instability estimate (low confidence). Beyond 5 days, trend only. Check against official forecasts.</p>`;
    wire();
  }
  function wire() {
    const c = $('ahChart'); if (c) c.onclick = () => show(false);
    const ng = $('ahNight'); if (ng) ng.onclick = () => { const b = $('bNight'); if (b) b.click(); else document.body.classList.toggle('night'); ng.setAttribute('aria-pressed', document.body.classList.contains('night')); };
    const sl = $('ahSlow'), fa = $('ahFast');
    if (sl) sl.onclick = () => speed(-0.5); if (fa) fa.onclick = () => speed(0.5);
  }
  function speed(d) { A.kn = Math.max(2, Math.min(12, Math.round((A.kn + d) * 2) / 2)); store.set('speed', A.kn); render(); }
  function show(on) {
    const el = $('ahead'); if (!el) return;
    el.hidden = !on; document.body.classList.toggle('ahead-on', on);
    if (on) { render(); el.scrollTop = 0; }
    else window.dispatchEvent(new Event('resize'));   // the chart measures itself again
  }

  window.CNAhead = {
    ready(wx, boat, fin) { A.wx = wx; A.boat = boat; A.fin = [fin.lat, fin.lon]; A.finName = fin.name.split(',')[0]; if (!$('ahead').hidden) render(); },
    boat(b) { A.boat = b; if (!$('ahead').hidden) render(); },
    show,
    failed(e) { const el = $('ahead'); if (el && !el.hidden && !A.wx) { el.innerHTML = `<div class="ah-top"><a class="ah-back" href="/">‹ Dashboard</a></div><div class="ah-card ah-empty"><b>The forecast did not load</b><p>Reload the page when you have signal.${e && e.message ? ' (' + String(e.message).replace(/[<>&]/g, '') + ')' : ''}</p><button class="ah-chart" id="ahReload">Reload</button></div>`; const b = $('ahReload'); if (b) b.onclick = () => location.reload(); } },
    _plan: () => plan()
  };
  window.addEventListener('error', e => { if (!A.wx) window.CNAhead.failed(new Error('page error: ' + e.message)); });
  setTimeout(() => { if (!A.wx) window.CNAhead.failed(new Error('the chart did not start; reload the page')); }, 25000);   // never "Loading" for ever
  document.addEventListener('DOMContentLoaded', () => { const b = $('bAhead'); if (b) b.onclick = () => show(true); if ($('ahead') && !$('ahead').hidden) document.body.classList.add('ahead-on'); });
})();
