// Dashboard chrome (24 Nov 2026): night mode, clock, the assistant panel behind the mic button, the More sheet on narrow screens.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var html = document.documentElement;
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // ---- night mode (red light, one hue): remembered on this device. Applied by an inline-free early call below.
  function applyTheme(night) {
    html.classList.toggle('night', night);
    var b = $('themeBtn'); if (!b) return;
    b.setAttribute('aria-pressed', night ? 'true' : 'false');
    $('themeTxt').textContent = night ? 'Day' : 'Night';
    $('themeIcon').setAttribute('href', night ? '#i-sun' : '#i-rest');
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', night ? '#000000' : '#00154C');
  }
  applyTheme(get('cn_theme') === 'night');
  $('themeBtn').addEventListener('click', function () { var n = !html.classList.contains('night'); set('cn_theme', n ? 'night' : 'day'); applyTheme(n); });

  // ---- clock
  function clock() { var d = new Date(); $('dClock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  clock(); setInterval(clock, 15000);

  // ---- assistant panel
  var asst = $('asst'), mic = $('micBtn');
  function openAsst(on) {
    asst.hidden = !on; mic.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) setTimeout(function () { try { $('agentInput').focus(); } catch (e) {} }, 50);
  }
  mic.addEventListener('click', function () { openAsst(asst.hidden); });
  Array.prototype.forEach.call(document.querySelectorAll('.dchips [data-say]'), function (b) {
    b.addEventListener('click', function () { $('agentInput').value = b.getAttribute('data-say'); $('agentForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); });
  });

  // ---- More sheet (narrow screens)
  var sheet = $('moreSheet');
  function openMore(on) { sheet.hidden = !on; if (on) { var a = sheet.querySelector('a'); if (a) a.focus(); } else { var mb = $('moreBtn'); if (mb) mb.focus(); } }
  $('moreBtn').addEventListener('click', function () { openMore(true); });
  $('moreClose').addEventListener('click', function () { openMore(false); });
  sheet.addEventListener('click', function (e) { if (e.target === sheet) openMore(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!sheet.hidden) openMore(false); else if (!asst.hidden) openAsst(false); } });
})();
