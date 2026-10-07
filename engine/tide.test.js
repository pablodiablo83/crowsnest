// Tide engine unit tests: node --test engine/tide.test.js
'use strict';
const test = require('node:test'), assert = require('node:assert');
const T = require('./tide.js');

test('constituent speeds match the published values (deg/hour)', () => {
  const known = { M2: 28.9841042, S2: 30, N2: 28.4397295, K2: 30.0821373, K1: 15.0410686, O1: 13.9430356, P1: 14.9589314, Q1: 13.3986609,
    M4: 57.9682084, MS4: 58.9841042, MN4: 57.4238337, M6: 86.9523127, L2: 29.5284789, nu2: 28.5125831, mu2: 27.9682084, '2N2': 27.8953548,
    T2: 29.9589333, R2: 30.0410667, lambda2: 29.4556253, J1: 15.5854433, OO1: 16.1391017, rho1: 13.4715145, '2Q1': 12.8542862,
    MK3: 44.0251729, M3: 43.4761563, '2MK3': 42.9271398, Mf: 1.0980331, Mm: 0.5443747, MSf: 1.0158958, Ssa: 0.0821373, Sa: 0.0410686, S1: 15, M1: 14.4966939 };
  for (const [n, s] of Object.entries(known)) assert.ok(Math.abs(T.speedOf(n) - s) < 2e-6, n + ' ' + T.speedOf(n) + ' vs ' + s);
});

test('nodal factors stay in their physical ranges over a full 18.6-year cycle', () => {
  for (let y = 2010; y <= 2029; y += 0.5) {
    const ms = Date.UTC(2010, 0, 1) + (y - 2010) * 365.25 * 86400000;
    const a = T.args(['M2', 'K1', 'O1', 'K2'], ms);
    const f = Object.fromEntries(a.map(x => [x.n, x.f]));
    assert.ok(f.M2 > 0.96 && f.M2 < 1.04, 'f M2 ' + f.M2);
    assert.ok(f.K1 > 0.87 && f.K1 < 1.12, 'f K1 ' + f.K1);
    assert.ok(f.O1 > 0.80 && f.O1 < 1.19, 'f O1 ' + f.O1);
    assert.ok(f.K2 > 0.74 && f.K2 < 1.32, 'f K2 ' + f.K2);
  }
});

test('analysis recovers known constants from a synthetic year (with noise and bad readings)', () => {
  const truth = [{ name: 'M2', H: 1.20, G: 110 }, { name: 'S2', H: 0.40, G: 150 }, { name: 'N2', H: 0.23, G: 90 }, { name: 'K2', H: 0.11, G: 148 },
    { name: 'K1', H: 0.10, G: 200 }, { name: 'O1', H: 0.08, G: 40 }, { name: 'P1', H: 0.033, G: 195 }, { name: 'M4', H: 0.06, G: 300 }, { name: 'MS4', H: 0.04, G: 340 }];
  const t0 = Date.UTC(2025, 0, 1), times = [];
  for (let t = t0; t < t0 + 370 * 86400000; t += 15 * 60000) times.push(t);
  const h = T.predict(truth, 1.9, times);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  const obs = times.map((t, i) => ({ t, h: h[i] + 0.03 * rnd() + (i % 5000 === 17 ? 3 : 0) }));   // 3 cm noise + a few 3 m spikes
  const r = T.analyse(obs);
  assert.ok(Math.abs(r.z0 - 1.9) < 0.002, 'z0 ' + r.z0);
  for (const c of truth) {
    const g = r.cons.find(x => x.name === c.name);
    assert.ok(g, c.name + ' not fitted');
    assert.ok(Math.abs(g.H - c.H) < 0.003, c.name + ' H ' + g.H);
    const dG = Math.abs(((g.G - c.G + 540) % 360) - 180);
    assert.ok(dG < (c.H > 0.05 ? 1.5 : 4), c.name + ' G ' + g.G + ' vs ' + c.G);
  }
  assert.ok(r.rejected >= 7, 'spikes rejected: ' + r.rejected);
  assert.ok(r.rms < 0.02, 'rms ' + r.rms);
});

test('Rayleigh criterion: a month cannot separate K1 from P1, a year can', () => {
  const month = T.chooseConstituents(30 * 24), year = T.chooseConstituents(370 * 24);
  assert.ok(month.includes('K1') && !month.includes('P1') && !month.includes('K2'), month.join());
  assert.ok(year.includes('P1') && year.includes('K2') && year.includes('Sa'), year.join());
});

test('high and low waters: semidiurnal spacing and heights', () => {
  const cons = [{ name: 'M2', H: 1, G: 0 }];
  const t0 = Date.UTC(2026, 9, 1);
  const e = T.extremes(cons, 0, t0, t0 + 3 * 86400000, 10);
  assert.ok(e.length >= 11 && e.length <= 13, 'count ' + e.length);
  for (let i = 1; i < e.length; i++) {
    assert.notStrictEqual(e[i].type, e[i - 1].type);
    const dt = (e[i].t - e[i - 1].t) / 3600000;
    assert.ok(Math.abs(dt - 6.21) < 0.02, 'interval ' + dt);
  }
  for (const x of e) assert.ok(Math.abs(Math.abs(x.h) - T.args(['M2'], x.t)[0].f) < 0.002);
});

test('levels: LAT below MLWS, HAT above MHWS, spring/neap approximations', () => {
  const cons = [{ name: 'M2', H: 1.2, G: 0 }, { name: 'S2', H: 0.4, G: 30 }, { name: 'K1', H: 0.1, G: 0 }, { name: 'O1', H: 0.08, G: 0 }];
  const L = T.levels(cons, 2, Date.UTC(2020, 0, 1));
  assert.ok(Math.abs(L.MHWS - 3.6) < 1e-9 && Math.abs(L.MLWN - 1.2) < 1e-9);
  assert.ok(L.LAT < L.MLWS && L.LAT > 2 - 1.2 * 1.04 - 0.4 - 0.12 - 0.1, 'LAT ' + L.LAT);
  assert.ok(L.HAT > L.MHWS);
});

test('Admiralty method: time and height interpolation (worked example)', () => {
  const hw = [['0000', -10], ['0600', 20]];
  const at = (h, m) => Date.UTC(2026, 9, 1, h, m);
  assert.strictEqual(T.timeDiff(hw, at(0, 0)), -10);
  assert.strictEqual(T.timeDiff(hw, at(3, 0)), 5);          // halfway 0000->0600
  assert.strictEqual(T.timeDiff(hw, at(6, 0)), 20);
  assert.strictEqual(T.timeDiff(hw, at(9, 0)), 5);          // halfway 0600->1200 (=0000)
  assert.strictEqual(T.timeDiff(hw, at(15, 0)), 5);         // 1500 = 0300 on the 12-hour cycle
  assert.ok(Math.abs(T.heightDiff(4.0, 3.0, -0.4, -0.2, 3.5) - -0.3) < 1e-12);
  assert.ok(Math.abs(T.heightDiff(4.0, 3.0, -0.4, -0.2, 4.5) - -0.5) < 1e-12);   // extrapolated beyond springs
  const sec = { hwTimes: hw, lwTimes: [['0000', 0], ['0600', -30]], std: { MHWS: 4.0, MHWN: 3.0, MLWN: 1.4, MLWS: 0.5 }, diff: { MHWS: -0.4, MHWN: -0.2, MLWN: 0.1, MLWS: 0.0 } };
  const out = T.secondaryExtremes([{ t: at(3, 0), h: 3.5, type: 'HW' }, { t: at(9, 15), h: 0.95, type: 'LW' }], sec);
  assert.strictEqual(out[0].t, at(3, 5)); assert.ok(Math.abs(out[0].h - 3.2) < 1e-9);
  assert.ok(Math.abs(out[1].dt - -13.75) < 1e-9, 'LW dt ' + out[1].dt);    // 0915: 3h15 into the 6 h from 0600 (-30) to 1200 = 0000 (0): -30 + 30 * 3.25/6
  assert.ok(Math.abs(out[1].h - (0.95 + 0.05)) < 1e-9, 'LW h ' + out[1].h);
});

test('secondary curve passes through the secondary turning points', () => {
  const cons = [{ name: 'M2', H: 1, G: 0 }], t0 = Date.UTC(2026, 9, 1);
  const ext = T.extremes(cons, 2, t0, t0 + 86400000, 10), ts = [];
  for (let t = t0; t <= t0 + 86400000; t += 300000) ts.push(t);
  const hs = T.predict(cons, 2, ts);
  const sec = T.secondaryExtremes(ext, { hwTimes: [['0000', 30], ['0600', 30]], lwTimes: [['0000', 20], ['0600', 20]], std: { MHWS: 3, MHWN: 2.9, MLWN: 1.1, MLWS: 1 }, diff: { MHWS: 0.5, MHWN: 0.5, MLWN: -0.2, MLWS: -0.2 } });
  const curve = T.secondaryCurve(ts, hs, ext, sec);
  const max = curve.reduce((m, p) => Math.max(m, p.h), -9), min = curve.reduce((m, p) => Math.min(m, p.h), 9);
  assert.ok(Math.abs(max - (sec.find(e => e.type === 'HW').h)) < 0.01, 'max ' + max);
  assert.ok(Math.abs(min - (sec.find(e => e.type === 'LW').h)) < 0.01, 'min ' + min);
});
