// Crow's Nest — Hours of Rest (self-hosted client)

let crew = [];
let activeCrewId = null;
let entries = [];
let editingId = null;

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function fmtDT(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function toLocalInputValue(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }
function hoursLabel(mins) {
  if (mins == null) return '—';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

async function loadVessel() {
  const { vessel } = await api('/api/vessel');
  document.getElementById('vessel').value = vessel || '';
}
document.getElementById('vessel').addEventListener('change', async e => {
  await api('/api/vessel', { method: 'PUT', body: JSON.stringify({ vessel: e.target.value }) });
});

async function addCrew() {
  const input = document.getElementById('newCrewName');
  const name = input.value.trim();
  if (!name) return;
  const row = await api('/api/crew', { method: 'POST', body: JSON.stringify({ name }) });
  input.value = '';
  activeCrewId = row.id;
  await refreshCrew();
}
function selectCrew(id) { activeCrewId = id; cancelEdit(); renderAll(); }

async function refreshCrew() {
  crew = await api('/api/crew');
  if (!activeCrewId && crew.length) activeCrewId = crew[0].id;
  await renderAll();
}

function renderCrewPills() {
  const el = document.getElementById('crewPills');
  if (crew.length === 0) { el.innerHTML = '<span class="small">No crew added yet — add one below.</span>'; return; }
  el.innerHTML = crew.map(c =>
    `<div class="pill ${c.id === activeCrewId ? 'active' : ''}" onclick="selectCrew('${c.id}')">${escapeHtml(c.name)}</div>`
  ).join('');
}

function currentOpenEntry() { return entries.find(e => !e.end) || null; }

async function quickLog(type) {
  if (!activeCrewId) { alert('Add and select a crew member first.'); return; }
  await api(`/api/crew/${activeCrewId}/quicklog`, { method: 'POST', body: JSON.stringify({ type }) });
  await renderAll();
}

async function saveEntryForm() {
  if (!activeCrewId) { alert('Add and select a crew member first.'); return; }
  const type = document.getElementById('entryType').value;
  const startV = document.getElementById('entryStart').value;
  const endV = document.getElementById('entryEnd').value;
  const note = document.getElementById('entryNote').value.trim();
  if (!startV) { alert('Start time is required.'); return; }
  const start = fromLocalInput(startV);
  const end = endV ? fromLocalInput(endV) : null;

  try {
    if (editingId) {
      await api(`/api/entries/${editingId}`, { method: 'PUT', body: JSON.stringify({ type, start, end, note }) });
      cancelEdit();
    } else {
      await api(`/api/crew/${activeCrewId}/entries`, { method: 'POST', body: JSON.stringify({ type, start, end, note }) });
    }
  } catch (e) { alert(e.message); return; }

  document.getElementById('entryNote').value = '';
  document.getElementById('entryStart').value = '';
  document.getElementById('entryEnd').value = '';
  await renderAll();
}

function editEntry(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  editingId = id;
  document.getElementById('entryType').value = e.type;
  document.getElementById('entryStart').value = toLocalInputValue(new Date(e.start));
  document.getElementById('entryEnd').value = e.end ? toLocalInputValue(new Date(e.end)) : '';
  document.getElementById('entryNote').value = e.note || '';
  document.getElementById('saveEntryBtn').textContent = 'Save changes';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  window.scrollTo({ top: document.getElementById('entryType').getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
}
function cancelEdit() {
  editingId = null;
  document.getElementById('saveEntryBtn').textContent = 'Add entry';
  document.getElementById('cancelEditBtn').style.display = 'none';
}
async function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  await api(`/api/entries/${id}`, { method: 'DELETE' });
  await renderAll();
}

function renderEntries() {
  const tbody = document.querySelector('#entriesTable tbody');
  document.getElementById('noEntries').style.display = entries.length ? 'none' : 'block';
  tbody.innerHTML = entries.map(e => {
    const hrs = e.end ? hoursLabel((new Date(e.end) - new Date(e.start)) / 60000) : 'ongoing';
    return `<tr>
      <td>${e.type === 'rest' ? '😴 Rest' : '🛠 Work'}</td>
      <td>${fmtDT(e.start)}</td>
      <td>${e.end ? fmtDT(e.end) : '—'}</td>
      <td>${hrs}</td>
      <td>${escapeHtml(e.note || '')}</td>
      <td class="entry-actions">
        <button class="btn-ghost" onclick="editEntry('${e.id}')">Edit</button>
        <button class="btn-ghost" onclick="deleteEntry('${e.id}')">Del</button>
      </td>
    </tr>`;
  }).join('');
}

function tagHtml(ok, warnLabel) {
  if (ok === null || ok === undefined) return `<span class="tag">&mdash;</span>`;
  if (ok === 'building') return `<span class="tag">BUILDING RECORD</span>`;
  if (ok === 'gap' || ok === 'indeterminate') return `<span class="tag">GAPS IN RECORD</span>`;
  if (ok === 'compliant') ok = true; else if (ok === 'breach') ok = false;
  return ok ? `<span class="tag ok">OK</span>` : `<span class="tag bad">${warnLabel}</span>`;
}

async function renderActivePanel() {
  const panel = document.getElementById('activePanel');
  if (!activeCrewId) {
    panel.innerHTML = '<div class="card small">Select or add a crew member above to start logging.</div>';
    return;
  }
  const member = crew.find(c => c.id === activeCrewId);
  entries = await api(`/api/crew/${activeCrewId}/entries`);
  const c = await api(`/api/crew/${activeCrewId}/compliance`);
  const open = currentOpenEntry();
  // Engine figures (worst case = only what is logged and qualifies); fall back to the legacy numbers if absent
  const g = c.engine || null;
  const kind = (rule) => {      // compliant | breach | building (record younger than the window) | gap (unlogged time inside the record)
    const r = g[rule];
    if (r.verdict !== 'indeterminate') return r.verdict;
    return rule === 'interval' ? 'gap' : (r.unknownMinutes - (g.ruleSet && g.ruleSet.preRecordRest ? 0 : (r.beforeRecordMinutes || 0))) > 0.5 ? 'gap' : 'building';
  };
  const ashore = ('voyage' in c) && !c.voyage;     // newer server: no voyage open means nothing is being scored
  const V = ashore ? { rest24: null, rest7: null, gap: null, periods: null, t24: null, t7: null, tgap: null, tsplit: null } : g ? {
    rest24: g.rest24.loggedRestMinutes, rest7: g.rest7d.loggedRestMinutes, gap: g.interval.longestRunMinutes,
    periods: g.rest24.restPeriods, t24: kind('rest24'), t7: kind('rest7d'), tgap: kind('interval'), tsplit: g.rest24.structure === 'indeterminate' ? kind('rest24') : g.rest24.structure
  } : { rest24: c.rest24Minutes, rest7: c.rest7Minutes, gap: c.longestWorkMinutes, periods: c.restPeriodCount24, t24: c.ok24, t7: c.ok7, tgap: c.okGap, tsplit: c.okSplit };

  const statusHtml = open
    ? `<div class="dot ${open.type}"></div><div><strong>${open.type === 'rest' ? 'Resting' : 'Working'}</strong> since ${fmtDT(open.start)}</div>`
    : `<div class="dot none"></div><div class="small">${ashore ? 'Not on a voyage — start rest or work below to begin one.' : 'No open period — log rest or work below.'}</div>`;

  panel.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(member.name)}</h2>
      <div class="status-now">${statusHtml}</div>
      <div class="row" style="margin-bottom:14px;">
        <button class="btn-rest" onclick="quickLog('rest')">Start REST now</button>
        <button class="btn-work" onclick="quickLog('work')">Start WORK now</button>
      </div>
      <div class="grid2">
        <div class="metric">
          <div class="label">Rest, last 24h</div>
          <div class="value">${hoursLabel(V.rest24)}</div>
          <div class="small">required ≥ 10h 0m</div>
          ${tagHtml(V.t24, 'BELOW 10H')}
        </div>
        <div class="metric">
          <div class="label">Rest, last 7 days</div>
          <div class="value">${hoursLabel(V.rest7)}</div>
          <div class="small">required ≥ 77h 0m</div>
          ${tagHtml(V.t7, 'BELOW 77H')}
        </div>
        <div class="metric">
          <div class="label">Longest work stretch</div>
          <div class="value">${hoursLabel(V.gap)}</div>
          <div class="small">max 14h between rest periods</div>
          ${tagHtml(V.tgap, 'EXCEEDS 14H')}
        </div>
        <div class="metric">
          <div class="label">Rest periods, last 24h</div>
          <div class="value">${V.periods === null ? '—' : V.periods}</div>
          <div class="small">${g ? 'two longest ≥1h periods: one ≥6h, together ≥10h' : '≤2 periods, one ≥6h'}</div>
          ${tagHtml(V.tsplit, 'CHECK SPLIT')}
        </div>
      </div>
    </div>
  `;
  renderEntries();
}

async function renderAll() {
  renderCrewPills();
  await renderActivePanel();
}

(async function init() {
  await loadVessel();
  await refreshCrew();
})();
