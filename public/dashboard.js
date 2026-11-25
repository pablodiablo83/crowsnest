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
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }

// ---------- Pictures (dashpics.js) ----------
const WMO_TEXT = c => c === 0 ? 'clear' : c <= 2 ? 'partly cloudy' : c === 3 ? 'overcast' : c <= 48 ? 'fog' : c <= 57 ? 'drizzle' : c <= 67 ? 'rain' : c <= 77 ? 'snow' : c <= 82 ? 'showers' : c <= 86 ? 'snow showers' : 'thunderstorm';
// a picture: dimmed until real data has arrived, so an empty tile never looks like a reading
function setPic(id, html, live) { const el = $(id); if (!el || !window.CNPics) return; el.innerHTML = html; el.style.opacity = live ? '' : '.35'; }
function initPics() {
  if (!window.CNPics) return;
  setPic('windPic', CNPics.wind(null, null), false); setPic('tidePic', CNPics.tide(null), false); setPic('sogPic', CNPics.sog(null), false); setPic('cogPic', CNPics.cog(null), false); setPic('nmeaPic', CNPics.boatdata(), true); setPic('icePic', CNPics.ice(null), false); setPic('wxPic', CNPics.weather(3), false);
  setPic('trackPic', CNPics.voyage(null), false); setPic('atlPic', CNPics.atlantic(), true); setPic('logPic', CNPics.logbook(''), false);
  drawPosition();
}

// ---------- Weather + wind ----------
async function loadWeatherAndWind(lat, lon) {
  try {
    const d = await getJson(`/api/weather?lat=${lat}&lon=${lon}`);
    if (d.error) throw new Error(d.error);
    setPic('wxPic', CNPics.weather(d.weatherCode), true);
    setText('weatherTemp', `${Math.round(d.temperatureC)}&deg;C`);
    setText('weatherSub', WMO_TEXT(d.weatherCode));
  } catch (e) {
    setText('weatherSub', 'Weather unavailable');
  }
  // wind from the model chosen on the wind page (same numbers there and here)
  try {
    let m = ''; try { m = localStorage.getItem('cn_windModel') || ''; } catch (e) {}
    const w = await getJson(`/api/wind?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&days=1${m ? '&model=' + encodeURIComponent(m) : ''}`);
    const c = w.current || { kn: w.kn[0], dir: w.dir[0], gust: w.gust[0] };
    setPic('windPic', CNPics.wind(c.dir, c.kn), true);
    setText('windSpeed', `from ${COMPASS(c.dir)}`);
    setText('windSub', (c.gust != null ? `gusts ${Math.round(c.gust)} kn &middot; Force ${CNPics.force(c.kn)}` : `Force ${CNPics.force(c.kn)}`) + ` ${CNPics.forceWord(c.kn)}` + `<br><small style="opacity:.8">${esc(w.model.label)}</small>`);
  } catch (e) {
    setText('windSub', 'Wind unavailable');
  }
}

// ---------- Tides ----------
async function loadTides() {
  try {
    // the port chosen on the Tides page, else the nearest to this phone's last fix (as the page does), else the server decides
    let port = '', fix = null; try { port = localStorage.getItem('cn_tidePort') || ''; fix = JSON.parse(localStorage.getItem('cn_fix') || 'null'); } catch (e) {}
    const q = port ? '?port=' + encodeURIComponent(port) : fix && isFinite(fix.lat) && isFinite(fix.lon) ? `?lat=${(+fix.lat).toFixed(3)}&lon=${(+fix.lon).toFixed(3)}` : '';
    const d = await getJson('/api/tides' + q);
    if (d.failed) { setText('tidesBig', '&mdash;'); setText('tidesSub', /^model:/.test(d.portId || '') ? 'Tides for open water could not be worked out just now. Open to retry.' : `${esc(d.port || 'Tides')}: gauge data could not be read. Open to retry.`); return; }
    if (d.analysing) { setText('tidesSub', `${esc(d.port || 'Nearest port')}: setting up (reading a year of gauge data)&hellip;`); setTimeout(loadTides, 15000); return; }
    if (!d.configured || d.error) { setText('tidesSub', 'Tide data unavailable'); return; }
    const fmt = iso => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const next = (d.events || []).slice(0, 2);
    let place = null; try { place = JSON.parse(localStorage.getItem('cn_tidePlace') || 'null'); } catch (e) {}
    const label = place && place.port === port && place.name !== d.port ? `${esc(place.name)} <small>(${esc(d.port)})</small>` : esc(d.port);
    setPic('tidePic', CNPics.tide(d), true);
    setText('tidesBig', d.now ? `${d.now.h.toFixed(1)} m ${d.now.rising ? '&uarr;' : '&darr;'}` : '&mdash;');
    setText('tidesSub', `${label}${d.model ? ' <small>&middot; world model, approximate</small>' : ''}<br>` + next.map(e => `${e.type === 'high' ? 'High' : 'Low'} ${fmt(e.time)} &middot; ${e.heightM.toFixed(1)}m`).join('<br>'));
  } catch (e) {
    setText('tidesSub', 'Tide data unavailable');
  }
}


// ---------- Sea ice (north of 45N only; concentration, not icebergs) ----------
const BRG = b => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8];
async function loadIce() {
  const card = $('iceCard'); if (!card) return;
  try {
    let fix = null; try { fix = JSON.parse(localStorage.getItem('cn_fix') || 'null'); } catch (e) {}
    const d = await getJson('/api/ice' + (fix && isFinite(fix.lat) && isFinite(fix.lon) ? `?lat=${(+fix.lat).toFixed(3)}&lon=${(+fix.lon).toFixed(3)}` : ''));
    if (d.relevant === false) { setPic('icePic', CNPics.ice(null), false); setText('iceBig', 'Not a concern'); setText('iceSub', esc(d.reason || 'No position yet')); return; }
    if (d.failed) { setPic('icePic', CNPics.ice(null), false); setText('iceBig', '&mdash;'); setText('iceSub', 'Ice data unavailable. Use the DMI or Canadian Ice Service charts.'); return; }
    setPic('icePic', CNPics.ice(d), !d.stale);
    const e = d.near50 || d.near15, here = d.here || 0;
    setText('iceBig', here >= 15 ? `In ice ${here}%` : e ? `${e.distNm} nm ${BRG(e.bearing)}` : 'Clear');
    const day = d.date ? new Date(d.date + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
    setText('iceSub', (e ? `Nearest ice ${e.conc}% &middot; ${String(e.bearing).padStart(3, '0')}&deg;T<br>` : 'No ice within about 160 nm<br>') + `${day}${d.stale ? ' (old)' : ''} &middot; not bergs or growlers`);
  } catch (e) { setText('iceSub', 'Ice data unavailable'); }
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
    setText('horSub', `${esc(d.crewName)} &middot; ${label}`);
  } catch (e) {
    setText('horSub', 'Hours of Rest unavailable');
  }
}

// ---------- Log tile ----------
async function loadLogTile() {
  try {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const d = await getJson(`/api/log?limit=1&since=${encodeURIComponent(midnight.toISOString())}`);
    setText('logCount', String(Number(d.today) || 0));
    setText('logCountSub', d.today === 1 ? 'entry today' : 'entries today');
    if (!d.entries.length) { setText('logLast', 'Nothing logged yet &mdash; tap to start'); setPic('logPic', CNPics.logbook(''), true); return; }
    const e = d.entries[0], t = new Date(e.ts);
    setText('logLast', `${p2(t.getHours())}:${p2(t.getMinutes())} &middot; ${esc(e.text)}`);
    setPic('logPic', CNPics.logbook(`${p2(t.getHours())}:${p2(t.getMinutes())} ${e.text}`), true);
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

// the chart under the coordinates: the boat, the recent trail and the coast, in the dashboard colours
function drawPosition() {
  const el = $('posPic'); if (!el || !window.CNPics) return;
  if (!fix) { el.innerHTML = CNPics.chart({ lat: 55.5, lon: -5.5, none: true }, [], el.clientWidth || 400, el.clientHeight || 300); el.style.opacity = '.35'; return; }
  el.style.opacity = '';
  el.innerHTML = CNPics.chart(fix, TRK && TRK.status && TRK.status.path ? TRK.status.path : [], el.clientWidth || 400, el.clientHeight || 300, fix.cog != null ? fix.cog : null);
}
function ddm1(v, pos, neg) {
  let a = Math.abs(v), deg = Math.floor(a), min = Math.round((a - deg) * 600) / 10;
  if (min >= 60) { deg++; min = 0; }
  return `${String(deg).padStart(pos === 'N' ? 2 : 3, '0')}&deg;${min.toFixed(1).padStart(4, '0')}&prime;${v >= 0 ? pos : neg}`;
}
// speed and course over ground: from the phone's GPS (or, later, the boat's NMEA feed); blank until the boat is actually moving
const COMPASS_W = d => ['north', 'north-north-east', 'north-east', 'east-north-east', 'east', 'east-south-east', 'south-east', 'south-south-east', 'south', 'south-south-west', 'south-west', 'west-south-west', 'west', 'west-north-west', 'north-west', 'north-north-west'][Math.round(d / 22.5) % 16];
function showMotion() {
  if (!window.CNPics) return;
  const sog = fix && fix.sog != null && isFinite(fix.sog) ? Math.max(0, fix.sog) : null, cog = fix && fix.cog != null && isFinite(fix.cog) && sog != null && sog >= 0.5 ? fix.cog : null;
  setPic('sogPic', CNPics.sog(sog), sog != null);
  setText('sogVal', sog != null ? `${sog.toFixed(1)}<small style="font-size:.55em;color:var(--mu)"> kn</small>` : '&mdash;');
  setText('sogSub', sog == null ? 'needs a moving GPS fix' : sog < 0.5 ? 'stopped' : 'speed over ground');
  setPic('cogPic', CNPics.cog(cog), cog != null);
  setText('cogVal', cog != null ? `${COMPASS(cog)}` : '&mdash;');
  setText('cogSub', cog != null ? `heading ${COMPASS_W(cog)}` : sog != null && sog < 0.5 ? 'no course while stopped' : 'needs a moving GPS fix');
}
function showFix() {
  setText('locDdm', `${ddm1(fix.lat, 'N', 'S')} ${ddm1(fix.lon, 'E', 'W')}`);
  const mov = fix.sog != null && fix.sog >= 0.5 ? ` &middot; SOG ${fix.sog.toFixed(1)} kn${fix.cog != null ? ` &middot; COG ${String(Math.round(fix.cog)).padStart(3, '0')}&deg;` : ''}` : '';
  setText('locDec', `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}${mov}`);
  const src = fix.source === 'gps' ? 'GPS' : fix.source === 'manual' ? 'Manual' : 'Last known';
  const acc = fix.acc ? ` &plusmn;${Math.round(fix.acc)} m` : '';
  setText('locMeta', `${src}${acc} &middot; ${ageText(fix.ts)}${mov}`);
  drawPosition(); showMotion();
  if (window.CNPics && !CNPics.coastReady()) CNPics.loadCoast().then(c => { if (c) drawPosition(); });
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
    setText('locName', 'No position fix'); setText('locDdm', '—'); setText('locMeta', 'Tap “Set position” to enter it');
    setText('weatherSub', 'Needs a position'); setText('windSub', 'Needs a position');
  }
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

$('locSet').addEventListener('click', e => { e.stopPropagation(); const b = $('locationBox'); b.style.display = b.style.display === 'block' ? 'none' : 'block'; if (b.style.display === 'block') $('manualLat').focus(); });
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
$('locCard').addEventListener('click', e => { if (e.target.closest('a')) return; copyFix(); });
if (window.ResizeObserver && $('posPic')) { let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(drawPosition, 120); }).observe($('posPic')); }
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

function drawPath(path) { setPic('trackPic', CNPics.voyage(path), !!(path && path.length > 1)); drawPosition(); }
async function loadTrackTile() {
  try {
    const s = await getJson('/api/track/status');
    TRK.status = s;
    const card = $('trackCard'), v = s.voyage;
    card.href = '/track.html' + (v ? '?voyage=' + encodeURIComponent(v.id) : '');
    card.classList.remove('fresh');
    drawPath(s.path);
    if (!s.configured || !v) { setText('trackBig', '&mdash;'); setText('trackSub', 'Starts with your first voyage'); return; }
    setText('trackBig', `${v.distanceNm.toFixed(1)}<span style="font-size:.55em;font-weight:700;color:var(--mu)"> nm</span>`);
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

// ---------- Assistant bar (assistant.js on the server) ----------
// Replies are plain text; buttons: Do it / Cancel (plans), Undo (last change), Open (a page). Server text is never put in innerHTML.
const agentBox = $('agentReply');
function agentCtx() {
  let crewId = null; try { crewId = localStorage.getItem('cn.crew'); } catch (e) {}
  return { crewId, lat: fix ? fix.lat : null, lon: fix ? fix.lon : null };
}
function agentShow(d) {
  agentBox.style.display = 'block'; agentBox.replaceChildren();
  const t = document.createElement('div'); t.className = 'dagent-text'; t.textContent = d.reply || d.error || 'No reply.'; agentBox.appendChild(t);
  const acts = (d.actions || []); if (!acts.length) return;
  const row = document.createElement('div'); row.className = 'dagent-actions';
  for (const a of acts) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = a.label; b.className = 'dagent-act ' + a.kind;
    b.onclick = () => { if (a.kind === 'open') location.href = a.url; else if (a.kind === 'confirm') agentSend({ confirm: a.token }); else if (a.kind === 'cancel') agentSend({ cancel: a.token }); else if (a.kind === 'undo') agentSend({ undo: true }); };
    row.appendChild(b);
  }
  agentBox.appendChild(row);
  const auto = acts.find(a => a.kind === 'open' && a.auto); if (auto) setTimeout(() => { location.href = auto.url; }, 400);
}
async function agentSend(payload) {
  agentBox.style.display = 'block'; agentBox.textContent = '…';
  try {
    const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ tz: -new Date().getTimezoneOffset(), context: agentCtx() }, payload)) });
    const d = await r.json().catch(() => ({}));
    agentShow(r.ok || d.reply ? d : { reply: d.error || ('The server answered ' + r.status) });
    if (d.changed) { loadHorSummary(); loadLogTile(); loadTrackTile(); }
  } catch (e) { agentBox.textContent = e && e.offline ? 'No connection to the server. The assistant needs one.' : 'Could not reach the server.'; }
}
$('agentForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const text = $('agentInput').value.trim(); if (!text) return;
  $('agentInput').value = ''; agentSend({ text });
});

// ---------- start ----------
initPics();
requestFix();
setInterval(requestFix, 60000);
setInterval(() => { if (fix) showFix(); }, 30000);
loadHorSummary();
loadTides();
loadIce(); setInterval(loadIce, 3 * 3600000);
loadLogTile();
loadTrackTile(); flushQueue();
setInterval(() => { loadHorSummary(); loadLogTile(); loadTrackTile(); }, 120000);
