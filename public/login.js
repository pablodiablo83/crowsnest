// Crow's Nest - login page script (kept out of the HTML so the Content Security Policy can forbid inline scripts)
(function () {
  'use strict';
  var f = document.getElementById('f'), err = document.getElementById('err');
  var next = new URLSearchParams(location.search).get('next') || '/';
  // only a path on this site: no other origin (also /\evil and /<tab>/evil, which browsers read as //evil)
  try { var u = new URL(next, location.origin); next = u.origin === location.origin && !/[\\\x00-\x1f]/.test(next) && next.charAt(0) === '/' && !/^\/login\.html/.test(u.pathname) ? u.pathname + u.search + u.hash : '/'; } catch (e) { next = '/'; }
  function go() { document.getElementById('busyText').textContent = 'Opening Crow’s Nest…'; f.classList.add('signing'); location.replace(next); }
  // already signed in on this device: straight through
  fetch('/api/auth/me', { cache: 'no-store' }).then(function (r) { if (r.ok) go(); }).catch(function () {});
  // brand-new server: say how to create the first account (only possible on the server itself)
  fetch('/api/auth/status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.accounts === false) err.innerHTML = 'No accounts yet. On the server run:<br><code style="color:#fff;font-weight:400;font-size:13px">docker exec -it crowsnest-hor node tools/user.js add skipper</code>';
  }).catch(function () {});
  document.getElementById('u').focus();
  f.addEventListener('submit', async function (e) {
    e.preventDefault();
    var u = document.getElementById('u').value.trim(), p = document.getElementById('p').value;
    if (!u || !p) { err.textContent = 'Enter your username and password.'; return; }
    err.textContent = ''; f.classList.add('signing');
    var t0 = Date.now();
    try {
      var r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p, remember: document.getElementById('r').checked }) });
      var d = {}; try { d = await r.json(); } catch (x) {}
      if (!r.ok) throw new Error(d.error || ('Sign-in failed (' + r.status + ')'));
      setTimeout(go, Math.max(0, 900 - (Date.now() - t0)));   // let the swell roll past, then go
    } catch (x) {
      f.classList.remove('signing');
      var m = String(x.message || x);
      if (/Failed to fetch|Load failed|NetworkError/i.test(m)) m = 'No connection to Crow’s Nest. Check the signal and try again.';
      err.textContent = m.charAt(0).toUpperCase() + m.slice(1) + (/[.!]$/.test(m) ? '' : '.');
      document.getElementById('p').select();
    }
  });
})();
