// Status page: GET /api/status (master only) -> one row per check, overall line, and the plain-text summary to copy.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WORD = { ok: 'Healthy', warn: 'Check', bad: 'Failing', idle: 'Not in use' };
  const STATES = ['ok', 'warn', 'bad', 'idle'];
  const cls = s => (STATES.includes(s) ? s : 'idle');
  let text = '';

  async function load() {
    $('sRefresh').disabled = true;
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ('The server answered ' + r.status));
      render(d);
    } catch (e) {
      const off = e && e.offline;
      $('sOverall').innerHTML = '<span class="s-dot s-big bad"></span><b>' + esc(off ? 'No connection to the server' : e.message) + '</b>';
      $('sList').innerHTML = '<li class="s-msg">' + esc(off ? 'The status comes from the server, so it needs a connection.' : 'Status not available.') + '</li>';
      text = ''; $('sText').textContent = off ? 'No connection to the Crow’s Nest server.' : String(e.message); $('sCopy').disabled = !$('sText').textContent;
      text = $('sText').textContent;
    } finally { $('sRefresh').disabled = false; }
  }
  function render(d) {
    const bad = d.checks.filter(c => c.state === 'bad').length, warn = d.checks.filter(c => c.state === 'warn').length;
    const head = bad ? `${bad} failing${warn ? ' · ' + warn + ' to check' : ''}` : warn ? `${warn} to check` : 'All systems healthy';
    $('sOverall').innerHTML = `<span class="s-dot s-big ${cls(d.overall)}"></span><b>${esc(head)}</b>`;
    const t = new Date(d.at);
    $('sAt').textContent = 'Checked ' + t.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + (d.commit ? ' · ' + d.commit : '');
    $('sList').innerHTML = d.checks.map(c => `<li data-id="${esc(c.id)}"><span class="s-dot ${cls(c.state)}" aria-hidden="true"></span>
      <div class="s-name">${esc(c.name)}<em class="${cls(c.state)}">${WORD[cls(c.state)]}</em></div>
      <div class="s-sum">${esc(c.summary)}</div>${c.detail ? `<div class="s-det">${esc(c.detail)}</div>` : ''}</li>`).join('');
    text = d.text; $('sText').textContent = text; $('sCopy').disabled = false;
  }
  async function copy() {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      try {   // older web views: select the text and use the copy command
        const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch (x) { ok = false; }
    }
    const b = $('sCopy'); b.textContent = ok ? 'Copied' : 'Select the text to copy';
    setTimeout(() => { b.textContent = 'Copy'; }, 2000);
  }
  $('sRefresh').onclick = load;
  $('sCopy').onclick = copy;
  load();
})();
