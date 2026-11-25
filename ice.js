// Crow's Nest - sea ice near the vessel (25 Nov 2026). Daily sea ice CONCENTRATION on a 25 km grid (NSIDC Climate Data Record,
// near-real-time, northern hemisphere) read through NOAA's ERDDAP; shows how close the ice edge is and a small local map.
// SAFETY: concentration is an area average. It does NOT show icebergs, bergy bits or growlers, and it is a day or more old.
// Aid only: the ice charts of the DMI / Greenland Ice Service and the Canadian Ice Service are the authority. Never for navigation.
// The dataset's variable and axis names are discovered from ERDDAP's own info page (not hard-coded) because the format could not
// be checked from the build sandbox (NOAA blocks shared CI addresses): any surprise ends as a plain "unavailable", never a guess.
// Route (behind the sign-in gate): GET /api/ice?lat&lon (else the last position). Env: ICE_BASE, ICE_DATASET.
'use strict';
const BASE = () => process.env.ICE_BASE || 'https://coastwatch.pfeg.noaa.gov';
const DS = () => process.env.ICE_DATASET || 'nsidcG10016v3nh1day';
const A = 6378137, E = 0.081819191, RAD = Math.PI / 180, LAT_TS = 70, LON0 = -45;
const tf = p => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - E * Math.sin(p)) / (1 + E * Math.sin(p)), E / 2);
const TC = tf(LAT_TS * RAD), MC = Math.cos(LAT_TS * RAD) / Math.sqrt(1 - E * E * Math.pow(Math.sin(LAT_TS * RAD), 2));
// NSIDC polar stereographic north (true scale at 70N, central meridian 45W): degrees <-> metres
function fwd(lat, lon) { const rho = A * MC * tf(lat * RAD) / TC, d = (lon - LON0) * RAD; return { x: rho * Math.sin(d), y: -rho * Math.cos(d) }; }
function inv(x, y) {
  const rho = Math.hypot(x, y), t = rho * TC / (A * MC), chi = Math.PI / 2 - 2 * Math.atan(t), e2 = E * E, e4 = e2 * e2, e6 = e4 * e2, e8 = e4 * e4;
  const phi = chi + (e2 / 2 + 5 * e4 / 24 + e6 / 12 + 13 * e8 / 360) * Math.sin(2 * chi) + (7 * e4 / 48 + 29 * e6 / 240 + 811 * e8 / 11520) * Math.sin(4 * chi) + (7 * e6 / 120 + 81 * e8 / 1120) * Math.sin(6 * chi) + (4279 * e8 / 161280) * Math.sin(8 * chi);
  return { lat: phi / RAD, lon: LON0 + Math.atan2(x, -y) / RAD };
}
const nmBetween = (a, b) => { const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD, h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2; return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h))); };
const bearing = (a, b) => { const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD), x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD); return (Math.atan2(y, x) / RAD + 360) % 360; };

const csvRow = l => { const o = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; };
let meta = null;   // { v, dims:[names], pct }
async function discover(get) {
  if (meta) return meta;
  const rows = (await get(`${BASE()}/erddap/info/${DS()}/index.csv`)).split(/\r?\n/).filter(Boolean).map(csvRow);
  const dims = rows.filter(r => r[0] === 'dimension').map(r => r[1]);
  const vars = rows.filter(r => r[0] === 'variable').map(r => r[1]);
  const v = vars.find(n => /conc/i.test(n) && !/stdev|qa|flag|min|max|std/i.test(n));
  if (!v || dims.length < 3) throw new Error('the ice data set has an unexpected layout');
  const unit = (rows.find(r => r[0] === 'attribute' && r[1] === v && r[2] === 'units') || [])[4] || '';
  meta = { v, dims, pct: /%|percent/i.test(unit) };
  return meta;
}
// concentration 0..1 or null (land, coast, pole hole, missing: ERDDAP/NSIDC flags are above 1)
const conc = (x, pct) => { if (x == null || !Number.isFinite(+x)) return null; const c = pct ? +x / 100 : +x; return c < -0.001 || c > 1.001 ? null : Math.max(0, Math.min(1, c)); };

// pure: from a table of cells [{x, y, c}] and the position -> what the dashboard needs
function summarise(cells, pos, half) {
  const here = fwd(pos.lat, pos.lon), n = 2 * half + 1, grid = Array.from({ length: n }, () => Array(n).fill(null));
  const STEP = 25000, cx = Math.floor(here.x / STEP) * STEP + STEP / 2, cy = Math.floor(here.y / STEP) * STEP + STEP / 2;   // NSIDC cell centres sit half a cell off the 25 km lines
  let near15 = null, near50 = null, hereC = null;
  for (const c of cells) {
    const gx = Math.round((c.x - cx) / STEP) + half, gy = half - Math.round((c.y - cy) / STEP);   // row 0 = top of the picture; screen up = grid y up, close to north near the vessel
    const cc = conc(c.c, false);
    if (gx >= 0 && gx < n && gy >= 0 && gy < n) grid[gy][gx] = cc == null ? null : Math.round(cc * 100);
    if (cc == null) continue;
    const p = inv(c.x, c.y), d = nmBetween(pos, p), b = bearing(pos, p);
    if (Math.abs(c.x - here.x) <= STEP / 2 && Math.abs(c.y - here.y) <= STEP / 2) hereC = Math.round(cc * 100);
    if (cc >= 0.15 && (!near15 || d < near15.distNm)) near15 = { distNm: Math.round(d), bearing: Math.round(b), conc: Math.round(cc * 100), lat: +p.lat.toFixed(2), lon: +p.lon.toFixed(2) };
    if (cc >= 0.5 && (!near50 || d < near50.distNm)) near50 = { distNm: Math.round(d), bearing: Math.round(b), conc: Math.round(cc * 100), lat: +p.lat.toFixed(2), lon: +p.lon.toFixed(2) };
  }
  return { here: hereC, near15, near50, grid, cellKm: 25, half, rot: +(pos.lon - LON0).toFixed(1) };   // rot: turn the picture this many degrees clockwise to put north up
}

module.exports = function ice(app, { lastPosition }) {
  const cache = new Map();   // cell key -> { at, body }
  const get = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'CrowsNest/1.0 (private marine dashboard)' } }); const t = await r.text(); if (!r.ok) { const e = new Error('ice data service answered ' + r.status); e.body = t; throw e; } return t; };
  async function load(pos) {
    const m = await discover(get), half = 12, STEP = 25000, c = fwd(pos.lat, pos.lon);
    const cx = Math.floor(c.x / STEP) * STEP + STEP / 2, cy = Math.floor(c.y / STEP) * STEP + STEP / 2, R = half * STEP + STEP / 2;
    const yi = m.dims.findIndex(d => /^y|lat|row/i.test(d)), xi = m.dims.findIndex(d => /^x|lon|col/i.test(d));
    if (yi < 0 || xi < 0) throw new Error('the ice data set axes are not recognised');
    const rng = (lo, hi, desc) => desc ? `[(${hi}):(${lo})]` : `[(${lo}):(${hi})]`;
    const q = (dy, dx) => `${BASE()}/erddap/griddap/${DS()}.json?${m.v}` + m.dims.map((d, i) => i === yi ? rng(cy - R, cy + R, dy) : i === xi ? rng(cx - R, cx + R, dx) : '[(last)]').join('');
    let text, err;
    for (const [dy, dx] of [[true, false], [false, false], [true, true], [false, true]]) { try { text = await get(q(dy, dx)); break; } catch (e) { err = e; if (!/\b(400|404)\b/.test(String(e.message))) throw e; } }
    if (!text) throw err;
    const t = JSON.parse(text).table, col = n => t.columnNames.findIndex(x => x === n);
    const ti = col('time'), ix = col(m.dims[xi]), iy = col(m.dims[yi]), iv = col(m.v);
    if (ix < 0 || iy < 0 || iv < 0) throw new Error('the ice data set sent unexpected columns');
    const cells = t.rows.map(r => ({ x: +r[ix], y: +r[iy], c: conc(r[iv], m.pct) })), date = ti >= 0 && t.rows[0] ? String(t.rows[0][ti]).slice(0, 10) : null;
    const s = summarise(cells.map(c => ({ x: c.x, y: c.y, c: c.c })), pos, half);
    return Object.assign({ configured: true, date, source: 'NSIDC sea ice concentration (near real time, 25 km) via NOAA ERDDAP', warning: 'Concentration only: icebergs, bergy bits and growlers are NOT shown, and the data is a day or more old. Use the ice charts of the Greenland Ice Service (DMI) or Canadian Ice Service. Not for navigation.', links: [{ name: 'DMI ice charts', url: 'https://ocean.dmi.dk/arctic/icecharts.uk.php' }, { name: 'Canadian Ice Service', url: 'https://iceweb1.cis.ec.gc.ca/Archive/page1.xhtml' }] }, s);
  }
  app.get('/api/ice', async (req, res) => {
    let pos = { lat: parseFloat(req.query.lat), lon: parseFloat(req.query.lon) };
    if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon) || Math.abs(pos.lat) > 90 || Math.abs(pos.lon) > 180) pos = lastPosition();
    if (!pos) return res.json({ configured: true, relevant: false, reason: 'no position yet' });
    if (pos.lat < 45) return res.json({ configured: true, relevant: false, reason: 'Sea ice is only a concern north of about 45°N.' });
    const key = Math.round(pos.lat * 4) + ',' + Math.round(pos.lon * 4);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 3 * 3600000) return res.json(hit.body);
    try { const body = await load(pos); body.relevant = true; cache.set(key, { at: Date.now(), body }); res.json(body); }
    catch (e) {
      console.error('ice data failed: ' + String(e.message || e).slice(0, 200));
      if (hit) return res.json(Object.assign({}, hit.body, { stale: true }));
      res.json({ configured: true, relevant: true, failed: true, error: String(e.message || e).slice(0, 160), links: [{ name: 'DMI ice charts', url: 'https://ocean.dmi.dk/arctic/icecharts.uk.php' }] });
    }
  });
  return { fwd, inv, summarise };
};
module.exports.fwd = fwd; module.exports.inv = inv; module.exports.summarise = summarise;
