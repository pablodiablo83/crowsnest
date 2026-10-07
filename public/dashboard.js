// Crow's Nest — main dashboard

const WMO_ICON = c => {
  if (c === 0) return '☀️';
  if (c <= 2) return '⛅';
  if (c === 3) return '☁️';
  if (c <= 48) return '🌫️';
  if (c <= 67) return '🌦️';
  if (c <= 77) return '🌨️';
  if (c <= 82) return '🌦️';
  if (c <= 86) return '🌨️';
  return '⛈️';
};
const COMPASS = d => {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(d / 22.5) % 16];
};
// points DOWNWIND (the way the wind blows), like the wind page; d is the meteorological 'from' direction
const ARROW = d => `<span style="display:inline-block;transform:rotate(${(d + 180) % 360}deg);">&#8593;</span>`;
const $ = id => document.getElementById(id);
const p2 = n => String(n).padStart(2, '0');

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
function setText(id, text) { $(id).innerHTML = text; }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ---------- Weather + wind ----------
async function loadWeatherAndWind(lat, lon) {
  try {
    const d = await getJson(`/api/weather?lat=${lat}&lon=${lon}`);
    if (d.error) throw new Error(d.error);
    setText('weatherIcon', WMO_ICON(d.weatherCode));
    setText('weatherTemp', `${Math.round(d.temperatureC)}&deg;C`);
    setText('weatherSub', 'Open-Meteo forecast');
  } catch (e) {
    setText('weatherSub', 'Weather unavailable');
  }
  // wind from the model chosen on the wind page (same numbers there and here)
  try {
    let m = ''; try { m = localStorage.getItem('cn_windModel') || ''; } catch (e) {}
    const w = await getJson(`/api/wind?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&days=1${m ? '&model=' + encodeURIComponent(m) : ''}`);
    const c = w.current || { kn: w.kn[0], dir: w.dir[0], gust: w.gust[0] };
    setText('windArrow', ARROW(c.dir));
    setText('windSpeed', `${Math.round(c.kn)}kn`);
    setText('windSub', `from ${COMPASS(c.dir)}` + (c.gust != null ? ` &middot; gusts ${Math.round(c.gust)}kn` : '') + `<br>${esc(w.model.label)} &middot; tap for forecast`);
  } catch (e) {
    setText('windSub', 'Wind unavailable &middot; tap for forecast');
  }
}

// ---------- Tides ----------
async function loadTides() {
  try {
    const d = await getJson('/api/tides');
    if (!d.configured) { setText('tidesSub', 'Not set up yet &mdash; needs a tide data provider'); return; }
    if (d.error) { setText('tidesSub', 'Tide data unavailable'); return; }
    const next = (d.events || []).slice(0, 2);
    if (!next.length) { setText('tidesSub', 'No upcoming events returned'); return; }
    const fmt = iso => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    setText('tidesSub', next.map(e => `${e.type === 'high' ? 'High' : 'Low'} ${fmt(e.time)} &middot; ${e.heightM}m`).join('<br>'));
  } catch (e) {
    setText('tidesSub', 'Tide data unavailable');
  }
}

// ---------- Hours of rest ----------
async function loadHorSummary() {
  try {
    const d = await getJson('/api/dashboard/hor-summary');
    if (!d.configured) { setText('horSub', 'Tap to add crew &amp; start logging &rarr;'); return; }
    const mins = d.compliance.rest24Minutes;
    const pct = Math.max(0, Math.min(1, mins / d.compliance.thresholds.min10h));
    $('horRingFill').style.strokeDashoffset = String(326.7 * (1 - pct));
    setText('horRingCenter', `${Math.floor(mins / 60)}h<br>${Math.round(mins % 60)}m`);
    const label = d.status === 'rest' ? 'Resting' : d.status === 'work' ? 'Working' : 'No open period';
    setText('horSub', `${d.crewName} &middot; ${label}`);
  } catch (e) {
    setText('horSub', 'Hours of Rest unavailable');
  }
}

// ---------- Log tile ----------
async function loadLogTile() {
  try {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const d = await getJson(`/api/log?limit=1&since=${encodeURIComponent(midnight.toISOString())}`);
    setText('logCount', String(d.today));
    setText('logCountSub', d.today === 1 ? 'entry today' : 'entries today');
    if (!d.entries.length) { setText('logLast', 'Nothing logged yet &mdash; tap to start'); return; }
    const e = d.entries[0], t = new Date(e.ts);
    setText('logLast', `${p2(t.getHours())}:${p2(t.getMinutes())} &middot; ${esc(e.text)}`);
  } catch (e) {
    setText('logLast', 'Log unavailable');
  }
}

// ---------- Position ----------
function ddm(v, pos, neg) {
  const a = Math.abs(v), deg = Math.floor(a), min = (a - deg) * 60;
  const degStr = String(deg).padStart(pos === 'N' ? 2 : 3, '0');
  return `${degStr}&deg;${min.toFixed(3).padStart(6, '0')}&prime;${v >= 0 ? pos : neg}`;
}
function ddmPlain(v, pos, neg) {
  const a = Math.abs(v), deg = Math.floor(a), min = (a - deg) * 60;
  return `${String(deg).padStart(pos === 'N' ? 2 : 3, '0')}°${min.toFixed(3).padStart(6, '0')}′${v >= 0 ? pos : neg}`;
}
function ageText(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

let fix = null;          // { lat, lon, acc, ts, source }
let lastWeatherAt = 0;

function saveFix() {
  try { localStorage.setItem('cn_fix', JSON.stringify(fix)); } catch (e) {}
}
function loadSavedFix() {
  try { return JSON.parse(localStorage.getItem('cn_fix') || 'null'); } catch (e) { return null; }
}

async function lookupPlace(f) {
  try {
    const d = await getJson(`/api/place?lat=${f.lat}&lon=${f.lon}`);
    if (sameSpot(f)) setText('locName', d.name ? esc(d.name) : 'Open water');
  } catch (e) {
    if (sameSpot(f)) setText('locName', 'Position');
  }
}

function showFix() {
  setText('locDdm', `${ddm(fix.lat, 'N', 'S')}<br>${ddm(fix.lon, 'E', 'W')}`);
  const mov = fix.sog != null && fix.sog >= 0.5 ? ` &middot; SOG ${fix.sog.toFixed(1)} kn${fix.cog != null ? ` &middot; COG ${String(Math.round(fix.cog)).padStart(3, '0')}&deg;` : ''}` : '';
  setText('locDec', `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}${mov}`);
  const src = fix.source === 'gps' ? 'GPS' : fix.source === 'manual' ? 'Manual' : 'Last known';
  const acc = fix.acc ? ` &plusmn;${Math.round(fix.acc)} m` : '';
  setText('locMeta', `${src}${acc} &middot; ${ageText(fix.ts)} &middot; tap to copy`);
}

function setFix(lat, lon, acc, source, extra) {
  const moved = !fix || Math.abs(fix.lat - lat) > 0.005 || Math.abs(fix.lon - lon) > 0.005;
  fix = Object.assign({ lat, lon, acc, ts: Date.now(), source }, extra || {});
  saveFix();
  showFix();
  if (moved) { setText('locName', 'Finding place…'); lookupPlace(fix); }
  if (Date.now() - lastWeatherAt > 15 * 60 * 1000) { lastWeatherAt = Date.now(); loadWeatherAndWind(lat, lon); }
  if (source === 'gps') maybeAutoRecord(fix);
}

function noFix() {
  const saved = loadSavedFix();
  if (!fix && saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
    fix = { lat: saved.lat, lon: saved.lon, acc: null, ts: saved.ts || Date.now(), source: 'saved' };
    showFix(); setText('locName', 'Last known position'); lookupPlace(fix);
    lastWeatherAt = Date.now(); loadWeatherAndWind(fix.lat, fix.lon);
  } else if (!fix) {
    setText('locName', 'No position fix'); setText('locDdm', '—'); setText('locMeta', 'Enter it below');
    setText('weatherSub', 'Needs a position'); setText('windSub', 'Needs a position');
  }
  $('locationBox').style.display = 'block';
}

let fixing = false;
function getPos(opts) {
  return new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, opts));
}
async function requestFix() {
  if (!navigator.geolocation) { noFix(); return; }
  if (fixing) return;
  fixing = true;
  let got = false;
  const use = pos => {
    got = true; $('locationBox').style.display = 'none';
    setFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, 'gps', fromCoords(pos));
  };
  try { use(await getPos({ enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 })); } catch (e) {}
  try { use(await getPos({ enableHighAccuracy: true, timeout: 25000, maximumAge: 30000 })); } catch (e) {}
  if (!got && !fix) noFix();
  fixing = false;
}
function sameSpot(f) {
  return fix && Math.abs(fix.lat - f.lat) < 0.005 && Math.abs(fix.lon - f.lon) < 0.005;
}

$('manualLocBtn').addEventListener('click', () => {
  const lat = parseFloat($('manualLat').value), lon = parseFloat($('manualLon').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    alert('Enter valid numbers: latitude -90 to 90, longitude -180 to 180.'); return;
  }
  $('locationBox').style.display = 'none';
  lastWeatherAt = 0;
  setFix(lat, lon, null, 'manual');
  if (TRK.status && TRK.status.voyageOpen) sendFix(fix, 'typed');
});

async function copyFix() {
  if (!fix) return;
  const text = `${ddmPlain(fix.lat, 'N', 'S')} ${ddmPlain(fix.lon, 'E', 'W')} (${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)})`;
  try { await navigator.clipboard.writeText(text); setText('locMeta', 'Copied'); }
  catch (e) { setText('locMeta', 'Copy not available'); }
  setTimeout(() => { if (fix) showFix(); }, 1500);
}
$('locCard').addEventListener('click', copyFix);
$('locCard').addEventListener('keydown', e => { if (e.key === 'Enter') copyFix(); });


// ---------- Voyage track recorder ----------
// Records a position while a voyage is open: on every WORK/REST tap, when the voyage ends, and on a timer while this page is open.
// A phone cannot track in the background, so gaps while the screen is off are expected; the map draws them dashed.
const TRK = { status: null, lastSent: null };
const QKEY = 'cn_posq';
function qLoad() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; } }
function qSave(q) { try { localStorage.setItem(QKEY, JSON.stringify(q.slice(-500))); } catch (e) {} }
const newPosId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function fromCoords(pos) {
  const c = pos.coords;
  return {
    gpsTs: pos.timestamp,
    sog: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed * 1.943844 : null,
    cog: Number.isFinite(c.heading) && c.heading >= 0 ? c.heading : null
  };
}
function nmBetween(a, b) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}
async function postPos(body) {
  const r = await fetch('/api/positions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}
async function flushQueue() {
  const q = qLoad(); if (!q.length) return;
  const rest = [];
  for (const b of q) { try { await postPos(b); } catch (e) { if (!(e.status >= 400 && e.status < 500)) rest.push(b); } }
  qSave(rest);
}
async function sendFix(f, source) {
  const body = { id: newPosId(), ts: new Date(f.gpsTs || f.ts).toISOString(), lat: f.lat, lon: f.lon, source };
  if (f.acc != null) body.acc = Math.round(f.acc);
  if (f.sog != null) body.sog = Math.round(f.sog * 10) / 10;
  if (f.cog != null) body.cog = Math.round(f.cog);
  TRK.lastSent = { ts: Date.parse(body.ts), lat: f.lat, lon: f.lon };
  try { await postPos(body); await flushQueue(); }
  catch (e) {
    if (!(e.status >= 400 && e.status < 500)) { const q = qLoad(); q.push(body); qSave(q); }   // offline: keep it and send later
    return false;
  }
  loadTrackTile();
  return true;
}
function maybeAutoRecord(f) {
  const s = TRK.status;
  if (!s || !s.voyageOpen || !s.intervalMin) return;
  const last = TRK.lastSent || (s.lastFix ? { ts: Date.parse(s.lastFix.ts), lat: s.lastFix.lat, lon: s.lastFix.lon } : null);
  const age = last ? Date.now() - last.ts : Infinity, moved = last ? nmBetween(last, f) : Infinity;
  if (moved < 0.1 && age < 60 * 60000) return;                     // lying still: one fix an hour is enough
  if (age >= s.intervalMin * 60000 || (age >= 120000 && moved >= 1)) sendFix(f, 'auto');   // or sooner when making way
}
async function recordNow(source) {
  let f = fix && fix.source === 'gps' && Date.now() - fix.ts < 3 * 60000 ? fix : null;
  if (!f && navigator.geolocation) {
    try { const pos = await getPos({ enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }); f = Object.assign({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, ts: Date.now() }, fromCoords(pos)); } catch (e) {}
  }
  if (!f && fix && fix.source !== 'manual' && Date.now() - fix.ts < 30 * 60000) f = fix;   // last known, if recent
  if (f) await sendFix(f, source);
  return !!f;
}
document.addEventListener('cn:tap', () => { recordNow('tap'); });
document.addEventListener('cn:voyage-end', async () => { await recordNow('end'); loadTrackTile(); });
window.addEventListener('online', () => { flushQueue(); });

function drawPath(path, live) {
  const svg = $('trackSvg');
  if (!path || path.length < 2) { svg.innerHTML = '<path class="tnone" d="M8 40 Q 50 14 100 30 T 192 20"/>'; return; }
  const lat0 = path.reduce((a, p) => a + p[0], 0) / path.length, k = Math.cos(lat0 * Math.PI / 180);
  const xs = path.map(p => p[1] * k), ys = path.map(p => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = 184, h = 44, sc = Math.min(w / ((maxX - minX) || 1e-6), h / ((maxY - minY) || 1e-6));
  const ox = 8 + (w - (maxX - minX) * sc) / 2, oy = 8 + (h - (maxY - minY) * sc) / 2;
  const pts = path.map((p, i) => [ox + (xs[i] - minX) * sc, oy + (ys[i] - minY) * sc]);
  const f = n => n.toFixed(1), last = pts[pts.length - 1], first = pts[0];
  svg.innerHTML = `<polyline points="${pts.map(p => f(p[0]) + ',' + f(p[1])).join(' ')}"/><circle class="tstart" cx="${f(first[0])}" cy="${f(first[1])}" r="3.5"/><circle class="tend" cx="${f(last[0])}" cy="${f(last[1])}" r="4.5"/>`;
}
async function loadTrackTile() {
  try {
    const s = await getJson('/api/track/status');
    TRK.status = s;
    const card = $('trackCard'), v = s.voyage;
    card.href = '/track.html' + (v ? '?voyage=' + encodeURIComponent(v.id) : '');
    card.classList.remove('fresh');
    drawPath(s.path);
    if (!s.configured || !v) { setText('trackBig', '&mdash;'); setText('trackSub', 'Starts with your first voyage'); return; }
    setText('trackBig', `${v.distanceNm.toFixed(1)}<span style="font-size:15px;font-weight:700;"> NM</span>`);
    if (s.voyageOpen) {
      const when = s.lastFix ? `last fix ${ageText(Date.parse(s.lastFix.ts))}` : 'waiting for the first fix';
      setText('trackSub', s.intervalMin ? `${v.fixes} fix${v.fixes === 1 ? '' : 'es'} &middot; ${when}` : `Recording is off &middot; ${when}`);
    } else {
      const fresh = v.end && Date.now() - Date.parse(v.end) < 36 * 3600000;
      if (fresh) card.classList.add('fresh');
      setText('trackSub', fresh ? 'Voyage ended &middot; see the trip map' : 'Last voyage &middot; open the map');
    }
  } catch (e) {
    setText('trackSub', 'Track unavailable');
  }
}

// ---------- AI bar (holding) ----------
$('agentForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const text = $('agentInput').value.trim();
  if (!text) return;
  const box = $('agentReply');
  box.style.display = 'block'; box.textContent = '…';
  try {
    const r = await fetch('/api/agent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
    });
    const d = await r.json();
    box.textContent = d.reply || d.error || 'No reply.';
  } catch (e) { box.textContent = 'Could not reach the server.'; }
});

// ---------- start ----------
requestFix();
setInterval(requestFix, 60000);
setInterval(() => { if (fix) showFix(); }, 30000);
loadHorSummary();
loadTides();
loadLogTile();
loadTrackTile(); flushQueue();
setInterval(() => { loadHorSummary(); loadLogTile(); loadTrackTile(); }, 120000);
