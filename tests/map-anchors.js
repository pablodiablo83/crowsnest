// Position picture: in open water the map zooms out to the nearest land behind and ahead (dashpics.js landAnchors) - mid-Atlantic
// heading west must give the Canaries behind and the Windward Islands ahead; near land the view stays local (nearest land < 40 nm).
const fs = require('fs'), path = require('path');
global.window = {}; global.document = {};
global.fetch = async () => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, '../public/assets/coast.json'), 'utf8')) });
let src = fs.readFileSync(path.join(__dirname, '../public/dashpics.js'), 'utf8').replace('window.CNPics = {', 'window.CNPics = { landAnchors: landAnchors, loadCoast: loadCoast,');
eval(src);
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  await window.CNPics.loadCoast();
  const A = (lat, lon, cog) => window.CNPics.landAnchors({ lat, lon }, cog);
  let a = A(25.69, -22.52, 258);
  ok(a.length === 2 && a[0].nm > 200 && a[0].nm < 330 && a[0].lat > 27 && a[0].lat < 29.5 && a[0].lon > -19 && a[0].lon < -13, 'behind: the Canaries (' + a[0].nm.toFixed(0) + ' nm)');
  ok(a[1].lat > 10 && a[1].lat < 18.5 && a[1].lon < -58 && a[1].lon > -64 && a[1].nm > 1900 && a[1].nm < 2500, 'ahead: the Windward / Leeward Islands (' + a[1].nm.toFixed(0) + ' nm)');
  a = A(55.62, -5.88, 271);
  ok(a.length && a[0].nm < 40, 'in the Clyde: land is close, so the view stays local (' + a[0].nm.toFixed(1) + ' nm)');
  a = A(25.69, -22.52, null);
  ok(a.length >= 2 && a[0].nm < 330, 'no course: the nearest land and the nearest the other way (' + a.map(x => Math.round(x.nm)).join(', ') + ' nm)');
  const t0 = Date.now(); for (let i = 0; i < 5; i++) A(25 + i * 0.5, -22.52, 258);
  ok(Date.now() - t0 < 3000, 'five searches in ' + (Date.now() - t0) + ' ms');
  process.exit(fails ? 1 : 0);
})();
