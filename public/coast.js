// Coastline for the maps (24 Nov 2026): public/assets/coast.json (Natural Earth 1:10m land, public domain; scripts/make-coast.js) decoded once into
// Web Mercator world coordinates at zoom 0 (0..256), so a map can draw it at any zoom with a multiply and a subtract, no trigonometry per point.
// Used by the voyage map (track.js). The dashboard's Position picture (dashpics.js) reads the same file in its own projection.
(function () {
  'use strict';
  var rings = null, loading = null;
  function mx(lon) { return (lon + 180) / 360 * 256; }
  function my(lat) { var s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256; }
  function load() {
    if (rings) return Promise.resolve(rings);
    if (!loading) loading = fetch('/assets/coast.json').then(function (r) { if (!r.ok) throw new Error('coast ' + r.status); return r.json(); }).then(function (d) {
      var q = d.q || 1000;
      rings = d.rings.map(function (r) {
        var n = (r.length - 4) / 2, X = new Float32Array(n), Y = new Float32Array(n), x = r[4], y = r[5], i, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (i = 0; i < n; i++) { if (i) { x += r[4 + i * 2]; y += r[5 + i * 2]; } X[i] = mx(x / q); Y[i] = my(y / q); if (X[i] < x0) x0 = X[i]; if (X[i] > x1) x1 = X[i]; if (Y[i] < y0) y0 = Y[i]; if (Y[i] > y1) y1 = Y[i]; }
        return { x: X, y: Y, bb: [x0, y0, x1, y1] };
      });
      return rings;
    }).catch(function () { loading = null; return null; });
    return loading;
  }
  window.CNCoast = { load: load, rings: function () { return rings; } };
})();
