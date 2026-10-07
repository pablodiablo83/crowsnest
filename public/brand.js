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
  // the binoculars mark (as on the sign-in page), navy on white for paper
  var MARK = '<svg viewBox="0 0 1000 1000" width="40" height="40" aria-hidden="true" style="flex:none">' +
    '<g transform="translate(500 500) scale(.95) translate(-500 -520)">' +
    '<g fill="' + NAVY + '"><rect x="232" y="262" width="196" height="150" rx="44"/><rect x="572" y="262" width="196" height="150" rx="44"/><rect x="400" y="430" width="200" height="170" rx="30"/><circle cx="315" cy="565" r="215"/><circle cx="685" cy="565" r="215"/></g>' +
    '<circle cx="315" cy="565" r="140" fill="#fff"/><circle cx="685" cy="565" r="140" fill="#fff"/>' +
    '<g transform="translate(-15 155)"><path fill="#28A7C4" d="M210 402c45-18 73 10 119 17 42 7 78 0 126-20-3 53-43 94-105 94-70 0-124-38-140-91z"/><path fill="#0C829B" d="M210 402c39 20 70 30 112 29 44-1 82-15 133-32-13 55-61 94-125 94-58 0-106-33-120-91z"/></g>' +
    '<g fill="#0C829B" transform="translate(15 155)"><rect x="595" y="430" width="38" height="72"/><rect x="650" y="395" width="38" height="107"/><rect x="705" y="355" width="38" height="147"/></g>' +
    '</g></svg>';
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
