// Crow's Nest branding for everything exported (printouts, PDFs, CSV, JSON, GPX): one place for the name, the mark and
// the copyright line. Works in the browser (window.CNBrand) and on the server (require('./public/brand.js')).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.CNBrand = factory();
})(this, function () {
  'use strict';
  var NAME = 'Crow’s Nest';
  var HOLDER = 'Crow’s Nest';   // copyright holder named in every notice
  var NAVY = '#062F4A';
  function year(at) { return new Date(at || Date.now()).getFullYear(); }
  // "© 2026 Crow's Nest. All rights reserved."
  function notice(at) { return '© ' + year(at) + ' ' + HOLDER + '. All rights reserved.'; }
  // the app icon (option A, app/assets/icon.svg), rounded like on the home screen
  var MARK = '<svg viewBox="0 0 1024 1024" width="40" height="40" aria-hidden="true" style="flex:none"><defs> <linearGradient id="cnpBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E3F8F"/><stop offset="1" stop-color="#00154C"/></linearGradient> <radialGradient id="cnpLens" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#0B2E6E"/><stop offset="1" stop-color="#00154C"/></radialGradient> <clipPath id="cnpL"><circle cx="315" cy="565" r="150"/></clipPath> <clipPath id="cnpR"><circle cx="685" cy="565" r="150"/></clipPath> <clipPath id="cnpSq"><rect width="1024" height="1024" rx="229"/></clipPath></defs><g clip-path="url(#cnpSq)"> <rect width="1024" height="1024" fill="url(#cnpBg)"/> <g transform="translate(512 530) scale(.94) translate(-500 -521)"> <g fill="#FFFFFF"><rect x="232" y="262" width="196" height="150" rx="44"/><rect x="572" y="262" width="196" height="150" rx="44"/><rect x="400" y="430" width="200" height="170" rx="30"/><circle cx="315" cy="565" r="215"/><circle cx="685" cy="565" r="215"/></g> <circle cx="315" cy="565" r="150" fill="url(#cnpLens)"/><circle cx="685" cy="565" r="150" fill="url(#cnpLens)"/> <g clip-path="url(#cnpL)"> <path fill="#28A7C4" d="M150 600 Q 200 560 250 600 T 350 600 T 450 600 T 550 600 V760 H150Z"/> <path fill="#0C829B" d="M150 650 Q 205 615 260 650 T 370 650 T 480 650 V760 H150Z"/> <path d="M150 600 Q 200 560 250 600 T 350 600 T 450 600" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".9"/> </g> <g clip-path="url(#cnpR)" fill="#F5B041"><rect x="600" y="575" width="42" height="80" rx="8"/><rect x="664" y="530" width="42" height="125" rx="8"/><rect x="728" y="480" width="42" height="175" rx="8"/></g> <path d="M220 500 A 110 110 0 0 1 300 440" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity=".28"/> <path d="M590 500 A 110 110 0 0 1 670 440" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity=".28"/> </g> </g></svg>';
  // printed letterhead: mark + name, document title on the right
  function letterhead(title) {
    return '<div class="cn-letterhead" style="display:flex;align-items:center;gap:10px;border-bottom:2px solid ' + NAVY + ';padding-bottom:6px;margin-bottom:10px;color:' + NAVY + '">' +
      MARK + '<div style="font:900 20px/1 Lato,Arial,sans-serif;letter-spacing:.01em">' + NAME + '</div>' +
      (title ? '<div style="margin-left:auto;font:700 12px/1.2 Lato,Arial,sans-serif;text-align:right">' + title + '</div>' : '') + '</div>';
  }
  // printed footer: the notice, plus any third-party credits (already escaped HTML)
  function footer(credits, at) {
    return '<div class="cn-notice" style="border-top:1px solid #999;margin-top:14px;padding-top:6px;font:400 9.5px/1.4 Lato,Arial,sans-serif;color:#444">' +
      '<b>' + notice(at) + '</b> Produced with ' + NAME + '.' + (credits ? ' ' + credits : '') + '</div>';
  }
  function docTitle(t) { return NAME + ' – ' + t; }   // becomes the PDF's name when saved from Print
  return { NAME: NAME, HOLDER: HOLDER, year: year, notice: notice, MARK: MARK, letterhead: letterhead, footer: footer, docTitle: docTitle };
});
