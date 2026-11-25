// Crow's Nest motion helpers (25 Nov 2026): the Night cross-fade on every page (any change of the 'night' class on <html> or <body>),
// and CNMotion.flash(el) for a value that just changed. Respects Reduce Motion. Never throws into the page.
(function () {
  'use strict';
  var still = function () { try { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  var html = document.documentElement, timer = null, was = null;
  var night = function () { return html.classList.contains('night') || (document.body && document.body.classList.contains('night')); };
  function changed() {
    var n = night(); if (was === null) { was = n; return; } if (n === was) return; was = n;
    if (still()) return;
    html.classList.add('cn-theme-x'); clearTimeout(timer); timer = setTimeout(function () { html.classList.remove('cn-theme-x'); }, 340);
  }
  try {
    was = night();
    var mo = new MutationObserver(changed); mo.observe(html, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('DOMContentLoaded', function () { if (document.body) { was = night(); new MutationObserver(changed).observe(document.body, { attributes: true, attributeFilter: ['class'] }); } });
  } catch (e) {}
  // a navigation that interrupts a view transition makes the browser reject its promises: that is not an error worth reporting
  var quiet = function (e) { var vt = e && e.viewTransition; if (!vt) return; ['ready', 'finished', 'updateCallbackDone'].forEach(function (k) { try { vt[k] && vt[k].catch(function () {}); } catch (x) {} }); };
  window.addEventListener('pagereveal', quiet); window.addEventListener('pageswap', quiet);
  window.CNMotion = { flash: function (el) { if (!el || still()) return; el.classList.remove('cn-flash'); void el.offsetWidth; el.classList.add('cn-flash'); }, still: still };
})();
