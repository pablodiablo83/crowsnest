// Crow's Nest - connect page script (kept out of the HTML so the Content Security Policy can forbid inline scripts)
(function () {
  var N = window.CNNet, f = document.getElementById('cForm');
  document.getElementById('cServer').value = N.server();
  document.getElementById('cName').value = 'iPhone';
  if (!N.isApp) document.getElementById('cErr').innerHTML = '<div class="h-err">This page is for the Crow’s Nest phone app. In a browser, just open the <a href="/">dashboard</a>.</div>';
  f.addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = document.getElementById('cGo'), err = document.getElementById('cErr');
    var code = document.getElementById('cCode').value.replace(/[^A-Za-z0-9]/g, '');
    if (code.length !== 8) { err.innerHTML = '<div class="h-err">The code has 8 letters and numbers.</div>'; return; }
    btn.disabled = true; err.innerHTML = '';
    try {
      await N.pair(document.getElementById('cServer').value, code, document.getElementById('cName').value.trim());
      location.replace('/');
    } catch (x) {
      var m = String(x && x.message || x);
      if (/Load failed|Failed to fetch|NetworkError/i.test(m)) m = 'Cannot reach the server. Check the connection and the server address.';
      err.innerHTML = '<div class="h-err"></div>'; err.firstChild.textContent = m.charAt(0).toUpperCase() + m.slice(1);
      btn.disabled = false;
    }
  });
})();
