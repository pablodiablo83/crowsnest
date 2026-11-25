// Black box recorder page: this device's recorder state (window.CNBlackBox) and the server's daily files (GET /api/blackbox/status).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ago = function (ms) { var s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 90 ? s + ' s ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
  var kb = function (b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' kB' : (b / 1048576).toFixed(1) + ' MB'; };
  var BB = window.CNBlackBox;

  function device() {
    var s = BB ? BB.status() : null; if (!s) { $('bState').textContent = 'Recorder not available'; return; }
    $('bDot').className = 'b-dot' + (s.on ? ' rec' : ''); $('bState').textContent = s.on ? 'Recording' : 'Paused';
    $('bToggle').textContent = s.on ? 'Pause' : 'Resume'; $('bSend').className = 'h-btn b-btn ' + (s.queued ? 'primary' : 'ghost');
    $('bQueue').textContent = (s.queued ? s.queued + ' waiting to upload' : 'Everything is backed up') + (s.lastUpload ? ' · last upload ' + ago(s.lastUpload) : '') + (s.online ? '' : ' · offline: will send when connected') + (s.dropped ? ' · ' + s.dropped + ' oldest dropped (queue full)' : '');
  }
  async function server() {
    try {
      var r = await fetch('/api/blackbox/status', { cache: 'no-store' }), d = await r.json().catch(function () { return {}; });
      if (r.status === 403) { $('bTotal').textContent = ''; $('bDays').innerHTML = '<p class="b-msg">Only the master account can see and download the black box.</p>'; return; }
      if (!r.ok) throw new Error(d.error || 'server answered ' + r.status);
      $('bTotal').textContent = d.totalRecords + ' records · ' + kb(d.totalBytes);
      $('bDevs').innerHTML = (d.devices || []).map(function (x) { return '<div class="b-row"><span>' + esc(x.by || 'device') + ' <span class="b-meta">' + esc(x.device) + '</span></span><span class="b-meta">' + esc(x.lastKind) + ' · ' + ago(x.lastT) + '</span></div>'; }).join('');
      var all = d.days && d.days.length ? '<div class="b-row"><b>All days</b><span class="b-links"><a class="h-btn ghost b-btn" href="/api/blackbox/download?day=all&format=jsonl" download>JSON</a><a class="h-btn ghost b-btn" href="/api/blackbox/download?day=all&format=csv" download>CSV</a></span></div>' : '';
      $('bDays').innerHTML = (d.days && d.days.length ? all + d.days.map(function (x) {
        return '<div class="b-row b-day"><span><b>' + esc(x.day) + '</b> <span class="b-meta">' + x.records + ' records · ' + kb(x.bytes) + '</span></span><span class="b-links"><a class="h-btn ghost b-btn" href="/api/blackbox/download?day=' + esc(x.day) + '&format=jsonl" download>JSON</a><a class="h-btn ghost b-btn" href="/api/blackbox/download?day=' + esc(x.day) + '&format=csv" download>CSV</a></span></div>';
      }).join('') : '<p class="b-msg">Nothing on the server yet. Records upload within a minute of the first position or event.</p>');
    } catch (e) { $('bDays').innerHTML = '<p class="b-msg">Could not read the server copy: ' + esc(e.message || e) + '. This device keeps recording and will upload later.</p>'; }
  }
  var isApp = !!(window.CNNet && window.CNNet.isApp);
  if (isApp && BB) { $('bBgRow').hidden = false; var bg = function () { $('bBg').textContent = BB.bg() ? 'On' : 'Off'; }; bg(); $('bBg').addEventListener('click', function () { BB.setBg(!BB.bg()); bg(); }); }
  $('bToggle').addEventListener('click', function () { if (BB) { BB.set(!BB.on()); device(); } });
  $('bSend').addEventListener('click', async function () { var b = $('bSend'); b.disabled = true; try { if (BB) await BB.flush(); } finally { b.disabled = false; device(); server(); } });
  $('bNoteForm').addEventListener('submit', async function (e) { e.preventDefault(); var t = $('bNote').value.trim(); if (!t || !BB) return; $('bNote').value = ''; await BB.note(t); device(); server(); });
  device(); server(); setInterval(device, 5000); setInterval(server, 30000);
})();
