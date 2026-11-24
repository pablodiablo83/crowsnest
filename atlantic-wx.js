// Atlantic weather engine (server, 24 Nov 2026): keeps the forecast behind /atlantic.html ("Now and ahead" and the chart)
// fresh instead of a frozen snapshot. Every 6 h it fetches the 2° grid (6-32°N, 64-10°W, 392 points) from Open-Meteo:
// ECMWF IFS 0.25° for wind, gusts, pressure, rain and CAPE, and Open-Meteo Marine for waves and swell, 10 days, 6-hourly.
// Same format as the bundled snapshot (public/atlantic/wx.json; built by the Brain repo's tools/arc-weather-map/fetch.py):
// knots, degrees FROM, pressure hPa x10, rain mm in the 6 h ending at the step x10, heights m x10, CAPE rounded to 10.
// The last good copy is kept in DATA_DIR/atlantic-wx.json and served while a refresh fails; with no copy, the bundled one.
// Routes (behind the sign-in gate; /api/v1/... for the phone app): GET /api/atlantic/wx, GET /api/atlantic/status,
// POST /api/atlantic/refresh (master only, at most every 10 min). NO_WX_REFRESH=1 stops the timer (tests).
// Open-Meteo's free API is for non-commercial use: a paid plan (customer-api host) is needed before Crow's Nest is sold.
const fs = require('fs'), path = require('path');

const LATS = []; for (let la = 6; la <= 32; la += 2) LATS.push(la);
const LONS = []; for (let lo = -64; lo <= -10; lo += 2) LONS.push(lo);
const POINTS = []; for (const la of LATS) for (const lo of LONS) POINTS.push([la, lo]);
const DAYS = 10, BATCH = 50, EVERY_MS = 6 * 3600e3, RETRY_MS = 30 * 60e3, MANUAL_GAP_MS = 10 * 60e3;
const MODEL = 'ECMWF IFS 0.25° (wind, pressure, rain) · Open-Meteo Marine (waves)';
const FC_VARS = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,cape';
const MR_VARS = 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period';
const KEYS = ['ws', 'wd', 'wg', 'p', 'r', 'cape', 'hs', 'hd', 'tp', 'sh', 'sd', 'sp'];

// Pure: Open-Meteo responses (one object per point, in POINTS order) -> the page's wx object. Steps every 6 h from 6 h
// before `nowMs`. Kept separate from fetching so tests and the live check can feed it.
function build(fc, mr, nowMs) {
  if (!Array.isArray(fc) || !Array.isArray(mr) || fc.length !== POINTS.length || mr.length !== POINTS.length) throw new Error('expected ' + POINTS.length + ' points from each service');
  const times = fc[0].hourly && fc[0].hourly.time;
  if (!Array.isArray(times) || !times.length) throw new Error('no hourly times');
  const mtimes = mr[0].hourly && mr[0].hourly.time;
  const ms = t => Date.parse(t + (t.length === 16 ? ':00Z' : 'Z'));
  const idx = [];
  times.forEach((t, k) => { if (Number(t.slice(11, 13)) % 6 === 0 && ms(t) >= nowMs - 6 * 3600e3) idx.push(k); });
  const mIndex = new Map((mtimes || []).map((t, k) => [t, k]));   // waves keyed by time, in case the two hourly axes differ
  const num = (v, f) => (v == null || !Number.isFinite(v) ? null : f(v));
  const col = (src, v, k, f) => src.map(s => num(s.hourly && s.hourly[v] ? s.hourly[v][k] : null, f));
  const mcol = (v, t, f) => { const k = mIndex.get(t); return mr.map(s => (k == null ? null : num(s.hourly && s.hourly[v] ? s.hourly[v][k] : null, f))); };
  const rain = (s, k) => { const a = ((s.hourly && s.hourly.precipitation) || []).slice(Math.max(0, k - 5), k + 1).filter(x => x != null && Number.isFinite(x)); return a.length ? Math.round(a.reduce((x, y) => x + y, 0) * 10) : null; };
  const D = {}; KEYS.forEach(k => { D[k] = []; });
  for (const k of idx) {
    const t = times[k];
    D.ws.push(col(fc, 'wind_speed_10m', k, Math.round));
    D.wd.push(col(fc, 'wind_direction_10m', k, Math.round));
    D.wg.push(col(fc, 'wind_gusts_10m', k, Math.round));
    D.p.push(col(fc, 'pressure_msl', k, v => Math.round(v * 10)));
    D.r.push(fc.map(s => rain(s, k)));
    D.cape.push(col(fc, 'cape', k, v => Math.round(v / 10) * 10));
    D.hs.push(mcol('wave_height', t, v => Math.round(v * 10)));
    D.hd.push(mcol('wave_direction', t, Math.round));
    D.tp.push(mcol('wave_period', t, Math.round));
    D.sh.push(mcol('swell_wave_height', t, v => Math.round(v * 10)));
    D.sd.push(mcol('swell_wave_direction', t, Math.round));
    D.sp.push(mcol('swell_wave_period', t, Math.round));
  }
  const fetched = new Date(nowMs).toISOString().slice(0, 16) + 'Z';
  return { fetched, model: MODEL, lats: LATS.slice(), lons: LONS.slice(), times: idx.map(k => ms(times[k])).map(x => new Date(x).toISOString().slice(0, 16) + 'Z'), d: D };
}

// A copy is only kept if it looks whole: right grid, enough steps, wind almost everywhere, waves over most of the sea.
function check(wx) {
  if (!wx || wx.lats.length !== LATS.length || wx.lons.length !== LONS.length) return 'wrong grid';
  if (!Array.isArray(wx.times) || wx.times.length < 20) return 'only ' + (wx.times ? wx.times.length : 0) + ' forecast steps';
  for (const k of KEYS) if (!wx.d[k] || wx.d[k].length !== wx.times.length || wx.d[k].some(a => a.length !== POINTS.length)) return 'incomplete ' + k;
  const share = a => a.filter(v => v != null).length / a.length;
  if (share(wx.d.ws[0]) < 0.95) return 'wind missing at ' + Math.round((1 - share(wx.d.ws[0])) * 100) + '% of points';
  if (share(wx.d.hs[0]) < 0.5) return 'waves missing at most points';
  return null;
}

module.exports = function atlanticWx(app, { DATA_DIR, curDevice }) {
  const FORECAST = (process.env.OPEN_METEO_BASE || 'https://api.open-meteo.com').replace(/\/+$/, '');
  const MARINE = (process.env.OPEN_METEO_MARINE_BASE || 'https://marine-api.open-meteo.com').replace(/\/+$/, '');
  const FILE = path.join(DATA_DIR, 'atlantic-wx.json'), BUNDLED = path.join(__dirname, 'public', 'atlantic', 'wx.json');
  const st = { cur: null, json: null, source: null, lastTry: 0, lastOk: 0, lastError: null, job: null };

  function use(json, source) {
    const wx = JSON.parse(json); const bad = check(wx);
    if (bad) throw new Error(bad);
    st.cur = wx; st.json = json; st.source = source;
  }
  for (const [f, s] of [[FILE, 'server'], [BUNDLED, 'bundled']]) {   // newest kept copy first, else the one shipped with the code
    try { use(fs.readFileSync(f, 'utf8'), s); break; } catch (e) { if (f === FILE && fs.existsSync(f)) console.error('atlantic-wx: kept copy unreadable:', e.message); }
  }
  const fetchedMs = () => (st.cur ? Date.parse(st.cur.fetched.replace(/Z$/, ':00Z')) : 0);

  async function getJson(url) {
    let err;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || d.error) throw new Error((d && d.reason) || 'upstream ' + r.status);
        return Array.isArray(d) ? d : [d];
      } catch (e) { err = e; await new Promise(res => setTimeout(res, 2000 * (i + 1))); }
    }
    throw err;
  }
  async function refresh() {
    if (st.job) return st.job;
    st.lastTry = Date.now();
    st.job = (async () => {
      const fc = [], mr = [];
      for (let i = 0; i < POINTS.length; i += BATCH) {
        const b = POINTS.slice(i, i + BATCH), la = b.map(p => p[0]).join(','), lo = b.map(p => p[1]).join(',');
        fc.push(...await getJson(`${FORECAST}/v1/forecast?latitude=${la}&longitude=${lo}&hourly=${FC_VARS}&wind_speed_unit=kn&forecast_days=${DAYS}&models=ecmwf_ifs025&timezone=UTC`));
        mr.push(...await getJson(`${MARINE}/v1/marine?latitude=${la}&longitude=${lo}&hourly=${MR_VARS}&forecast_days=${DAYS}&timezone=UTC`));
      }
      const wx = build(fc, mr, Date.now()), bad = check(wx);
      if (bad) throw new Error('forecast rejected: ' + bad);
      const json = JSON.stringify(wx), tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, json); fs.renameSync(tmp, FILE);   // never a half-written file
      use(json, 'server'); st.lastOk = Date.now(); st.lastError = null;
      console.log(`atlantic-wx: forecast ${wx.fetched}, ${wx.times.length} steps`);
      return wx;
    })().catch(e => { st.lastError = String(e.message || e).slice(0, 200); console.error('atlantic-wx: refresh failed:', st.lastError); throw e; })
      .finally(() => { st.job = null; });
    return st.job;
  }
  // every 30 min: refresh when the copy is 6 h old, not more than once per 30 min after a failure
  function tick() { if (Date.now() - fetchedMs() >= EVERY_MS && Date.now() - st.lastTry >= RETRY_MS) refresh().catch(() => {}); }
  if (!process.env.NO_WX_REFRESH) { setTimeout(tick, 20000).unref(); setInterval(tick, RETRY_MS).unref(); }

  const status = () => ({ source: st.source, fetched: st.cur && st.cur.fetched, steps: st.cur && st.cur.times.length,
    ageHours: st.cur ? Math.round((Date.now() - fetchedMs()) / 360e3) / 10 : null, refreshing: !!st.job,
    lastAttempt: st.lastTry ? new Date(st.lastTry).toISOString() : null, lastError: st.lastError, model: MODEL });

  app.get('/api/atlantic/wx', (req, res) => {
    if (!st.json) return res.status(503).json({ error: 'no Atlantic forecast available yet' });
    // revalidate with our own ETag (one per forecast copy): a phone on satellite only downloads a new forecast
    const tag = '"wx-' + st.source + '-' + st.cur.fetched + '"';
    res.set({ 'Cache-Control': 'no-cache', 'X-Wx-Source': st.source, ETag: tag });
    if (String(req.get('If-None-Match') || '').split(/\s*,\s*/).includes(tag)) return res.status(304).end();
    res.type('application/json').send(st.json);
  });
  app.get('/api/atlantic/status', (req, res) => res.json(status()));
  app.post('/api/atlantic/refresh', async (req, res) => {
    const d = curDevice && curDevice();
    if (d && d.role !== 'master') return res.status(403).json({ error: 'master only' });
    if (!st.job && Date.now() - st.lastTry < MANUAL_GAP_MS) return res.status(429).json({ error: 'refreshed less than 10 minutes ago', ...status() });
    try { await refresh(); res.json(status()); } catch (e) { res.status(502).json(status()); }
  });

  return { refresh, status, build, check };
};
module.exports.build = build;
module.exports.check = check;
module.exports.POINTS = POINTS;
