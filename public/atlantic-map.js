/* Small map layer for the Atlantic weather chart (atlantic.js). It offers the handful of Leaflet-style calls the chart uses,
   so the page needs no CDN script (Crow's Nest only allows its own scripts). No map tiles: the chart draws its own coastline.
   Web-Mercator, world = 256 * 2^zoom pixels, like Leaflet. */
(function () {
  'use strict';
  var D2R = Math.PI / 180, SVGNS = 'http://www.w3.org/2000/svg';
  var still = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  function LL(a, b) { if (Array.isArray(a)) return { lat: a[0], lng: a[1] }; if (a && a.lat !== undefined) return { lat: a.lat, lng: a.lng !== undefined ? a.lng : a.lon }; return { lat: a, lng: b }; }
  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
  var L = window.L = {};
  L.DomUtil = {
    create: el,
    setPosition: function (e, p) { e.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)'; },
    setTransform: function (e, p, s) { e.style.transformOrigin = '0 0'; e.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px) scale(' + (s || 1) + ')'; }
  };
  L.DomEvent = {
    disableClickPropagation: function (e) { ['pointerdown', 'click', 'dblclick', 'wheel'].forEach(function (n) { e.addEventListener(n, function (ev) { ev.stopPropagation(); }, { passive: n !== 'wheel' }); }); },
    disableScrollPropagation: function () {}
  };
  function Bounds(s, w, n, e) { this._s = s; this._w = w; this._n = n; this._e = e; }
  Bounds.prototype.getSouth = function () { return this._s; }; Bounds.prototype.getNorth = function () { return this._n; };
  Bounds.prototype.getWest = function () { return this._w; }; Bounds.prototype.getEast = function () { return this._e; };

  /* ---- layers ---- */
  function Group() { this.items = []; this.map = null; }
  Group.prototype.addTo = function (m) { this.map = m; m._groups.indexOf(this) < 0 && m._groups.push(this); m._dirty(); return this; };
  Group.prototype.remove = function () { if (this.map) { var i = this.map._groups.indexOf(this); if (i >= 0) this.map._groups.splice(i, 1); this.map._dirty(); this.map = null; } return this; };
  Group.prototype.clearLayers = function () { this.items.forEach(function (s) { s._g = null; }); this.items = []; if (this.map) this.map._dirty(); return this; };
  L.layerGroup = function () { return new Group(); };
  function Shape(kind, pts, o) { this.kind = kind; this.pts = pts; this.o = o || {}; this._g = null; }
  Shape.prototype.addTo = function (g) { this._g = g; g.items.push(this); if (g.map) g.map._dirty(); return this; };
  Shape.prototype.setStyle = function (o) { for (var k in o) this.o[k] = o[k]; if (this._g && this._g.map) this._g.map._dirty(); return this; };
  Shape.prototype.bringToFront = function () { var g = this._g; if (g) { var i = g.items.indexOf(this); if (i >= 0) { g.items.splice(i, 1); g.items.push(this); } if (g.map) g.map._dirty(); } return this; };
  L.polyline = function (pts, o) { return new Shape('line', pts.map(LL), o); };
  L.rectangle = function (b, o) { var a = LL(b[0]), c = LL(b[1]); return new Shape('rect', [a, c], o); };
  L.circleMarker = function (p, o) { return new Shape('circle', [LL(p)], o); };
  L.divIcon = function (o) { return o; };
  L.marker = function (p, o) { return new Shape('marker', [LL(p)], o); };

  /* ---- controls ---- */
  L.Control = function () {};
  L.Control.extend = function (proto) {
    var C = function () { this.options = proto.options || {}; };
    C.prototype.onAdd = proto.onAdd;
    C.prototype.addTo = function (m) { var c = this.onAdd(m); c.style.position = 'absolute'; c.style.zIndex = 500; c.style.top = '10px'; c.style.left = '0'; m._root.appendChild(c); return this; };
    return C;
  };

  /* ---- map ---- */
  L.map = function (id, o) { return new MapView(typeof id === 'string' ? document.getElementById(id) : id, o || {}); };
  function MapView(host, o) {
    var self = this;
    this.host = host; this.o = o; this.min = o.minZoom != null ? o.minZoom : 2; this.max = o.maxZoom != null ? o.maxZoom : 18;
    this.mb = o.maxBounds || null; this.h = {}; this.lat = 20; this.lng = -35; this.z = 4; this._groups = [];
    host.style.overflow = 'hidden'; host.style.touchAction = 'none';
    this._root = el('div', 'amap-root', host); this._root.style.cssText = 'position:absolute;inset:0;z-index:0';
    host.insertBefore(this._root, host.firstChild);
    this._panes = {};
    this._svg = document.createElementNS(SVGNS, 'svg'); this._svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:400;pointer-events:none;overflow:visible';
    this._root.appendChild(this._svg);
    this._labels = el('div', '', this._root); this._labels.style.cssText = 'position:absolute;inset:0;z-index:450;pointer-events:none;overflow:hidden';
    this._size();
    this._cLat = this.lat; this._cLng = this.lng; this._cZ = this.z;   // the view the weather canvas was last drawn for
    this._bind();
    window.addEventListener('resize', function () { self.invalidateSize(); });
  }
  var P = MapView.prototype;
  P.on = function (names, fn) { var self = this; names.split(' ').forEach(function (n) { (self.h[n] = self.h[n] || []).push(fn); }); return this; };
  P.fire = function (n, ev) { (this.h[n] || []).forEach(function (f) { f(ev || {}); }); };
  P._size = function () { var r = this.host.getBoundingClientRect(); this.w = Math.max(1, r.width); this.hh = Math.max(1, r.height); };
  P.getSize = function () { return { x: this.w, y: this.hh }; };
  P.invalidateSize = function () { this._size(); this._clamp(); this._dirty(); this._syncPane(); this.fire('resize'); };
  P.createPane = function (name) {
    var p = el('div', 'amap-pane', this._root); p.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;transform-origin:0 0';
    this._root.insertBefore(p, this._svg); this._panes[name] = p; this._wx = p; return p;
  };
  function wpx(z) { return 256 * Math.pow(2, z); }
  function px(lat, lng, z) {
    var s = wpx(z), sin = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * D2R);
    return { x: (lng + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
  }
  function unpx(x, y, z) {
    var s = wpx(z), n = Math.PI - 2 * Math.PI * y / s;
    return { lat: Math.atan(Math.sinh(n)) / D2R, lng: x / s * 360 - 180 };
  }
  P._at = function (lat, lng, z, x, y) { var c = px(lat, lng, z); return unpx(c.x - this.w / 2 + x, c.y - this.hh / 2 + y, z); };
  P.latLngToContainerPoint = function (a) {
    a = LL(a); var c = px(this.lat, this.lng, this.z), p = px(a.lat, a.lng, this.z);
    return { x: p.x - c.x + this.w / 2, y: p.y - c.y + this.hh / 2 };
  };
  P.containerPointToLatLng = function (p) { if (Array.isArray(p)) p = { x: p[0], y: p[1] }; return this._at(this.lat, this.lng, this.z, p.x, p.y); };
  P.containerPointToLayerPoint = function (p) { return Array.isArray(p) ? { x: p[0], y: p[1] } : p; };
  P.getZoom = function () { return this.z; };
  P.getCenter = function () { return { lat: this.lat, lng: this.lng }; };
  P.getBounds = function () { var a = this.containerPointToLatLng([0, 0]), b = this.containerPointToLatLng([this.w, this.hh]); return new Bounds(b.lat, a.lng, a.lat, b.lng); };
  P._clamp = function () {
    this.z = Math.max(this.min, Math.min(this.max, this.z));
    if (this.mb) { this.lat = Math.max(this.mb[0][0], Math.min(this.mb[1][0], this.lat)); this.lng = Math.max(this.mb[0][1], Math.min(this.mb[1][1], this.lng)); }
  };
  P._boundsView = function (b, opt) {
    opt = opt || {}; var pad = opt.padding || [0, 0], a = LL(b[0]), c = LL(b[1]);
    if (b.length > 2) { var la = b.map(function (q) { return LL(q); }); a = { lat: Math.min.apply(null, la.map(function (q) { return q.lat; })), lng: Math.min.apply(null, la.map(function (q) { return q.lng; })) }; c = { lat: Math.max.apply(null, la.map(function (q) { return q.lat; })), lng: Math.max.apply(null, la.map(function (q) { return q.lng; })) }; }
    var s = Math.min(a.lat, c.lat), n = Math.max(a.lat, c.lat), w = Math.min(a.lng, c.lng), e = Math.max(a.lng, c.lng);
    var p0 = px(n, w, 0), p1 = px(s, e, 0), dx = Math.max(1e-6, p1.x - p0.x), dy = Math.max(1e-6, p1.y - p0.y);
    var z = Math.min(Math.log2(Math.max(10, this.w - 2 * pad[0]) / dx), Math.log2(Math.max(10, this.hh - 2 * pad[1]) / dy));
    z = Math.floor(z * 4) / 4; if (opt.maxZoom != null) z = Math.min(z, opt.maxZoom); z = Math.max(this.min, Math.min(this.max, z));
    var c0 = unpx((p0.x + p1.x) / 2 * Math.pow(2, z), (p0.y + p1.y) / 2 * Math.pow(2, z), z);
    return { lat: c0.lat, lng: c0.lng, z: z };
  };
  P._set = function (lat, lng, z, quiet) { this.lat = lat; this.lng = lng; this.z = z; this._clamp(); this._dirty(); this._syncPane(); if (!quiet) this._end(); };
  P._end = function () { this._cLat = this.lat; this._cLng = this.lng; this._cZ = this.z; this._syncPane(); this.fire('zoomend'); this.fire('moveend'); };
  P._syncPane = function () {   // the weather canvas keeps its old picture until redrawn: slide and scale it with the view
    var p = this._wx; if (!p) return;
    var s = Math.pow(2, this.z - this._cZ), o = this.latLngToContainerPoint({ lat: this._at(this._cLat, this._cLng, this._cZ, 0, 0).lat, lng: this._at(this._cLat, this._cLng, this._cZ, 0, 0).lng });
    p.style.transform = (s === 1 && Math.abs(o.x) < 0.01 && Math.abs(o.y) < 0.01) ? 'none' : 'translate(' + o.x + 'px,' + o.y + 'px) scale(' + s + ')';
  };
  P.fitBounds = function (b, opt) { var v = this._boundsView(b, opt); this._set(v.lat, v.lng, v.z); return this; };
  P.setView = function (c, z) { c = LL(c); this._set(c.lat, c.lng, z != null ? z : this.z); return this; };
  P.panTo = function (c) { return this.flyTo(c, this.z, { duration: 0.35 }); };
  P.zoomIn = function () { return this._zoomBy(0.5); }; P.zoomOut = function () { return this._zoomBy(-0.5); };
  P._zoomBy = function (d) { return this.flyTo({ lat: this.lat, lng: this.lng }, Math.round((this.z + d) * 4) / 4, { duration: 0.25 }); };
  P.flyToBounds = function (b, opt) { var v = this._boundsView(b, opt); return this.flyTo({ lat: v.lat, lng: v.lng }, v.z, opt); };
  P.flyTo = function (c, z, opt) {
    c = LL(c); var self = this, dur = (opt && opt.duration != null ? opt.duration : 0.6) * 1000;
    cancelAnimationFrame(this._anim);
    z = Math.max(this.min, Math.min(this.max, z != null ? z : this.z));
    if (still() || dur <= 0) { this._set(c.lat, c.lng, z); return this; }
    var a0 = { lat: this.lat, lng: this.lng, z: this.z }, p0 = px(a0.lat, a0.lng, 0), p1 = px(c.lat, c.lng, 0), t0 = performance.now();
    (function step(now) {
      var t = Math.min(1, (now - t0) / dur), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      var q = unpx(p0.x + (p1.x - p0.x) * e, p0.y + (p1.y - p0.y) * e, 0);
      self._set(q.lat, q.lng, a0.z + (z - a0.z) * e, t < 1);
      if (t < 1) self._anim = requestAnimationFrame(step);
    })(t0);
    return this;
  };
  P._zoomAt = function (nz, x, y) {   // keep the point under the finger fixed
    nz = Math.max(this.min, Math.min(this.max, nz));
    var before = this.containerPointToLatLng([x, y]); this.z = nz;
    var after = this.containerPointToLatLng([x, y]);
    var c = px(this.lat, this.lng, nz), a = px(after.lat, after.lng, nz), b = px(before.lat, before.lng, nz);
    var n = unpx(c.x + (a.x - b.x), c.y + (a.y - b.y), nz); this.lat = n.lat; this.lng = n.lng;
    this._clamp(); this._dirty(); this._syncPane();
  };
  P._settle = function () {   // after wheel/pinch: snap the zoom to a quarter step and tell the chart to redraw
    var self = this; clearTimeout(this._st);
    this._st = setTimeout(function () { self.z = Math.round(self.z * 4) / 4; self._clamp(); self._dirty(); self._end(); }, 160);
  };
  P._bind = function () {
    var self = this, host = this.host, ptrs = {}, moved = 0, startAt = null;
    function rel(e) { var r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function ours(e) { return !e.target.closest('.zc,.legend,.readout,.msg,button,input'); }
    host.addEventListener('pointerdown', function (e) {
      if (!ours(e)) return; cancelAnimationFrame(self._anim);
      try { host.setPointerCapture(e.pointerId); } catch (x) {}
      ptrs[e.pointerId] = rel(e); if (Object.keys(ptrs).length === 1) { moved = 0; startAt = rel(e); }
    });
    host.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return; var now = rel(e), prev = ptrs[e.pointerId], ids = Object.keys(ptrs);
      if (ids.length === 1) {
        var dx = now[0] - prev[0], dy = now[1] - prev[1]; moved += Math.abs(dx) + Math.abs(dy); ptrs[e.pointerId] = now;
        var c = px(self.lat, self.lng, self.z), n = unpx(c.x - dx, c.y - dy, self.z); self.lat = n.lat; self.lng = n.lng; self._clamp(); self._dirty(); self._syncPane(); self._settle();
      } else if (ids.length === 2) {
        var o = ptrs[ids.find(function (k) { return +k !== e.pointerId; })], d0 = Math.hypot(prev[0] - o[0], prev[1] - o[1]), d1 = Math.hypot(now[0] - o[0], now[1] - o[1]);
        ptrs[e.pointerId] = now; moved += 99; if (d0 > 8 && d1 > 8) self._zoomAt(self.z + Math.log2(d1 / d0), (now[0] + o[0]) / 2, (now[1] + o[1]) / 2); self._settle();
      }
    });
    function up(e) {
      if (!ptrs[e.pointerId]) return; var wasOne = Object.keys(ptrs).length === 1; delete ptrs[e.pointerId];
      if (wasOne && moved < 6 && startAt && e.type === 'pointerup') self.fire('click', { latlng: self.containerPointToLatLng(startAt) });
    }
    host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
    host.addEventListener('wheel', function (e) { if (!ours(e)) return; e.preventDefault(); var p = rel(e); self._zoomAt(self.z - e.deltaY / 90, p[0], p[1]); self._settle(); }, { passive: false });
    host.addEventListener('dblclick', function (e) { if (!ours(e)) return; var p = rel(e), ll = self.containerPointToLatLng(p); self.flyTo(ll, self.z + 1, { duration: 0.3 }); });
    if (window.ResizeObserver) new ResizeObserver(function () { self.invalidateSize(); }).observe(host);
  };
  /* ---- drawing of lines, boxes, dots and labels ---- */
  P._dirty = function () { if (this._raf) return; var self = this; this._raf = requestAnimationFrame(function () { self._raf = 0; self._paint(); }); };
  function sv(tag, a) { var e = document.createElementNS(SVGNS, tag); for (var k in a) if (a[k] != null) e.setAttribute(k, a[k]); return e; }
  P._paint = function () {
    var svg = this._svg, lab = this._labels, self = this;
    while (svg.firstChild) svg.removeChild(svg.firstChild); lab.textContent = '';
    this._groups.forEach(function (g) { g.items.forEach(function (s) {
      var o = s.o, pts = s.pts.map(function (p) { return self.latLngToContainerPoint(p); });
      var stroke = { stroke: o.color || '#3388ff', 'stroke-width': o.weight != null ? o.weight : 3, 'stroke-opacity': o.opacity != null ? o.opacity : 1, 'stroke-dasharray': o.dashArray || null, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
      if (s.kind === 'line') {
        var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join('');
        svg.appendChild(sv('path', Object.assign({ d: d, fill: 'none' }, stroke)));
      } else if (s.kind === 'rect') {
        var x0 = Math.min(pts[0].x, pts[1].x), x1 = Math.max(pts[0].x, pts[1].x), y0 = Math.min(pts[0].y, pts[1].y), y1 = Math.max(pts[0].y, pts[1].y);
        svg.appendChild(sv('rect', Object.assign({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: o.fill === false ? 'none' : (o.fillColor || o.color || '#3388ff'), 'fill-opacity': o.fillOpacity != null ? o.fillOpacity : 0.2 }, stroke)));
      } else if (s.kind === 'circle') {
        svg.appendChild(sv('circle', Object.assign({ cx: pts[0].x, cy: pts[0].y, r: o.radius || 5, fill: o.fill === false ? 'none' : (o.fillColor || o.color || '#3388ff'), 'fill-opacity': o.fillOpacity != null ? o.fillOpacity : 0.2 }, stroke)));
      } else if (s.kind === 'marker' && o.icon) {
        var ic = o.icon, sz = ic.iconSize || [12, 12], an = ic.iconAnchor || [sz[0] / 2, sz[1] / 2];
        var d2 = el('div', ic.className || '', lab); d2.innerHTML = ic.html || '';
        d2.style.cssText = 'position:absolute;left:' + (pts[0].x - an[0]).toFixed(1) + 'px;top:' + (pts[0].y - an[1]).toFixed(1) + 'px;width:' + sz[0] + 'px;height:' + sz[1] + 'px';
      }
    }); });
  };
})();
