// Crow's Nest — tap-to-Work / tap-to-Rest hero card
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  var J = { 'Content-Type': 'application/json' };
  var st = { crewId: null, crewName: '', vessel: '', mode: null, since: null, comp: null, eng: null, voy: null, last: null, skew: 0, busy: false, offline: false, loaded: false };
  var undoInfo = null, toastTimer = null;

  async function api(url, opt) {
    var r = await fetch(url, Object.assign({ cache: 'no-store' }, opt || {}));
    var d = r.headers.get('Date');
    if (d) { var t = Date.parse(d); if (!isNaN(t)) st.skew = t - Date.now(); }
    window.CNTapQ.noteDate(r);
    if (!r.ok) throw new Error(url + ' -> ' + r.status);
    return r.json();
  }
  var nowMs = function () { return Date.now() + st.skew; };

  function fmtDur(ms) {
    var m = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(m / 60);
    if (h >= 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
    return h + 'h ' + p2(m % 60) + 'm';
  }
  function fmtClock(iso) {
    var t = new Date(iso), s = p2(t.getHours()) + ':' + p2(t.getMinutes());
    var today = new Date(); today.setHours(0, 0, 0, 0);
    if (t < today) s = t.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + s;
    return s;
  }

  async function load() {
    try {
      if (window.CNTapQ.pending().length) await window.CNTapQ.flush();   // send taps saved while offline first
      var s = await api('/api/dashboard/settings');
      var d = await api('/api/dashboard/hor-summary');
      if (!d.configured) {
        // primary crew never set (or points at nothing): adopt the first crew member
        var crew = await api('/api/crew');
        if (crew.length) {
          await api('/api/dashboard/settings', { method: 'PUT', headers: J, body: JSON.stringify({ primaryCrewId: crew[0].id }) });
          s = await api('/api/dashboard/settings');
          d = await api('/api/dashboard/hor-summary');
        }
      }
      st.offline = false; st.loaded = true;
      if (!d.configured) { st.crewId = null; render(); return; }
      st.crewId = s.primaryCrewId; st.crewName = d.crewName;
      st.srvMode = st.mode = d.status; st.srvSince = st.since = d.statusSince; st.comp = d.compliance; st.eng = d.engine || null; st.voyKnown = ('voyage' in d); st.voy = d.voyage || null; st.last = d.lastVoyage || null;
      if (!st.vessel) { try { st.vessel = (await api('/api/vessel')).vessel || ''; } catch (e) {} }
    } catch (e) { st.offline = true; }
    overlayQueue();
    render();
  }
  // taps saved on this phone but not yet on the server: show the latest as the current state
  function overlayQueue() {
    st.queued = st.crewId ? window.CNTapQ.pending(st.crewId).length : 0;
    var l = st.crewId && window.CNTapQ.last(st.crewId);
    st.mode = l ? l.type : st.srvMode; st.since = l ? l.at : st.srvSince;   // last state the server confirmed
  }

  // verdict: 'compliant' | 'indeterminate' | 'breach' (booleans accepted for the legacy fallback)
  function setChip(id, v) {
    var el = $(id); if (!el) return;
    if (v === true) v = 'compliant'; else if (v === false) v = 'breach';
    // 'building' = the record is simply younger than the window (nothing wrong); 'gap' = unlogged time inside the record
    el.className = 'hchip' + (v === 'breach' ? ' bad' : v === 'gap' || v === 'indeterminate' ? ' unk' : v === 'building' ? ' bld' : '');
    el.firstElementChild.textContent = v === 'breach' ? '!' : v === 'gap' || v === 'indeterminate' ? '?' : v === 'building' ? '\u2026' : '✓';
  }
  // unlogged time INSIDE the record (time before the voyage only counts as unknown when PRE_DUTY is off)
  function gapMin(e, r) { return r.unknownMinutes - (e.ruleSet && e.ruleSet.preRecordRest ? 0 : (r.beforeRecordMinutes || 0)); }
  function kindOf(e, rule) {
    var r = e[rule];
    if (r.verdict === 'compliant') return 'compliant';
    if (r.verdict === 'breach') return 'breach';
    if (rule === 'interval') return 'gap';
    return gapMin(e, r) > 0.5 ? 'gap' : 'building';
  }
  function fmtWhen(ms) {
    var t = new Date(ms), now = new Date(), hm = p2(t.getHours()) + ':' + p2(t.getMinutes());
    if (t.toDateString() === now.toDateString()) return 'today ' + hm;
    var tm = new Date(now.getTime() + 86400000);
    if (t.toDateString() === tm.toDateString()) return 'tomorrow ' + hm;
    return fmtDayTime(new Date(ms).toISOString());
  }
  function fmtMin(m) { m = Math.max(0, Math.floor(m)); var h = Math.floor(m / 60); return h + 'h ' + p2(m % 60) + 'm'; }
  function fmtDay(iso) { var t = new Date(iso); return t.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtDayTime(iso) { var t = new Date(iso); return fmtDay(iso) + ' ' + p2(t.getHours()) + ':' + p2(t.getMinutes()); }
  function lastVoyageNote(v) {
    var s = 'Last voyage ' + fmtDay(v.start) + ' \u2013 ' + fmtDay(v.end) + ': ' + (v.breaches ? v.breaches + ' period' + (v.breaches === 1 ? '' : 's') + ' below limits' : 'no breaches found');
    if (v.notConfirmed) s += ', ' + v.notConfirmed + ' with gaps in the record';
    if (v.entryProblems) s += ', ' + v.entryProblems + ' entr' + (v.entryProblems === 1 ? 'y needs' : 'ies need') + ' checking';
    return s;
  }
  var RULE_NAME = { rest24: '24h rest', rest7d: '7-day rest', interval: 'work gap' };
  function noteFor(e) {
    var parts = [], K = { rest24: kindOf(e, 'rest24'), rest7d: kindOf(e, 'rest7d'), interval: kindOf(e, 'interval') };
    var keys = ['rest24', 'rest7d', 'interval'];
    var bad = keys.filter(function (k) { return K[k] === 'breach'; });
    var gap = keys.filter(function (k) { return K[k] === 'gap'; });
    var bld = keys.filter(function (k) { return K[k] === 'building'; });
    var t0 = Date.parse(e.recordStart);
    if (bad.length) parts.push('Below limit: ' + bad.map(function (k) { return RULE_NAME[k]; }).join(', '));
    else if (gap.length) {
      var u = Math.max(gapMin(e, e.rest24), gapMin(e, e.rest7d));
      parts.push(u > 0 ? 'Gaps in the record (' + fmtMin(u) + ' unlogged) \u2014 fill them in or the checks cannot be confirmed' : 'Cannot confirm yet \u2014 check the open period');
    } else if (bld.length) {
      var w = [];
      if (K.rest24 === 'building') w.push('24h check completes ' + fmtWhen(t0 + 86400000));
      if (K.rest7d === 'building') w.push('7-day check ' + fmtWhen(t0 + 7 * 86400000));
      parts.push('Building the record \u00b7 ' + w.join(' \u00b7 '));
    } else parts.push('Within limits');
    if (e.conditional) parts.push('assumes rested at joining');
    var b = e.budget;
    if (b && b.minutes != null && !bad.length) parts.push('work budget ' + fmtMin(b.minutes));
    if (e.current && e.current.state === 'rest' && e.current.minutes < 60) parts.push('rest counts toward the 10h/14h rules after 60 min');
    if (e.dataQuality && e.dataQuality.errors) parts.push(e.dataQuality.errors + ' entr' + (e.dataQuality.errors === 1 ? 'y needs' : 'ies need') + ' checking');
    return parts.join(' \u00b7 ');
  }

  function render() {
    $('heroLoad').style.display = st.loaded ? 'none' : '';
    $('heroSetup').style.display = st.loaded && !st.crewId ? '' : 'none';
    $('heroMain').style.display = st.crewId ? '' : 'none';
    var nf = window.CNTapQ.failed().length, he = $('heroErr');
    var msg = [];
    if (st.offline && st.loaded) msg.push('No connection \u2014 showing last known status.');
    if (st.queued) msg.push(st.queued + ' tap' + (st.queued === 1 ? '' : 's') + ' saved on this phone, sent when back online.');
    if (nf) msg.push(nf + ' saved tap' + (nf === 1 ? ' was' : 's were') + ' not applied \u2014 see Hours of rest.');
    he.textContent = msg.join(' ');
    he.style.display = msg.length ? '' : 'none';
    if (!st.crewId) return;
    $('heroName').textContent = st.crewName + (st.vessel ? ' · ' + st.vessel : '');
    var rest = st.mode === 'rest', work = st.mode === 'work';
    var lab = $('heroState');
    var ashore = st.voyKnown && !st.voy && !st.queued;
    lab.textContent = rest ? 'RESTING' : work ? 'WORKING' : ashore ? 'ASHORE' : 'NOT LOGGING';
    $('heroDot').className = 'hdot' + (rest ? ' rest' : work ? ' work' : '');
    $('btnRest').className = 'hbtn rest' + (rest ? ' active' : '');
    $('btnWork').className = 'hbtn work' + (work ? ' active' : '');
    $('btnRest').setAttribute('aria-pressed', rest ? 'true' : 'false');
    $('btnWork').setAttribute('aria-pressed', work ? 'true' : 'false');
    $('btnRestMain').textContent = rest ? 'RESTING' : 'TAP TO REST';
    $('btnRestSub').textContent = rest ? 'current status' : work ? 'ends work now' : ashore ? 'after the first WORK tap' : 'start resting';
    $('btnWorkMain').textContent = work ? 'WORKING' : 'TAP TO WORK';
    $('btnWorkSub').textContent = work ? 'current status' : rest ? 'ends rest now' : ashore ? 'starts the voyage' : 'start working';
    $('heroSince').textContent = st.since ? 'since ' + fmtClock(st.since) : ashore ? 'first WORK tap starts the voyage' : 'tap a button to start the clock';
    var c = st.comp, e = st.eng, note = $('heroNote');
    var chipsOn = ashore ? 'none' : '';
    ['chip24', 'chip7', 'chipGap'].forEach(function (id) { $(id).style.display = chipsOn; });
    $('btnEndVoy').style.display = st.voy ? '' : 'none';
    $('heroDecl').style.display = st.voy && st.voy.declarationDue ? '' : 'none';
    $('heroVoyage').textContent = st.voy ? 'Voyage day ' + st.voy.day + ' \u00b7 started ' + fmtDayTime(st.voy.start) : '';
    if (ashore) {
      var f0 = $('heroRingFill'); f0.style.strokeDashoffset = '326.7'; f0.style.stroke = '';
      $('heroRingTime').textContent = '\u2014';
      if (note) note.textContent = st.last ? lastVoyageNote(st.last) : 'Rest and work are recorded only while a voyage is open.';
    } else if (e) {
      var mins = e.rest24.loggedRestMinutes, pct = Math.max(0, Math.min(1, mins / e.rest24.requiredMinutes));
      var fill = $('heroRingFill');
      fill.style.strokeDashoffset = String(326.7 * (1 - pct));
      fill.style.stroke = kindOf(e, 'rest24') === 'breach' ? '#F5B041' : '';
      $('heroRingTime').textContent = fmtMin(mins);
      setChip('chip24', kindOf(e, 'rest24')); setChip('chip7', kindOf(e, 'rest7d')); setChip('chipGap', kindOf(e, 'interval'));
      if (note) note.textContent = noteFor(e);
    } else if (c) {
      if (note) note.textContent = '';
      var mins = c.rest24Minutes, pct = Math.max(0, Math.min(1, mins / c.thresholds.min10h));
      var fill = $('heroRingFill');
      fill.style.strokeDashoffset = String(326.7 * (1 - pct));
      fill.style.stroke = c.ok24 ? '' : '#F5B041';
      $('heroRingTime').textContent = fmtMin(mins);
      setChip('chip24', c.ok24); setChip('chip7', c.ok7); setChip('chipGap', c.okGap);
    }
    tick();
  }

  function tick() {
    if (st.since) $('heroTimer').textContent = fmtDur(nowMs() - Date.parse(st.since));
    else $('heroTimer').textContent = '—';
  }

  function showToast(text, withUndo, ms) {
    $('toastText').textContent = text;
    $('toastUndo').style.display = withUndo ? '' : 'none';
    $('heroToast').style.display = 'flex';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || 8000);
  }
  function hideToast() { $('heroToast').style.display = 'none'; undoInfo = null; }

  // Joining declaration (taken once, at the first WORK tap of a voyage). Resolves with the declaration, or null if cancelled.
  var declResolve = null;
  function declValid() {
    var rested = document.querySelector('input[name=declRested]:checked');
    return !!rested && $('declAck1').checked && $('declAck2').checked;
  }
  function askDecl(starting) {
    return new Promise(function (resolve) {
      declResolve = resolve; hideToast();
      ['declAck1', 'declAck2', 'declU18'].forEach(function (id) { $(id).checked = false; });
      Array.prototype.forEach.call(document.querySelectorAll('input[name=declRested]'), function (r) { r.checked = false; });
      document.querySelector('input[name=declBy][value=seafarer]').checked = true;
      $('declNote').value = ''; $('declNote').style.display = 'none'; $('declU18w').style.display = 'none';
      $('declWho').textContent = st.crewName + (st.vessel ? ' \u00b7 ' + st.vessel : '');
      $('declOk').textContent = starting ? 'Start voyage and begin WORK' : 'Save declaration';
      $('declOk').disabled = true;
      $('declModal').style.display = 'flex';
    });
  }
  function declClose(val) {
    $('declModal').style.display = 'none';
    var r = declResolve; declResolve = null;
    if (r) r(val);
  }
  function declRead() {
    return {
      rested: document.querySelector('input[name=declRested]:checked').value,
      note: $('declNote').value.trim(),
      ackRecords: true, ackEmergency: true,
      under18: $('declU18').checked,
      declaredBy: document.querySelector('input[name=declBy]:checked').value
    };
  }
  document.addEventListener('change', function (e) {
    if (!$('declModal') || $('declModal').style.display === 'none') return;
    if (e.target.name === 'declRested') $('declNote').style.display = e.target.value === 'no' ? '' : 'none';
    if (e.target.id === 'declU18') $('declU18w').style.display = e.target.checked ? '' : 'none';
    $('declOk').disabled = !declValid();
  });
  $('declOk').addEventListener('click', function () { if (declValid()) declClose(declRead()); });
  $('declCancel').addEventListener('click', function () { declClose(null); });

  async function completeDecl() {
    if (st.busy || !st.voy) return;
    var d = await askDecl(false);
    if (!d) return;
    st.busy = true;
    try {
      await api('/api/voyages/' + st.voy.id + '/declaration', { method: 'PUT', headers: J, body: JSON.stringify(d) });
      showToast('Declaration saved', false, 4000);
    } catch (e) { showToast('Not saved \u2014 no connection. Try again.', false, 6000); }
    st.busy = false;
    load();
  }

  async function tap(type) {
    if (st.busy || !st.crewId || st.mode === type) return;
    var ashoreNow = st.voyKnown && !st.voy && !st.queued, decl = null;
    if (ashoreNow) {
      if (type !== 'work') { showToast('A voyage starts with the first WORK tap', false, 4500); return; }
      decl = await askDecl(true);
      if (!decl) return;
    }
    st.busy = true;
    $('hero').classList.add('busy');
    // saved on this phone first, then sent: a tap is never lost to a dropped connection
    var item = window.CNTapQ.add(st.crewId, type, decl);
    st.mode = type; st.since = item.at; st.queued = window.CNTapQ.pending(st.crewId).length;
    render();
    try { document.dispatchEvent(new CustomEvent('cn:tap', { detail: { type: type, startedVoyage: !!decl } })); } catch (e2) {}
    var res = await window.CNTapQ.flush();
    var sent = res.sent.find(function (x) { return x.item.tapId === item.tapId; });
    var bad = res.failed.find(function (x) { return x.item.tapId === item.tapId; });
    if (sent) {
      var row = sent.row;
      st.offline = false;
      undoInfo = row.duplicate ? null : { kind: 'tap', newId: row.id, prev: row.closedId ? { id: row.closedId } : null, voyageId: row.startedVoyage ? row.voyageId : null };
      showToast((row.startedVoyage ? 'Voyage started \u00b7 ' : '') + 'Switched to ' + type.toUpperCase() + ' at ' + p2(new Date(row.start).getHours()) + ':' + p2(new Date(row.start).getMinutes()), !!undoInfo);
    } else if (bad) {
      undoInfo = null;
      showToast('Not saved \u2014 ' + bad.error, false, 8000);
    } else {
      undoInfo = { kind: 'queued', tapId: item.tapId };
      showToast('No connection \u2014 ' + type.toUpperCase() + ' at ' + p2(new Date(item.at).getHours()) + ':' + p2(new Date(item.at).getMinutes()) + ' saved on this phone, sent when back online', true, 9000);
    }
    undoKeep = undoInfo;
    st.busy = false;
    $('hero').classList.remove('busy');
    load();
  }
  var undoKeep = null;

  async function undo() {
    var u = undoKeep || undoInfo; undoKeep = null;
    hideToast();
    if (!u) return;
    if (u.kind === 'queued') {
      if (!window.CNTapQ.remove(u.tapId)) showToast('Already sent \u2014 undo it on the Hours of rest page.', false, 6000);
      load(); return;
    }
    try {
      if (u.kind === 'end') await api('/api/crew/' + st.crewId + '/voyage/reopen', { method: 'POST', headers: J, body: JSON.stringify({ voyageId: u.voyageId, entryId: u.entryId }) });
      else await api('/api/crew/' + st.crewId + '/quicklog-undo', { method: 'POST', headers: J, body: JSON.stringify({ newId: u.newId, prevId: u.prev ? u.prev.id : null, voyageId: u.voyageId || null }) });
    } catch (e) { showToast('Undo failed \u2014 check Hours of Rest page.', false, 6000); }
    load();
  }

  async function endVoyage() {
    if (st.busy || !st.crewId || !st.voy) return;
    if (!window.confirm('End this voyage now?\n\nYour current period is closed and recording stops until your next tap.')) return;
    st.busy = true;
    try {
      var r = await api('/api/crew/' + st.crewId + '/voyage/end', { method: 'POST', headers: J, body: '{}' });
      var t = new Date(r.end);
      undoInfo = { kind: 'end', voyageId: r.voyageId, entryId: r.closedEntryId };
      undoKeep = undoInfo;
      st.mode = null; st.since = null; st.voy = null;
      showToast('Voyage ended at ' + p2(t.getHours()) + ':' + p2(t.getMinutes()), true, 10000);
      try { document.dispatchEvent(new CustomEvent('cn:voyage-end', { detail: { voyageId: r.voyageId } })); } catch (e2) {}
      await load();
    } catch (e) { showToast('Not ended \u2014 no connection or no open voyage. Try again.', false, 6000); }
    st.busy = false;
  }

  async function addSelf() {
    var name = $('heroNewName').value.trim();
    if (!name) { $('heroNewName').focus(); return; }
    try { await api('/api/crew', { method: 'POST', headers: J, body: JSON.stringify({ name: name }) }); } catch (e) { st.offline = true; }
    load();
  }

  $('btnRest').addEventListener('click', function () { tap('rest'); });
  $('btnWork').addEventListener('click', function () { tap('work'); });
  $('toastUndo').addEventListener('click', undo);
  $('btnEndVoy').addEventListener('click', endVoyage);
  $('heroDecl').addEventListener('click', completeDecl);
  $('heroAddBtn').addEventListener('click', addSelf);
  $('heroNewName').addEventListener('keydown', function (e) { if (e.key === 'Enter') addSelf(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) load(); });
  window.addEventListener('online', load);
  window.CNTapQ.onChange(function () { if (!st.busy) load(); });
  setInterval(load, 60000);
  setInterval(tick, 10000);
  load();
})();
