// Crow's Nest - Hours of rest page
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;

  var S = {
    crew: [], crewId: null, vessel: { vessel: '', officialNumber: '', flag: '' }, policy: 'rest', primaryId: '',
    entries: [], voyages: [], comp: null, loaded: false, offline: false, busy: false, showAll: false
  };
  var RANKS = ['Master', 'Skipper', 'Chief officer', 'First mate', 'Second mate', 'Mate', 'Bosun', 'Deckhand', 'Engineer', 'Cook', 'Stewardess', 'Crew'];

  /* ---------------------------------------------------------------- helpers */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function fmtMin(m) { m = Math.max(0, Math.floor(m + 1e-9)); var h = Math.floor(m / 60); return h ? h + 'h ' + p2(m % 60) + 'm' : (m % 60) + 'm'; }
  function fmtDur(ms) { var m = Math.max(0, Math.floor(ms / MIN)), h = Math.floor(m / 60); if (h >= 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h'; return h + 'h ' + p2(m % 60) + 'm'; }
  function hm(ms) { var t = new Date(ms); return p2(t.getHours()) + ':' + p2(t.getMinutes()); }
  function dayName(ms) { return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function dayLong(ms) { return new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function dt(ms) { return dayName(ms) + ' ' + hm(ms); }
  function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }
  function midnight(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function toLocalInput(ms) { var d = new Date(ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }
  function curCrew() { return S.crew.find(function (c) { return c.id === S.crewId; }) || null; }
  function openEntry() { return S.entries.find(function (e) { return !e.end; }) || null; }
  function openVoyage() { return S.voyages.find(function (v) { return !v.end; }) || null; }
  function ms(iso) { return Date.parse(iso); }
  function typeWord(t) { return t === 'rest' ? 'Rest' : 'Work'; }
  function shape(t) { return '<span class="h-shape ' + t + '" aria-hidden="true"></span>'; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  async function api(path, opt) {
    opt = opt || {};
    var init = { cache: 'no-store', method: opt.method || 'GET', headers: { 'Content-Type': 'application/json' } };
    if (opt.body !== undefined) init.body = JSON.stringify(opt.body);
    var r;
    try { r = await fetch(path, init); } catch (e) { var ne = new Error('No connection to the Crow’s Nest server.'); ne.offline = true; throw ne; }
    var d = null; try { d = await r.json(); } catch (e) { /* not json */ }
    if (!r.ok) { var er = new Error((d && d.error) || ('Request failed (' + r.status + ')')); er.status = r.status; er.data = d || {}; throw er; }
    return d;
  }
  // plain-language errors; returns {text, voyageAction}
  function explain(err) {
    if (err.offline) return { text: err.message + ' Check the connection and try again.' };
    var d = err.data || {}, m = String(err.message || '');
    function ent(c) { return c ? typeWord(c.type) + ' ' + dt(ms(c.start)) + (c.end ? ' to ' + hm(ms(c.end)) : ' (still in progress)') : 'another period'; }
    if (/overlaps an existing period/.test(m)) return { text: 'That overlaps ' + ent(d.conflict) + '. Change the times, or edit that entry first.' };
    if (/still open/.test(m)) return { text: 'Another period is still in progress (' + ent(d.conflict) + '). End it first, or give this entry an end time.' };
    if (/starts before the voyage began/.test(m)) return { text: 'That starts before the voyage began (' + (d.voyage ? dt(ms(d.voyage.start)) : 'earlier') + '). Pick a later start, or move the voyage start earlier.' };
    if (/extends past the end of the voyage/.test(m)) return { text: 'That runs past the end of the voyage (' + (d.voyage && d.voyage.end ? dt(ms(d.voyage.end)) : '') + '). Shorten it, or reopen the voyage.' };
    if (/not inside a voyage/.test(m)) return { text: 'That time is not inside a voyage. Hours are only recorded during a voyage.', voyageAction: true };
    if (/overlaps another voyage/.test(m)) return { text: 'That overlaps another voyage' + (d.conflict ? ' (' + dt(ms(d.conflict.start)) + (d.conflict.end ? ' to ' + dt(ms(d.conflict.end)) : ' to now') + ')' : '') + '.' };
    if (/entry starts before that voyage start/.test(m)) return { text: 'An entry in this voyage starts before that time. Delete or edit that entry first.' };
    if (/entry runs past that voyage end/.test(m)) return { text: 'An entry in this voyage runs past that end time. Delete or edit that entry first.' };
    if (/in the future/.test(m)) return { text: 'Times cannot be in the future.' };
    if (/end must be after start/.test(m)) return { text: 'The end must be after the start.' };
    return { text: m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? '' : '.') };
  }

  /* ---------------------------------------------------------------- toast */
  var toastTimer = null, toastUndo = null;
  function toast(text, undo, ms_) {
    $('#toastText').textContent = text;
    toastUndo = undo || null;
    $('#toastUndo').style.display = undo ? '' : 'none';
    $('#toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms_ || (undo ? 9000 : 4500));
  }
  function hideToast() { $('#toast').classList.remove('show'); toastUndo = null; }

  /* ---------------------------------------------------------------- sheets */
  var sheets = [];
  function sheetSetInert() {
    var wrap = $('.h-wrap'); if (wrap) wrap.inert = sheets.length > 0;
    sheets.forEach(function (s, i) { s.wrap.inert = i < sheets.length - 1; });
  }
  function openSheet(title, bodyHtml, opt) {
    opt = opt || {};
    var wrap = document.createElement('div');
    wrap.className = 'h-sheetwrap';
    var id = 'sh' + Date.now() + Math.floor(Math.random() * 1000);
    wrap.innerHTML = '<div class="h-sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '">' +
      '<div class="h-sheethead"><h2 id="' + id + '" tabindex="-1">' + esc(title) + '</h2><button type="button" class="h-x" data-act="close" aria-label="Close">×</button></div>' +
      bodyHtml + '</div>';
    $('#sheetHost').appendChild(wrap);
    var s = { wrap: wrap, el: wrap.firstChild, opener: document.activeElement, onClose: opt.onClose || null, closed: false };
    sheets.push(s);
    sheetSetInert();
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) s.mouseDownOnWrap = true; else s.mouseDownOnWrap = false; });
    wrap.addEventListener('click', function (e) { if (e.target === wrap && s.mouseDownOnWrap) closeSheet(s); });
    var f = opt.focus ? $(opt.focus, s.el) : null;
    (f || $('#' + id, s.el)).focus();
    return s;
  }
  function closeSheet(s, result) {
    if (!s || s.closed) return;
    s.closed = true;
    var i = sheets.indexOf(s); if (i >= 0) sheets.splice(i, 1);
    s.wrap.remove();
    sheetSetInert();
    if (s.opener && document.body.contains(s.opener)) { try { s.opener.focus(); } catch (e) { /* gone */ } }
    else { var m = $('#main'); if (m) m.focus(); }
    if (s.onClose) s.onClose(result);
  }
  function topSheet() { return sheets[sheets.length - 1] || null; }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && topSheet()) { e.preventDefault(); closeSheet(topSheet()); }
  });
  function sheetOf(el) { var w = el.closest('.h-sheetwrap'); return sheets.find(function (s) { return s.wrap === w; }); }
  function showErr(sheet, e) {
    var box = $('.errbox', sheet.el); if (!box) return;
    var x = typeof e === 'string' ? { text: e } : explain(e);
    box.innerHTML = '<div class="h-err" role="alert">' + esc(x.text) +
      (x.voyageAction ? '<br><button type="button" class="h-link" data-act="voyage-add">Add an earlier voyage</button>' : '') + '</div>';
  }
  function confirmSheet(o) {
    return new Promise(function (resolve) {
      var done = false;
      var s = openSheet(o.title, '<p class="h-lead">' + esc(o.text) + '</p><div class="h-actions">' +
        '<button type="button" class="h-btn ' + (o.danger ? 'danger' : 'primary') + '" data-act="confirm-yes">' + esc(o.ok) + '</button>' +
        '<button type="button" class="h-btn ghost" data-act="close">Cancel</button></div>', {
        onClose: function () { if (!done) resolve(false); }
      });
      s.confirm = function () { done = true; closeSheet(s); resolve(true); };
    });
  }

  /* ---------------------------------------------------------------- data */
  async function load() {
    try {
      var r = await Promise.all([api('/api/crew'), api('/api/vessel'), api('/api/settings/pre-voyage'), api('/api/dashboard/settings')]);
      S.crew = r[0]; S.vessel = r[1]; S.policy = r[2].policy; S.primaryId = r[3].primaryCrewId;
      if (!S.crewId || !S.crew.find(function (c) { return c.id === S.crewId; })) {
        var saved = lsGet('cn.crew');
        var pick = S.crew.find(function (c) { return c.id === saved; }) || S.crew.find(function (c) { return c.id === S.primaryId; }) || S.crew[0] || null;
        S.crewId = pick ? pick.id : null;
      }
      if (S.crewId) {
        var q = await Promise.all([api('/api/crew/' + S.crewId + '/entries'), api('/api/crew/' + S.crewId + '/voyages'), api('/api/crew/' + S.crewId + '/compliance')]);
        S.entries = q[0]; S.voyages = q[1]; S.comp = q[2];
      } else { S.entries = []; S.voyages = []; S.comp = null; }
      S.offline = false; S.loaded = true;
    } catch (e) { S.offline = true; }
    renderAll();
  }

  /* ---------------------------------------------------------------- render: frame */
  function renderAll() {
    $('#vesselBtn').textContent = S.vessel.vessel ? S.vessel.vessel : 'Add vessel name';
    renderCrewBar();
    var main = $('#main');
    if (!S.loaded) return;
    if (S.offline && !S.crew.length) { main.innerHTML = '<div class="h-card"><h2>No connection</h2><p class="h-sub">Crow’s Nest cannot reach the server. Check the connection, then try again.</p><div class="h-actions"><button type="button" class="h-btn primary" data-act="reload">Try again</button></div></div>'; return; }
    if (!S.crew.length) { renderFirstCrew(); return; }
    if (!$('#cardNow')) buildMain();
    renderNow(); renderChecks(); renderTimeline(); renderEntries(); renderVoyages(); renderRecord();
  }
  function buildMain() {
    $('#main').innerHTML =
      '<div class="h-col">' +
        '<section class="h-card" id="cardNow" style="order:1" aria-label="Now"></section>' +
        '<section class="h-card" id="cardChecks" style="order:2" aria-labelledby="hChecks"></section>' +
        '<section class="h-card" id="cardVoys" style="order:5" aria-labelledby="hVoys"></section>' +
        '<section class="h-card" id="cardRec" style="order:6" aria-labelledby="hRec"></section>' +
      '</div>' +
      '<div class="h-col">' +
        '<section class="h-card" id="cardTime" style="order:3" aria-labelledby="hTime"></section>' +
        '<section class="h-card" id="cardEnts" style="order:4" aria-labelledby="hEnts"></section>' +
      '</div>';
  }
  function renderFirstCrew() {
    $('#main').innerHTML = '<section class="h-card"><h2>Add the first crew member</h2><p class="h-sub">Hours of rest are recorded per person. You can add everyone else later.</p>' +
      '<form data-form="crew-first" novalidate>' +
      '<div class="h-fld"><label for="fcName">Name</label><input class="h-in" id="fcName" autocomplete="off" maxlength="60" required></div>' +
      '<div class="h-fld"><label for="fcRank">Rank <span class="hint">Optional. Shown on the printed record.</span></label><input class="h-in" id="fcRank" list="rankList" autocomplete="off" maxlength="40">' + rankList() + '</div>' +
      '<div class="errbox"></div><div class="h-actions"><button class="h-btn primary" type="submit">Add crew member</button></div></form></section>';
  }
  function rankList() { return '<datalist id="rankList">' + RANKS.map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist>'; }
  function renderCrewBar() {
    var bar = $('#crewBar');
    if (!S.crew.length) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = '';
    bar.innerHTML = S.crew.map(function (c) {
      return '<button type="button" class="h-chip" data-act="crew-pick" data-id="' + esc(c.id) + '" aria-pressed="' + (c.id === S.crewId) + '">' + esc(c.name) + (c.role ? ' <small>' + esc(c.role) + '</small>' : '') + '</button>';
    }).join('') + '<button type="button" class="h-chip add" data-act="crew-add">+ Add crew</button>';
  }
  function keepFocus(el, fn) {   // re-render a card without losing keyboard focus inside it
    var a = document.activeElement, key = a && el.contains(a) ? (a.getAttribute('data-act') || '') + '|' + (a.getAttribute('data-id') || '') + '|' + (a.getAttribute('data-k') || '') : null;
    fn();
    if (key) { var m = $$('[data-act]', el).find(function (n) { return (n.getAttribute('data-act') || '') + '|' + (n.getAttribute('data-id') || '') + '|' + (n.getAttribute('data-k') || '') === key; }); if (m) m.focus(); }
  }

  /* ---------------------------------------------------------------- render: now */
  function isAshore() { return !!(S.comp && ('voyage' in S.comp) && !S.comp.voyage); }
  function renderNow() {
    var el = $('#cardNow'); if (!el) return;
    keepFocus(el, function () {
      var c = curCrew(), open = openEntry(), vy = S.comp && S.comp.voyage, ashore = isAshore();
      var rest = open && open.type === 'rest', work = open && open.type === 'work';
      var state = rest ? 'Resting' : work ? 'Working' : ashore ? 'Ashore' : 'No period open';
      var html = '<div class="h-head"><div><h2>' + esc(c.name) + '</h2><p class="h-sub">' + (c.role ? esc(c.role) + ' · ' : '') + '<button type="button" class="h-note-link" data-act="crew-edit" data-id="' + esc(c.id) + '">Edit name or rank</button></p></div></div>';
      html += '<div class="h-now-top"><div><div class="h-state">' + shape(rest ? 'rest' : work ? 'work' : 'none') + '<span>' + state + '</span></div>' +
        '<div class="h-timer" id="nowTimer" data-since="' + (open ? open.start : '') + '">' + (open ? fmtDur(Date.now() - ms(open.start)) : '—') + '</div>' +
        '<div class="h-since">' + (open ? 'since ' + dt(ms(open.start)) : ashore ? 'The first WORK tap starts a voyage' : 'Tap Work or Rest to start') + '</div></div></div>';
      html += '<div class="h-btns">' +
        '<button type="button" class="h-tap rest" data-act="tap" data-k="rest" aria-pressed="' + !!rest + '"><b>' + (rest ? 'RESTING' : 'TAP TO REST') + '</b><span>' + (rest ? 'current status' : work ? 'ends work now' : ashore ? 'after the first WORK tap' : 'start resting') + '</span></button>' +
        '<button type="button" class="h-tap work" data-act="tap" data-k="work" aria-pressed="' + !!work + '"><b>' + (work ? 'WORKING' : 'TAP TO WORK') + '</b><span>' + (work ? 'current status' : rest ? 'ends rest now' : ashore ? 'starts the voyage' : 'start working') + '</span></button></div>';
      if (vy) {
        var v = openVoyage();
        html += '<div class="h-voy"><span>Voyage day ' + vy.day + ' · started ' + dt(ms(vy.start)) + '</span>' +
          (v ? '<button type="button" class="h-link" data-act="voyage-edit" data-id="' + esc(v.id) + '">Edit voyage</button>' : '') +
          '<button type="button" class="h-link" data-act="voyage-end">End voyage</button></div>';
        if (!vy.declaration) html += '<div style="margin-top:8px"><button type="button" class="h-note-link" data-act="decl-complete" data-id="' + esc(vy.id) + '">Joining declaration outstanding — complete it</button></div>';
      } else if (ashore) {
        var last = S.voyages.find(function (v) { return v.end; });
        html += '<div class="h-voy"><span>' + (last ? 'Last voyage ' + dayName(ms(last.start)) + ' to ' + dayName(ms(last.end)) : 'No voyage yet. Hours are recorded and checked during a voyage.') + '</span>' +
          '<button type="button" class="h-link" data-act="voyage-add">Add an earlier voyage</button></div>';
      }
      el.innerHTML = html;
    });
  }

  /* ---------------------------------------------------------------- render: checks */
  function kindOf(g, rule) {
    var r = g[rule];
    if (r.verdict === 'compliant') return 'ok';
    if (r.verdict === 'breach') return 'breach';
    if (rule === 'interval') return 'gap';
    var u = r.unknownMinutes - (g.ruleSet && g.ruleSet.preRecordRest ? 0 : (r.beforeRecordMinutes || 0));
    return u > 0.5 ? 'gap' : 'building';
  }
  function renderChecks() {
    var el = $('#cardChecks'); if (!el) return;
    keepFocus(el, function () {
      var g = S.comp && S.comp.engine, ashore = isAshore();
      if (!g || ashore) {
        el.innerHTML = '<div class="h-head"><div><h2 id="hChecks">Rest checks</h2></div></div><p class="h-sub">' + (ashore ? 'Checks run while a voyage is open. They look back over 24 hours and 7 days.' : 'Checks appear once you have logged some hours.') + '</p>';
        return;
      }
      var rows = [];
      function row(kind, title, value, pct, why, rule) {
        var mark = kind === 'ok' ? '✓' : kind === 'breach' ? '!' : kind === 'gap' ? '?' : '…';
        var verdict = kind === 'ok' ? 'Within the limit' : kind === 'breach' ? (rule === 'interval' ? 'Over the limit' : 'Below the limit') : kind === 'gap' ? 'Cannot confirm: gaps in the record' : 'Still building the record';
        return '<li class="h-check ' + kind + '"><span class="h-mark" aria-hidden="true">' + mark + '</span><h3>' + title + '</h3>' +
          '<div class="h-val"><span class="h-verdict">' + verdict + '.</span> ' + value + '</div>' +
          (pct == null ? '' : '<div class="h-bar" aria-hidden="true"><i style="width:' + Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%"></i></div>') + '</li>';
      }
      var a = g.rest24, b = g.rest7d, iv = g.interval;
      function extra(r) { var t = ''; if (r.preDutyMinutes > 0.5) t += ' Includes ' + fmtMin(r.preDutyMinutes) + ' assumed before the voyage.'; var u = r.unknownMinutes; if (u > 0.5) t += ' ' + fmtMin(u) + ' not logged.'; return t; }
      var gap24 = (a.unknownMinutes - (g.ruleSet && g.ruleSet.preRecordRest ? 0 : (a.beforeRecordMinutes || 0))) > 0.5;
      function sub(v) { return v === 'compliant' ? 'ok' : v === 'breach' ? 'breach' : (gap24 ? 'gap' : 'building'); }
      rows.push(row(sub(a.total), 'Rest in the last 24 hours (at least 10h)', fmtMin(a.worstCaseRestMinutes) + ' counted.' + extra(a), a.worstCaseRestMinutes / a.requiredMinutes));
      var sk = sub(a.structure);
      rows.push(row(sk, 'Rest in no more than two periods, one of at least 6h', a.restPeriods + ' rest period' + (a.restPeriods === 1 ? '' : 's') + ' of an hour or more; longest ' + fmtMin(a.longestRestMinutes) + '.', null));
      rows.push(row(kindOf(g, 'rest7d'), 'Rest in the last 7 days (at least 77h)', fmtMin(b.worstCaseRestMinutes) + ' counted.' + extra(b), b.worstCaseRestMinutes / b.requiredMinutes));
      rows.push(row(kindOf(g, 'interval'), 'Time between rest periods (no more than 14h)', fmtMin(iv.currentRunMinutes) + ' since the last rest of an hour or more.' + (iv.currentRunMinutes <= iv.maxMinutes ? ' ' + fmtMin(iv.remainingMinutes) + ' left.' : ''), iv.currentRunMinutes / iv.maxMinutes, 'interval'));
      // interval row verdict text uses the 'interval' rule name
      rows[3] = rows[3].replace('Below the limit', 'Over the limit');
      var BIND = { rest24: 'the 24-hour rest limit', rest7d: 'the 7-day rest limit', interval: 'the 14-hour limit between rests' };
      var bud = g.budget && g.budget.minutes != null ? '<div class="h-budget">You can keep working for <b>' + fmtMin(g.budget.minutes) + '</b> before ' + (BIND[g.budget.binding] || 'a limit') + ' is reached.</div>' : '';
      var assume = g.conditional ? '<p class="h-assume">These checks assume you were properly rested when you joined: time before the voyage counts as available rest, shown separately from rest you logged. ' + (S.comp.voyage && S.comp.voyage.declaration ? 'Declaration taken ' + dt(ms(S.comp.voyage.declaration.at)) + '.' : '') + '</p>' : '';
      var dq = g.dataQuality && g.dataQuality.errors ? '<p class="h-assume">' + g.dataQuality.errors + ' entr' + (g.dataQuality.errors === 1 ? 'y needs' : 'ies need') + ' checking. Look for overlaps in the list below.</p>' : '';
      el.innerHTML = '<div class="h-head"><div><h2 id="hChecks">Rest checks</h2><p class="h-sub">Rolling 24-hour and 7-day windows, as at ' + hm(ms(g.asOf)) + '</p></div></div><ul class="h-checks">' + rows.join('') + '</ul>' + bud + assume + dq;
    });
  }

  /* ---------------------------------------------------------------- render: 7-day timeline */
  function coverage(now) {   // time ranges inside a voyage
    return S.voyages.map(function (v) { return [ms(v.start), v.end ? ms(v.end) : now]; });
  }
  function renderTimeline() {
    var el = $('#cardTime'); if (!el) return;
    keepFocus(el, function () {
      var now = Date.now(), cov = coverage(now), rows = [];
      for (var i = 0; i < 7; i++) {
        var d0 = midnight(new Date(now - i * DAY).getTime() + (i ? 12 * HOUR : 0));
        var t = new Date(now); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - i); d0 = t.getTime();
        var n = new Date(t); n.setDate(n.getDate() + 1); var d1 = n.getTime(), lim = Math.min(d1, now), span = d1 - d0;
        var segs = [], tot = { rest: 0, work: 0, gap: 0 }, busy = [];
        S.entries.forEach(function (e) {
          var a = Math.max(ms(e.start), d0), b = Math.min(e.end ? ms(e.end) : now, lim);
          if (b <= a) return;
          segs.push({ k: e.type, a: a, b: b, e: e, live: !e.end }); tot[e.type] += b - a; busy.push([a, b]);
        });
        busy.sort(function (x, y) { return x[0] - y[0]; });
        cov.forEach(function (c) {
          var a = Math.max(c[0], d0), b = Math.min(c[1], lim); if (b <= a) return;
          var cur = a;
          busy.forEach(function (x) { if (x[1] <= cur || x[0] >= b) return; if (x[0] > cur) { segs.push({ k: 'gap', a: cur, b: x[0] }); tot.gap += x[0] - cur; } cur = Math.max(cur, x[1]); });
          if (cur < b) { segs.push({ k: 'gap', a: cur, b: b }); tot.gap += b - cur; }
        });
        var bars = segs.map(function (s) {
          var left = (s.a - d0) / span * 100, w = Math.max((s.b - s.a) / span * 100, 0.4);
          var range = hm(s.a) + ' to ' + (s.b >= d1 ? 'midnight' : hm(s.b)) + ', ' + fmtMin((s.b - s.a) / MIN);
          if (s.k === 'gap') return '<button type="button" class="h-seg gap" style="left:' + left + '%;width:' + w + '%" data-act="gap-fill" data-a="' + s.a + '" data-b="' + s.b + '" aria-label="Not logged, ' + range + '. Add an entry"></button>';
          return '<button type="button" class="h-seg ' + s.k + (s.live ? ' live' : '') + '" style="left:' + left + '%;width:' + w + '%" data-act="entry-edit" data-id="' + esc(s.e.id) + '" aria-label="' + typeWord(s.k) + ', ' + range + (s.live ? ', in progress' : '') + '. Edit"></button>';
        }).join('');
        var label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : new Date(t).toLocaleDateString('en-GB', { weekday: 'short' });
        rows.push('<li class="h-day"><div class="h-dlabel">' + label + '<small>' + new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '</small></div>' +
          '<div class="h-track" role="group" aria-label="' + dayLong(t) + ', 24-hour bar">' + bars + '</div>' +
          '<div class="h-tot"><span>Rest <b>' + fmtMin(tot.rest / MIN) + '</b></span><span>Work <b>' + fmtMin(tot.work / MIN) + '</b></span>' + (tot.gap > MIN ? '<span>Not logged <b>' + fmtMin(tot.gap / MIN) + '</b></span>' : '') + '</div></li>');
      }
      el.innerHTML = '<div class="h-head"><div><h2 id="hTime">Last 7 days</h2><p class="h-sub">Tap a block to change it.</p></div>' +
        '<button type="button" class="h-link" data-act="entry-add">+ Add entry</button></div>' +
        '<div class="h-axis" aria-hidden="true"><span></span><div><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>' +
        '<ul class="h-days">' + rows.join('') + '</ul>' +
        '<div class="h-legend" aria-hidden="true"><span><i class="rest"></i>Rest</span><span><i class="work"></i>Work</span><span><i class="gap"></i>Not logged</span><span><i class="off"></i>Not on a voyage</span></div>';
    });
  }

  /* ---------------------------------------------------------------- render: entries */
  var TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>';
  function renderEntries() {
    var el = $('#cardEnts'); if (!el) return;
    keepFocus(el, function () {
      var list = S.entries.slice(), now = Date.now();
      var head = '<div class="h-head"><div><h2 id="hEnts">Entries</h2><p class="h-sub">' + list.length + ' recorded</p></div><button type="button" class="h-link" data-act="entry-add">+ Add entry</button></div>';
      if (!list.length) { el.innerHTML = head + '<div class="h-empty"><b>No hours logged yet</b>Tap Work or Rest above, or add an entry for time already worked.</div>'; return; }
      var limit = S.showAll ? list.length : 12, shown = list.slice(0, limit), html = '', lastDay = '';
      shown.forEach(function (e) {
        var s = ms(e.start), en = e.end ? ms(e.end) : null, day = new Date(s).toDateString();
        if (day !== lastDay) { html += (lastDay ? '</ul>' : '') + '<h3 class="h-dayhead">' + dayLong(s) + '</h3><ul class="h-ents">'; lastDay = day; }
        var plus = en && !sameDay(s, en);
        var range = hm(s) + '–' + (en ? hm(en) : 'now');
        var label = typeWord(e.type) + ', ' + range + (plus ? ', ends next day' : '');
        html += '<li class="h-ent"><button type="button" class="h-ent-main" data-act="entry-edit" data-id="' + esc(e.id) + '" aria-label="Edit ' + esc(label) + (e.note ? ', note: ' + esc(e.note) : '') + '">' +
          shape(e.type) + '<span class="r"><span class="t">' + typeWord(e.type) + '</span> ' + range + (plus ? '<sup>+1</sup>' : '') + '</span><span class="d">' + (en ? fmtMin((en - s) / MIN) : 'in progress') + '</span>' +
          (e.note ? '<span class="n">' + esc(e.note) + '</span>' : '') + '</button>' +
          '<button type="button" class="h-ent-del" data-act="entry-del" data-id="' + esc(e.id) + '" aria-label="Delete ' + esc(label) + '">' + TRASH + '</button></li>';
      });
      html += '</ul>';
      if (list.length > limit) html += '<div class="h-actions"><button type="button" class="h-btn ghost" data-act="show-all">Show all ' + list.length + ' entries</button></div>';
      el.innerHTML = head + html;
    });
  }

  /* ---------------------------------------------------------------- render: voyages + record */
  function renderVoyages() {
    var el = $('#cardVoys'); if (!el) return;
    keepFocus(el, function () {
      var html = '<div class="h-head"><div><h2 id="hVoys">Voyages</h2><p class="h-sub">A voyage is a period on board. Hours are recorded and checked only during a voyage.</p></div></div>';
      if (!S.voyages.length) html += '<div class="h-empty"><b>No voyage yet</b>The first WORK tap starts one.</div>';
      else html += '<ul class="h-voys">' + S.voyages.map(function (v) {
        var open = !v.end, d = v.declaration;
        return '<li class="h-voyrow' + (open ? ' open' : '') + '"><div><strong>' + dayName(ms(v.start)) + ' to ' + (open ? 'now' : dayName(ms(v.end))) + (open ? ' (open)' : '') + '</strong>' +
          '<span>' + v.entryCount + ' entr' + (v.entryCount === 1 ? 'y' : 'ies') + ' · ' + (d ? 'joining declaration ' + (d.rested === 'yes' ? 'done' : 'done, not rested') : 'joining declaration outstanding') + '</span></div>' +
          '<span class="h-rowbtns"><a class="h-link" href="/track.html?voyage=' + encodeURIComponent(v.id) + '" aria-label="Map of voyage ' + dayName(ms(v.start)) + '">Map</a> ' +
          '<button type="button" class="h-link" data-act="voyage-edit" data-id="' + esc(v.id) + '" aria-label="Edit voyage ' + dayName(ms(v.start)) + '">Edit</button></span></li>';
      }).join('') + '</ul>';
      html += '<div class="h-actions"><button type="button" class="h-btn ghost" data-act="voyage-add">Add an earlier voyage</button></div>';
      el.innerHTML = html;
    });
  }
  function renderRecord() {
    var el = $('#cardRec'); if (!el) return;
    keepFocus(el, function () {
      el.innerHTML = '<div class="h-head"><div><h2 id="hRec">Record and export</h2><p class="h-sub">Records are endorsed by the seafarer and the master and a copy given to the seafarer.</p></div></div>' +
        '<div class="h-rowlinks"><button type="button" class="h-btn ghost" data-act="print">Print record</button>' +
        '<a class="h-btn ghost" href="/api/export.csv" download>Download CSV</a>' +
        '<a class="h-btn ghost" href="/api/export.json" download>Download full data</a>' +
        '<button type="button" class="h-btn ghost" data-act="audit">Change history</button></div>';
    });
  }

  /* ---------------------------------------------------------------- sheets: entries */
  function entrySheet(o) {
    o = o || {};
    var e = o.entry || null, now = Date.now();
    var last = S.entries[0];
    var type = e ? e.type : (o.type || (last ? (last.type === 'rest' ? 'work' : 'rest') : 'work'));
    var start = e ? ms(e.start) : (o.start != null ? o.start : (last && last.end ? ms(last.end) : now - HOUR));
    var end = e ? (e.end ? ms(e.end) : null) : (o.end != null ? o.end : now);
    if (!e && end <= start) end = Math.min(now, start + HOUR);
    var open = e ? !e.end : false;
    var html = '<form data-form="entry" novalidate>' +
      '<fieldset class="h-fld"><legend>What was it?</legend><div class="h-seg2">' +
      '<label class="h-pick rest"><input type="radio" name="etype" value="rest"' + (type === 'rest' ? ' checked' : '') + '><span>' + shape('rest') + 'Rest</span></label>' +
      '<label class="h-pick work"><input type="radio" name="etype" value="work"' + (type === 'work' ? ' checked' : '') + '><span>' + shape('work') + 'Work</span></label></div></fieldset>' +
      '<div class="h-fld"><label for="eStart">Started</label><div class="h-two" style="grid-template-columns:1fr auto"><input class="h-in" type="datetime-local" id="eStart" required value="' + toLocalInput(start) + '"><button type="button" class="h-link" data-act="set-now" data-target="eStart">Now</button></div></div>' +
      '<div class="h-fld"><label for="eEnd">Ended</label><div class="h-two" style="grid-template-columns:1fr auto"><input class="h-in" type="datetime-local" id="eEnd" value="' + (end && !open ? toLocalInput(end) : '') + '"' + (open ? ' disabled' : '') + '><button type="button" class="h-link" data-act="set-now" data-target="eEnd">Now</button></div>' +
      '<label class="h-opt" style="margin-top:10px"><input type="checkbox" id="eOpen"' + (open ? ' checked' : '') + '><span>Still in progress<em>No end time yet. It runs until you tap the other button.</em></span></label></div>' +
      '<div class="h-fld"><label for="eNote">Note <span class="hint">Optional, for example “anchor watch” or “mooring up”.</span></label><input class="h-in" id="eNote" maxlength="200" autocomplete="off" value="' + esc(e ? e.note : '') + '"></div>' +
      '<div class="errbox"></div>' +
      '<div class="h-actions"><button type="submit" class="h-btn primary">' + (e ? 'Save changes' : 'Add entry') + '</button><button type="button" class="h-btn ghost" data-act="close">Cancel</button></div>' +
      (e ? '<div class="h-actions"><button type="button" class="h-btn danger" data-act="entry-del-sheet" data-id="' + esc(e.id) + '">Delete this entry</button></div>' : '') + '</form>';
    var s = openSheet(e ? 'Edit entry' : 'Add entry', html, { focus: '#eStart' });
    s.entryId = e ? e.id : null;
    var open_ = $('#eOpen', s.el), endIn = $('#eEnd', s.el);
    open_.addEventListener('change', function () { endIn.disabled = open_.checked; if (open_.checked) endIn.value = ''; else if (!endIn.value) endIn.value = toLocalInput(Date.now()); });
    return s;
  }
  async function submitEntry(form) {
    var s = sheetOf(form), type = $('input[name=etype]:checked', form).value;
    var sv = $('#eStart', form).value, evv = $('#eEnd', form).value, still = $('#eOpen', form).checked, note = $('#eNote', form).value.trim();
    if (!sv) return showErr(s, 'Add a start time.');
    if (!still && !evv) return showErr(s, 'Add an end time, or tick “Still in progress”.');
    if (!still && new Date(evv) <= new Date(sv)) return showErr(s, 'The end must be after the start.');
    var body = { type: type, start: fromLocalInput(sv), end: still ? null : fromLocalInput(evv), note: note };
    var orig = s.entryId ? S.entries.find(function (x) { return x.id === s.entryId; }) : null;
    if (orig) {   // times shown to the minute: keep the stored second if the person did not change them
      if (toLocalInput(ms(orig.start)) === sv) body.start = orig.start;
      if (!still && orig.end && toLocalInput(ms(orig.end)) === evv) body.end = orig.end;
    }
    var btn = $('button[type=submit]', form); btn.disabled = true;
    try {
      if (s.entryId) await api('/api/entries/' + s.entryId, { method: 'PUT', body: body });
      else await api('/api/crew/' + S.crewId + '/entries', { method: 'POST', body: body });
      closeSheet(s); toast(s.entryId ? 'Entry saved' : 'Entry added'); await load();
    } catch (err) { btn.disabled = false; showErr(s, err); }
  }
  async function deleteEntry(id) {
    var e = S.entries.find(function (x) { return x.id === id; }); if (!e) return;
    var ok = await confirmSheet({ title: 'Delete this entry?', text: typeWord(e.type) + ', ' + dt(ms(e.start)) + (e.end ? ' to ' + hm(ms(e.end)) : ' (in progress)') + '. It is hidden but kept in the change history, and you can undo straight after.', ok: 'Delete entry', danger: true });
    if (!ok) return false;
    try {
      await api('/api/entries/' + id, { method: 'DELETE' });
      await load();
      toast('Entry deleted', async function () {
        try { await api('/api/entries/' + id + '/restore', { method: 'POST' }); toast('Entry restored'); await load(); }
        catch (err) { toast(explain(err).text, null, 7000); }
      });
      return true;
    } catch (err) { toast(explain(err).text, null, 7000); return false; }
  }

  /* ---------------------------------------------------------------- sheets: voyages */
  function declSummary(d) {
    if (!d) return 'Not taken yet.';
    return 'Taken ' + dt(ms(d.at)) + ', by ' + (d.declaredBy === 'master' ? 'the master on behalf of the seafarer' : 'the seafarer') + '. ' +
      (d.rested === 'yes' ? 'Properly rested when beginning duty.' : 'Not properly rested, or not sure' + (d.note ? ' (' + esc(d.note) + ')' : '') + '.') + (d.under18 ? ' Under 18.' : '');
  }
  function voyageSheet(v) {
    var now = Date.now(), open = v ? !v.end : false;
    var start = v ? ms(v.start) : now - 3 * DAY, end = v ? (v.end ? ms(v.end) : null) : now - DAY;
    var html = '<form data-form="voyage" novalidate>' +
      '<p class="h-lead">' + (v ? 'Change when this voyage began or ended. Entries inside it stay where they are.' : 'Add a voyage that was not logged live. You can then add its hours.') + '</p>' +
      '<div class="h-fld"><label for="vStart">Began</label><input class="h-in" type="datetime-local" id="vStart" required value="' + toLocalInput(start) + '"></div>' +
      '<div class="h-fld"><label for="vEnd">Ended</label><input class="h-in" type="datetime-local" id="vEnd" value="' + (end && !open ? toLocalInput(end) : '') + '"' + (open ? ' disabled' : '') + '>' +
      '<label class="h-opt" style="margin-top:10px"><input type="checkbox" id="vOpen"' + (open ? ' checked' : '') + '><span>Voyage is still open</span></label></div>' +
      '<div class="h-fld"><label for="vNote">Note <span class="hint">Optional, for example a passage name.</span></label><input class="h-in" id="vNote" maxlength="200" autocomplete="off" value="' + esc(v ? v.note : '') + '"></div>' +
      (v ? '<div class="h-sec"><h3>Joining declaration</h3><p class="h-lead">' + declSummary(v.declaration) + '</p><button type="button" class="h-btn ghost" data-act="decl-complete" data-id="' + esc(v.id) + '">' + (v.declaration ? 'Take it again' : 'Complete declaration') + '</button></div>' : '') +
      '<div class="errbox"></div>' +
      '<div class="h-actions"><button type="submit" class="h-btn primary">' + (v ? 'Save changes' : 'Add voyage') + '</button><button type="button" class="h-btn ghost" data-act="close">Cancel</button></div>' +
      (v ? '<div class="h-actions"><button type="button" class="h-btn danger" data-act="voyage-del" data-id="' + esc(v.id) + '"' + (v.entryCount ? ' disabled' : '') + '>Delete voyage</button></div>' + (v.entryCount ? '<p class="h-lead" style="margin-top:8px">This voyage holds ' + v.entryCount + ' entr' + (v.entryCount === 1 ? 'y' : 'ies') + '. Delete them first to delete the voyage.</p>' : '') : '') + '</form>';
    var s = openSheet(v ? 'Edit voyage' : 'Add an earlier voyage', html, { focus: '#vStart' });
    s.voyageId = v ? v.id : null;
    var o = $('#vOpen', s.el), e = $('#vEnd', s.el);
    if (!v) { o.checked = false; }
    o.addEventListener('change', function () { e.disabled = o.checked; if (o.checked) e.value = ''; else if (!e.value) e.value = toLocalInput(Date.now()); });
    return s;
  }
  async function submitVoyage(form) {
    var s = sheetOf(form), sv = $('#vStart', form).value, evv = $('#vEnd', form).value, still = $('#vOpen', form).checked, note = $('#vNote', form).value.trim();
    if (!sv) return showErr(s, 'Add the start time.');
    if (!still && !evv) return showErr(s, 'Add an end time, or tick “Voyage is still open”.');
    if (!still && new Date(evv) <= new Date(sv)) return showErr(s, 'The end must be after the start.');
    var body = { start: fromLocalInput(sv), end: still ? null : fromLocalInput(evv), note: note };
    var btn = $('button[type=submit]', form); btn.disabled = true;
    try {
      if (s.voyageId) await api('/api/voyages/' + s.voyageId, { method: 'PUT', body: body });
      else await api('/api/crew/' + S.crewId + '/voyages', { method: 'POST', body: body });
      closeSheet(s); toast(s.voyageId ? 'Voyage saved' : 'Voyage added'); await load();
    } catch (err) { btn.disabled = false; showErr(s, err); }
  }
  async function deleteVoyage(id, sheet) {
    var ok = await confirmSheet({ title: 'Delete this voyage?', text: 'It has no entries. It is hidden but kept in the change history, and you can undo straight after.', ok: 'Delete voyage', danger: true });
    if (!ok) return;
    try {
      await api('/api/voyages/' + id, { method: 'DELETE' });
      if (sheet) closeSheet(sheet);
      await load();
      toast('Voyage deleted', async function () {
        try { await api('/api/voyages/' + id + '/restore', { method: 'POST' }); toast('Voyage restored'); await load(); } catch (err) { toast(explain(err).text, null, 7000); }
      });
    } catch (err) { if (sheet) showErr(sheet, err); else toast(explain(err).text, null, 7000); }
  }
  async function endVoyage() {
    var vy = S.comp && S.comp.voyage; if (!vy) return;
    var ok = await confirmSheet({ title: 'End this voyage now?', text: 'Your current period is closed and recording stops until your next WORK tap. You can undo straight after.', ok: 'End voyage' });
    if (!ok) return;
    try {
      var r = await api('/api/crew/' + S.crewId + '/voyage/end', { method: 'POST', body: {} });
      await load();
      toast('Voyage ended at ' + hm(ms(r.end)), async function () {
        try { await api('/api/crew/' + S.crewId + '/voyage/reopen', { method: 'POST', body: { voyageId: r.voyageId, entryId: r.closedEntryId } }); toast('Voyage reopened'); await load(); }
        catch (err) { toast(explain(err).text, null, 7000); }
      });
    } catch (err) { toast(explain(err).text, null, 7000); }
  }

  /* ---------------------------------------------------------------- sheets: declaration */
  function declSheet(starting) {
    return new Promise(function (resolve) {
      var done = false, c = curCrew();
      var html = '<form data-form="decl" novalidate><p class="h-lead">' + esc(c ? c.name : '') + (S.vessel.vessel ? ' · ' + esc(S.vessel.vessel) : '') + '. Taken once, at the start of a voyage. Recorded with the time and kept in the change history.</p>' +
        '<fieldset class="h-sec"><h3>Rest before duty</h3>' +
        '<label class="h-opt"><input type="radio" name="drest" value="yes"><span>I was properly rested when I began duty on this ship.<em>MSN 1877 para 3.2. Time before duty began counts as available rest in the checks (shown as assumed) and is kept separate from rest you log.</em></span></label>' +
        '<label class="h-opt"><input type="radio" name="drest" value="no"><span>No, or I am not sure.<em>Time before this voyage stays unrecorded until you log it, so the checks cannot be confirmed until then.</em></span></label>' +
        '<input class="h-in" id="dNote" maxlength="400" placeholder="Work or other duty before joining (hours, where). Optional." style="display:none;margin-top:8px" aria-label="Work or other duty before joining"></fieldset>' +
        '<fieldset class="h-sec"><h3>Hours of work and hours of rest</h3>' +
        '<label class="h-opt"><input type="checkbox" id="dAck1"><span>I will record my hours of work and hours of rest accurately. Hours of rest are time outside hours of work and do not include short breaks. The record is endorsed by me and the master, and I am entitled to a copy.<em>Hours of Work Regulations 2018, regs 2 and 12.</em></span></label>' +
        '<label class="h-opt"><input type="checkbox" id="dAck2"><span>Work done in an emergency or call-out during hours of rest is hours of work and must be recorded. I am entitled to compensatory rest.<em>Regs 5 and 11.</em></span></label></fieldset>' +
        '<fieldset class="h-sec"><h3>Young persons</h3><label class="h-opt"><input type="checkbox" id="dU18"><span>The seafarer is under 18.<em id="dU18w" hidden>Crow’s Nest does not yet apply the young-person rules. Check the separate regulations.</em></span></label></fieldset>' +
        '<fieldset class="h-sec"><h3>Declared by</h3>' +
        '<label class="h-opt"><input type="radio" name="dby" value="seafarer" checked><span>The seafarer</span></label>' +
        '<label class="h-opt"><input type="radio" name="dby" value="master"><span>The master, on behalf of the seafarer</span></label></fieldset>' +
        '<div class="errbox"></div>' +
        '<div class="h-actions"><button type="submit" class="h-btn primary" id="dOk" disabled>' + (starting ? 'Start voyage and begin WORK' : 'Save declaration') + '</button><button type="button" class="h-btn ghost" data-act="close">Cancel</button></div></form>';
      var s = openSheet('Declaration on commencing duty', html, { onClose: function () { if (!done) resolve(null); } });
      var form = $('form', s.el);
      function valid() { return !!$('input[name=drest]:checked', form) && $('#dAck1', form).checked && $('#dAck2', form).checked; }
      form.addEventListener('change', function (ev) {
        if (ev.target.name === 'drest') $('#dNote', form).style.display = ev.target.value === 'no' ? '' : 'none';
        if (ev.target.id === 'dU18') $('#dU18w', form).hidden = !ev.target.checked;
        $('#dOk', form).disabled = !valid();
      });
      s.declDone = function () {
        if (!valid()) return;
        done = true;
        var d = { rested: $('input[name=drest]:checked', form).value, note: $('#dNote', form).value.trim(), ackRecords: true, ackEmergency: true, under18: $('#dU18', form).checked, declaredBy: $('input[name=dby]:checked', form).value };
        closeSheet(s); resolve(d);
      };
    });
  }
  async function completeDecl(voyageId) {
    var d = await declSheet(false); if (!d) return;
    try { await api('/api/voyages/' + voyageId + '/declaration', { method: 'PUT', body: d }); toast('Declaration saved'); await load(); }
    catch (err) { toast(explain(err).text, null, 7000); }
  }

  /* ---------------------------------------------------------------- sheets: crew + settings */
  function crewSheet(c) {
    var html = '<form data-form="crew" novalidate>' +
      '<div class="h-fld"><label for="cName">Name</label><input class="h-in" id="cName" maxlength="60" autocomplete="off" required value="' + esc(c ? c.name : '') + '"></div>' +
      '<div class="h-fld"><label for="cRank">Rank <span class="hint">Optional. Shown on the printed record.</span></label><input class="h-in" id="cRank" list="rankList" maxlength="40" autocomplete="off" value="' + esc(c ? c.role : '') + '">' + rankList() + '</div>' +
      '<div class="errbox"></div>' +
      '<div class="h-actions"><button type="submit" class="h-btn primary">' + (c ? 'Save changes' : 'Add crew member') + '</button><button type="button" class="h-btn ghost" data-act="close">Cancel</button></div>' +
      (c ? '<div class="h-actions"><button type="button" class="h-btn danger" data-act="crew-del" data-id="' + esc(c.id) + '">Remove from crew</button></div>' : '') + '</form>';
    var s = openSheet(c ? 'Edit crew member' : 'Add crew member', html, { focus: '#cName' });
    s.crewEditId = c ? c.id : null;
    return s;
  }
  async function submitCrew(form) {
    var s = sheetOf(form), name = $('#cName', form).value.trim(), role = $('#cRank', form).value.trim();
    if (!name) return showErr(s, 'Add a name.');
    var btn = $('button[type=submit]', form); btn.disabled = true;
    try {
      if (s.crewEditId) await api('/api/crew/' + s.crewEditId, { method: 'PUT', body: { name: name, role: role } });
      else { var r = await api('/api/crew', { method: 'POST', body: { name: name, role: role } }); S.crewId = r.id; lsSet('cn.crew', r.id); }
      closeSheet(s); toast(s.crewEditId ? 'Crew member saved' : 'Crew member added'); await load(); refreshSettings();
    } catch (err) { btn.disabled = false; showErr(s, err); }
  }
  async function removeCrew(id) {
    var c = S.crew.find(function (x) { return x.id === id; }); if (!c) return;
    var ok = await confirmSheet({ title: 'Remove ' + c.name + '?', text: 'Their entries are hidden but kept in the change history. This cannot be undone from this screen.', ok: 'Remove', danger: true });
    if (!ok) return;
    try {
      await api('/api/crew/' + id, { method: 'DELETE' });
      if (S.crewId === id) S.crewId = null;
      var cs = $$('.h-sheetwrap').length && sheets.filter(function (x) { return x.crewEditId === id; })[0]; if (cs) closeSheet(cs);
      await load(); refreshSettings(); toast(c.name + ' removed');
    } catch (err) { toast(explain(err).text, null, 7000); }
  }
  function settingsHtml() {
    var v = S.vessel;
    var crew = S.crew.length ? '<ul class="h-crewlist">' + S.crew.map(function (c) {
      return '<li class="h-crewrow"><div class="who"><b>' + esc(c.name) + '</b><span>' + (esc(c.role) || 'No rank set') + '</span></div>' +
        '<label class="dash"><input type="radio" name="primary" value="' + esc(c.id) + '"' + (c.id === S.primaryId ? ' checked' : '') + ' aria-label="Show ' + esc(c.name) + ' on the dashboard">Dashboard</label>' +
        '<button type="button" class="h-link" data-act="crew-edit" data-id="' + esc(c.id) + '" aria-label="Edit ' + esc(c.name) + '">Edit</button></li>';
    }).join('') + '</ul>' : '<p class="h-lead">No crew yet.</p>';
    return '<section class="h-sec"><h3>Vessel</h3><form data-form="vessel" novalidate>' +
      '<div class="h-fld"><label for="vesselName">Vessel name</label><input class="h-in" id="vesselName" maxlength="80" autocomplete="off" value="' + esc(v.vessel) + '"></div>' +
      '<div class="h-two stack-s"><div class="h-fld"><label for="vesselNo">Official number or IMO</label><input class="h-in" id="vesselNo" maxlength="80" autocomplete="off" value="' + esc(v.officialNumber) + '"></div>' +
      '<div class="h-fld"><label for="vesselFlag">Flag</label><input class="h-in" id="vesselFlag" maxlength="80" autocomplete="off" value="' + esc(v.flag) + '"></div></div>' +
      '<div class="errbox"></div><div class="h-actions"><button type="submit" class="h-btn primary">Save vessel</button></div></form></section>' +
      '<section class="h-sec"><h3>Crew</h3>' + crew + '<div class="h-actions"><button type="button" class="h-btn ghost" data-act="crew-add">+ Add crew member</button></div>' +
      '<p class="h-lead" style="margin-top:10px">The dashboard shows the person marked “Dashboard”.</p></section>' +
      '<section class="h-sec"><fieldset><h3>Time before a voyage</h3>' +
      '<label class="h-opt"><input type="radio" name="policy" value="rest"' + (S.policy === 'rest' ? ' checked' : '') + '><span>Count as available rest (recommended)<em>Assumes the seafarer was properly rested when beginning duty. Shown as assumed and kept separate from rest you log.</em></span></label>' +
      '<label class="h-opt"><input type="radio" name="policy" value="unknown"' + (S.policy === 'unknown' ? ' checked' : '') + '><span>Treat as unknown<em>The 24-hour and 7-day checks cannot be confirmed until a full window has been logged.</em></span></label></fieldset></section>' +
      '<details class="h-more"><summary>Limits being applied</summary><div><ul><li>At least 10 hours of rest in any 24 hours.</li><li>Rest in no more than two periods, one at least 6 hours.</li><li>At least 77 hours of rest in any 7 days.</li><li>No more than 14 hours between rest periods.</li><li>A rest under 60 minutes does not count towards the 24-hour split or the 14-hour gap.</li></ul><p style="margin-top:8px">Based on the MLC Hours of Work Regulations 2018. Not yet applied: young persons, night work and authorised exceptions.</p></div></details>';
  }
  function settingsSheet(focus) {
    var s = openSheet('Customise', '<div class="settings-body">' + settingsHtml() + '</div>', { focus: focus ? '#' + focus : null });
    s.isSettings = true;
    return s;
  }
  function refreshSettings() {
    var s = sheets.find(function (x) { return x.isSettings; }); if (!s) return;
    var b = $('.settings-body', s.el), st = s.el.scrollTop;
    var a = document.activeElement; var id = a && a.id;
    b.innerHTML = settingsHtml(); s.el.scrollTop = st;
    if (id && $('#' + id, s.el)) $('#' + id, s.el).focus();
  }

  /* ---------------------------------------------------------------- audit */
  function describe(a) {
    var b = a.before_json ? JSON.parse(a.before_json) : null, c = a.after_json ? JSON.parse(a.after_json) : null, x = c || b || {};
    var crew = S.crew.find(function (k) { return k.id === a.crew_id; }), who = crew ? crew.name + ': ' : '';
    function e(o) { return o ? typeWord(o.type) + ' ' + dt(ms(o.start)) + (o.end ? ' to ' + hm(ms(o.end)) : '') : ''; }
    function v(o) { return o ? dayName(ms(o.start)) + (o.end ? ' to ' + dayName(ms(o.end)) : ' (open)') : ''; }
    var m = {
      create: function () { return 'Added ' + e(c); }, close: function () { return 'Ended ' + e(c); }, edit: function () { return 'Changed ' + e(b) + ' to ' + e(c); },
      delete: function () { return 'Deleted ' + e(b); }, reopen: function () { return 'Reopened ' + e(c); }, restore: function () { return 'Restored ' + e(c); },
      'voyage-start': function () { return 'Started voyage ' + v(c); }, 'voyage-end': function () { return 'Ended voyage ' + v(c); }, 'voyage-edit': function () { return 'Changed voyage ' + v(b) + ' to ' + v(c); },
      'voyage-reopen': function () { return 'Reopened voyage ' + v(c); }, 'voyage-delete': function () { return 'Deleted voyage ' + v(b); }, 'voyage-restore': function () { return 'Restored voyage ' + v(c); },
      'voyage-declaration': function () { return 'Joining declaration taken for voyage ' + v(c); },
      'crew-edit': function () { return 'Crew details changed: ' + (b.name || '') + (b.role ? ' (' + b.role + ')' : '') + ' to ' + (c.name || '') + (c.role ? ' (' + c.role + ')' : ''); },
      'vessel-edit': function () { return 'Vessel details changed'; }
    };
    return who + (m[a.action] ? m[a.action]() : a.action);
  }
  async function auditSheet() {
    var s = openSheet('Change history', '<p class="h-lead">Every change to hours, voyages, crew and vessel details. Nothing is ever erased.</p><ul class="h-audit" id="auditList"><li>Loading…</li></ul>');
    try {
      var rows = await api('/api/entries-audit?limit=200');
      $('#auditList', s.el).innerHTML = rows.length ? rows.map(function (a) {
        var txt; try { txt = describe(a); } catch (e) { txt = a.action; }
        return '<li><time datetime="' + esc(a.at) + '">' + dt(ms(a.at)) + (a.source ? ' · ' + esc(a.source) : '') + '</time>' + esc(txt) + '</li>';
      }).join('') : '<li>No changes yet.</li>';
    } catch (err) { $('#auditList', s.el).innerHTML = '<li>' + esc(explain(err).text) + '</li>'; }
  }

  /* ---------------------------------------------------------------- tapping Work / Rest */
  async function tap(type) {
    if (S.busy || !S.crewId) return;
    var open = openEntry();
    if (open && open.type === type) return;
    var ashore = isAshore(), decl = null;
    if (ashore) {
      if (type !== 'work') { toast('A voyage starts with the first WORK tap'); return; }
      decl = await declSheet(true); if (!decl) return;
    }
    S.busy = true;
    try {
      var row = await api('/api/crew/' + S.crewId + '/quicklog', { method: 'POST', body: decl ? { type: type, declaration: decl } : { type: type } });
      await load();
      toast((row.startedVoyage ? 'Voyage started. ' : '') + 'Switched to ' + type.toUpperCase() + ' at ' + hm(ms(row.start)), async function () {
        try { await api('/api/crew/' + S.crewId + '/quicklog-undo', { method: 'POST', body: { newId: row.id, prevId: open ? open.id : null, voyageId: row.startedVoyage ? row.voyageId : null } }); await load(); }
        catch (err) { toast('Undo failed. Check the entries list.', null, 6000); }
      });
    } catch (err) { toast(explain(err).text, null, 7000); }
    S.busy = false;
  }

  /* ---------------------------------------------------------------- print record */
  async function printRecord() {
    var c = curCrew(); if (!c) return;
    var now = Date.now(), vy = S.comp && S.comp.voyage ? openVoyage() : null;
    var v = vy || S.voyages.find(function (x) { return x.end; }) || null;
    var from, to;
    if (v) { from = Math.max(ms(v.start), now - 30 * DAY); to = v.end ? ms(v.end) : now; } else { from = now - 30 * DAY; to = now; }
    var rep = null;
    try { rep = await api('/api/crew/' + c.id + '/hor-report?history=1&days=30' + (v && v.end ? '&voyage=' + v.id : '')); } catch (e) { rep = null; }
    var days = [], t = new Date(from); t.setHours(0, 0, 0, 0);
    var tr = [0, 0, 0];
    while (t.getTime() <= to) {
      var d0 = t.getTime(), n = new Date(t); n.setDate(n.getDate() + 1); var d1 = n.getTime(), lim = Math.min(d1, to, now), a0 = Math.max(d0, from);
      var rest = 0, work = 0, longest = 0, busy = [];
      S.entries.forEach(function (e) {
        var a = Math.max(ms(e.start), a0), b = Math.min(e.end ? ms(e.end) : now, lim); if (b <= a) return;
        if (e.type === 'rest') { rest += b - a; longest = Math.max(longest, b - a); } else work += b - a; busy.push([a, b]);
      });
      var span = Math.max(0, lim - a0), un = Math.max(0, span - busy.reduce(function (s, x) { return s + (x[1] - x[0]); }, 0));
      days.push({ d0: d0, rest: rest, work: work, un: un, longest: longest }); tr[0] += rest; tr[1] += work; tr[2] += un;
      t = n;
    }
    var eps = [];
    if (rep && rep.history) {
      rep.history.rest24.forEach(function (x) { eps.push({ v: x.verdict, t: 'Less than 10 hours or the two-period rule, 24-hour window ending ' + dt(ms(x.windowEndFrom)) + ' to ' + dt(ms(x.windowEndTo)) }); });
      rep.history.rest7d.forEach(function (x) { eps.push({ v: x.verdict, t: 'Less than 77 hours, 7-day window ending ' + dt(ms(x.windowEndFrom)) + ' to ' + dt(ms(x.windowEndTo)) }); });
      rep.history.interval.forEach(function (x) { eps.push({ v: x.verdict, t: 'More than 14 hours between rest periods, ' + dt(ms(x.from)) + ' to ' + dt(ms(x.to)) + ' (' + fmtMin(x.minutes) + ')' }); });
    }
    var br = eps.filter(function (x) { return x.v === 'breach'; }), nc = eps.filter(function (x) { return x.v !== 'breach'; });
    var decl = v && v.declaration;
    var ves = S.vessel;
    var h = '<h1>Record of hours of rest</h1><div class="meta">' +
      '<div><b>Vessel:</b> ' + esc(ves.vessel || '—') + '</div><div><b>Flag:</b> ' + esc(ves.flag || '—') + '</div>' +
      '<div><b>Official number / IMO:</b> ' + esc(ves.officialNumber || '—') + '</div><div><b>Seafarer:</b> ' + esc(c.name) + '</div>' +
      '<div><b>Rank:</b> ' + esc(c.role || '—') + '</div><div><b>Period:</b> ' + dayName(from) + ' to ' + dayName(to) + '</div></div>' +
      '<table><thead><tr><th>Date</th><th class="n">Work</th><th class="n">Rest</th><th class="n">Not logged</th><th class="n">Longest rest</th></tr></thead><tbody>' +
      days.map(function (d) { return '<tr><td>' + dayName(d.d0) + '</td><td class="n">' + fmtMin(d.work / MIN) + '</td><td class="n">' + fmtMin(d.rest / MIN) + '</td><td class="n">' + fmtMin(d.un / MIN) + '</td><td class="n">' + fmtMin(d.longest / MIN) + '</td></tr>'; }).join('') +
      '<tr><th>Total</th><th class="n">' + fmtMin(tr[1] / MIN) + '</th><th class="n">' + fmtMin(tr[0] / MIN) + '</th><th class="n">' + fmtMin(tr[2] / MIN) + '</th><th></th></tr></tbody></table>' +
      '<h2>Checks</h2><p>' + (rep ? (br.length ? br.length + ' period' + (br.length === 1 ? '' : 's') + ' below the limits.' : 'No period below the limits was found.') + (nc.length ? ' ' + nc.length + ' could not be confirmed because of gaps in the record.' : '') : 'Checks were not available when this was printed.') + '</p>' +
      (br.length ? '<ul>' + br.slice(0, 25).map(function (x) { return '<li>' + esc(x.t) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="small">Limits applied: at least 10 hours of rest in any 24 hours (no more than two periods, one at least 6 hours), at least 77 hours in any 7 days, and no more than 14 hours between rest periods. Rests under 60 minutes do not count towards the split or the 14-hour gap. Time before the voyage counts as assumed available rest (Hours of Work Regulations 2018; MSN 1877).</p>' +
      '<p class="small">Joining declaration: ' + (decl ? declSummary(decl).replace(/&amp;/g, '&') : 'not taken.') + '</p>' +
      '<div class="sig"><div>Seafarer (endorsed)<br>Name and date</div><div>Master or authorised person (endorsed)<br>Name and date</div></div>' +
      '<p class="small">Printed ' + dt(now) + ' from Crow’s Nest. A copy of the endorsed record is given to the seafarer; keep records for at least one year.</p>';
    var host = $('#printRecord'); host.innerHTML = h;
    setTimeout(function () { window.print(); }, 50);
  }

  /* ---------------------------------------------------------------- events */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    var sh = sheetOf(el);
    switch (act) {
      case 'close': ev.preventDefault(); if (sh) closeSheet(sh); break;
      case 'reload': load(); break;
      case 'crew-pick': S.crewId = id; lsSet('cn.crew', id); S.showAll = false; load(); break;
      case 'crew-add': crewSheet(null); break;
      case 'crew-edit': crewSheet(S.crew.find(function (c) { return c.id === id; })); break;
      case 'crew-del': removeCrew(id); break;
      case 'tap': tap(el.getAttribute('data-k')); break;
      case 'settings': settingsSheet(el.getAttribute('data-focus')); break;
      case 'entry-add': entrySheet({}); break;
      case 'entry-edit': entrySheet({ entry: S.entries.find(function (e) { return e.id === id; }) }); break;
      case 'entry-del': deleteEntry(id); break;
      case 'entry-del-sheet': deleteEntry(id).then(function (done) { if (done && sh) closeSheet(sh); }); break;
      case 'gap-fill': entrySheet({ start: Math.ceil(+el.getAttribute('data-a') / 60000) * 60000, end: Math.floor(+el.getAttribute('data-b') / 60000) * 60000 }); break;
      case 'show-all': S.showAll = true; renderEntries(); break;
      case 'voyage-add': voyageSheet(null); break;
      case 'voyage-edit': voyageSheet(S.voyages.find(function (v) { return v.id === id; })); break;
      case 'voyage-del': deleteVoyage(id, sh); break;
      case 'voyage-end': endVoyage(); break;
      case 'decl-complete': completeDecl(id); break;
      case 'confirm-yes': if (sh && sh.confirm) sh.confirm(); break;
      case 'set-now': var t = $('#' + el.getAttribute('data-target'), sh ? sh.el : document); if (t && !t.disabled) { t.value = toLocalInput(Date.now()); } break;
      case 'print': printRecord(); break;
      case 'audit': auditSheet(); break;
    }
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target.closest('form[data-form]'); if (!f) return;
    ev.preventDefault();
    var kind = f.getAttribute('data-form');
    if (kind === 'entry') submitEntry(f);
    else if (kind === 'voyage') submitVoyage(f);
    else if (kind === 'crew') submitCrew(f);
    else if (kind === 'decl') { var s = sheetOf(f); if (s && s.declDone) s.declDone(); }
    else if (kind === 'vessel') {
      var s2 = sheetOf(f);
      api('/api/vessel', { method: 'PUT', body: { vessel: $('#vesselName', f).value, officialNumber: $('#vesselNo', f).value, flag: $('#vesselFlag', f).value } })
        .then(function () { toast('Vessel saved'); return load(); }).then(refreshSettings).catch(function (e) { showErr(s2, e); });
    } else if (kind === 'crew-first') {
      var name = $('#fcName', f).value.trim(); if (!name) { $('.errbox', f).innerHTML = '<div class="h-err" role="alert">Add a name.</div>'; $('#fcName', f).focus(); return; }
      api('/api/crew', { method: 'POST', body: { name: name, role: $('#fcRank', f).value.trim() } }).then(function (r) { S.crewId = r.id; lsSet('cn.crew', r.id); return load(); })
        .catch(function (e) { $('.errbox', f).innerHTML = '<div class="h-err" role="alert">' + esc(explain(e).text) + '</div>'; });
    }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.name === 'primary') {
      api('/api/dashboard/settings', { method: 'PUT', body: { primaryCrewId: t.value } }).then(function () { S.primaryId = t.value; toast('Dashboard now shows ' + (S.crew.find(function (c) { return c.id === t.value; }) || {}).name); })
        .catch(function (e) { toast(explain(e).text, null, 6000); refreshSettings(); });
    } else if (t.name === 'policy') {
      api('/api/settings/pre-voyage', { method: 'PUT', body: { policy: t.value } }).then(function () { S.policy = t.value; toast('Time before a voyage: ' + (t.value === 'rest' ? 'counts as available rest' : 'treated as unknown')); return load(); })
        .catch(function (e) { toast(explain(e).text, null, 6000); refreshSettings(); });
    }
  });
  $('#toastUndo').addEventListener('click', function () { var f = toastUndo; hideToast(); if (f) f(); });

  /* ---------------------------------------------------------------- clock + refresh */
  function tick() { var t = $('#nowTimer'); if (t && t.getAttribute('data-since')) t.textContent = fmtDur(Date.now() - ms(t.getAttribute('data-since'))); }
  setInterval(tick, 10000);
  setInterval(function () { if (!topSheet() && !document.hidden) load(); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !topSheet()) load(); });
  window.addEventListener('online', function () { if (!topSheet()) load(); });
  load();
})();
