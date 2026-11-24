// Builds public/assets/coast.json: a regional coastline for the dashboard's Position picture, drawn by the app itself in the
// dashboard colours (works offline, turns red at night). Source: Natural Earth 1:10m land (public domain, via the npm package
// world-atlas). Dev-only: `npm i --prefix /tmp/wa world-atlas@2 && node scripts/make-coast.js /tmp/wa/node_modules/world-atlas/land-10m.json`
// Region: lon -100..45, lat -5..72 (Atlantic basin, NW Europe, western Mediterranean, Caribbean, E America). Rings are clipped to the
// region, thinned to about 150 m, and stored as integer deltas: [minLon,minLat,maxLon,maxLat,lon0,lat0,dx,dy,...] in 1/1000 degree.
const fs = require('fs');
const topo = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const R = [-100, -5, 45, 72], TOL = 0.0015, Q = 1000;
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; }); });
const ring = idxs => { const out = []; for (const i of idxs) { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; for (let k = out.length ? 1 : 0; k < a.length; k++) out.push(a[k]); } return out; };
const land = topo.objects.land, polys = land.type === 'MultiPolygon' ? land.arcs : land.geometries.flatMap(g => g.type === 'MultiPolygon' ? g.arcs : [g.arcs]);
function clip(poly) {   // Sutherland-Hodgman against the region rectangle
  const edges = [[0, R[0], 1], [0, R[2], -1], [1, R[1], 1], [1, R[3], -1]];
  for (const [ax, v, s] of edges) {
    const out = [], inside = p => (p[ax] - v) * s >= 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ia = inside(a), ib = inside(b);
      const cut = () => { const t = (v - a[ax]) / (b[ax] - a[ax]), p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; p[ax] = v; return p; };
      if (ia && ib) out.push(b); else if (ia && !ib) out.push(cut()); else if (!ia && ib) { out.push(cut()); out.push(b); }
    }
    poly = out; if (!poly.length) break;
  }
  return poly;
}
const thin = pts => { const o = [pts[0]]; for (const p of pts) { const q = o[o.length - 1]; if (Math.abs(p[0] - q[0]) > TOL || Math.abs(p[1] - q[1]) > TOL) o.push(p); } return o; };
const rings = [];
for (const poly of polys) for (const r of poly) {
  let pts = ring(r); const bb = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
  if (bb[2] < R[0] || bb[0] > R[2] || bb[3] < R[1] || bb[1] > R[3]) continue;
  if (bb[0] < R[0] || bb[2] > R[2] || bb[1] < R[1] || bb[3] > R[3]) pts = clip(pts);
  if (pts.length < 3) continue;
  pts = thin(pts); if (pts.length < 4) continue;
  const q = pts.map(p => [Math.round(p[0] * Q), Math.round(p[1] * Q)]);
  const mn = [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1]))], mx = [Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))];
  const row = [mn[0], mn[1], mx[0], mx[1], q[0][0], q[0][1]]; for (let i = 1; i < q.length; i++) row.push(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
  rings.push(row);
}
fs.writeFileSync(process.argv[3] || 'public/assets/coast.json', JSON.stringify({ v: 1, q: Q, source: 'Natural Earth 1:10m land (public domain)', region: R, rings }));
console.log(rings.length + ' rings, ' + rings.reduce((a, r) => a + (r.length - 6) / 2 + 1, 0) + ' points');
