// Crow's Nest - tide engine: harmonic analysis and prediction (pure, no I/O).
//
// Method: the standard harmonic method (Doodson; Schureman, "Manual of Harmonic Analysis and Prediction of Tides",
// US C&GS SP 98, 1958; the same convention as NOAA's published constants and the Admiralty's).
//   h(t) = Z0 + sum_i f_i(t) H_i cos( V_i(t) + u_i(t) - G_i )
// V = equilibrium argument (astronomical, from the Doodson numbers below), f/u = nodal corrections for the 18.6-year
// lunar cycle, H/G = amplitude and Greenwich phase lag of each constituent (from analysis of a gauge record).
// All times are UTC milliseconds. Heights are in metres, in whatever datum the analysed record used.
'use strict';

const D2R = Math.PI / 180;
const norm = d => ((d % 360) + 360) % 360;

// ---- astronomical arguments (degrees) at time t (ms, UTC). Polynomials from Meeus, "Astronomical Algorithms".
function astro(ms) {
  const jd = ms / 86400000 + 2440587.5, T = (jd - 2451545.0) / 36525;
  const s = 218.3164591 + 481267.88134236 * T - 0.0013268 * T * T + T * T * T / 538841;   // moon mean longitude
  const h = 280.46645 + 36000.76983 * T + 0.0003032 * T * T;                                 // sun mean longitude
  const p = 83.3532430 + 4069.0137111 * T - 0.0103238 * T * T - T * T * T / 80053;           // lunar perigee
  const N = 125.0445550 - 1934.1361849 * T + 0.0020762 * T * T + T * T * T / 467410;         // lunar ascending node
  const pp = 282.93734098 + 1.71945766667 * T + 0.00045688889 * T * T;                       // solar perigee
  const dayFrac = (((ms % 86400000) + 86400000) % 86400000) / 86400000;
  const Th = 180 + 360 * dayFrac;                                                            // hour angle of mean sun
  return { T: Th, s: norm(s), h: norm(h), p: norm(p), N: norm(N), pp: norm(pp) };
}

// ---- nodal parameters (Schureman): I, nu, xi, nu', 2nu'' and the L2 term R, from the node N.
function nodal(a) {
  const w = 23.4392911 * D2R, i = 5.145 * D2R;   // obliquity of the ecliptic, inclination of the moon's orbit
  let N = a.N; if (N > 180) N -= 360;
  const n = N * D2R;
  const I = Math.acos(Math.cos(w) * Math.cos(i) - Math.sin(w) * Math.sin(i) * Math.cos(n));
  const A = Math.atan(Math.cos((w - i) / 2) / Math.cos((w + i) / 2) * Math.tan(n / 2));   // (N - xi + nu)/2
  const B = Math.atan(Math.sin((w - i) / 2) / Math.sin((w + i) / 2) * Math.tan(n / 2));   // (N - xi - nu)/2
  const nu = A - B, xi = n - (A + B);
  const nup = Math.atan2(Math.sin(2 * I) * Math.sin(nu), Math.sin(2 * I) * Math.cos(nu) + 0.3347);
  const nupp2 = Math.atan2(Math.sin(I) ** 2 * Math.sin(2 * nu), Math.sin(I) ** 2 * Math.cos(2 * nu) + 0.0727);   // 2nu''
  const P = (a.p * D2R) - xi;
  const t2 = Math.tan(I / 2) ** 2;
  const R = Math.atan2(Math.sin(2 * P), 1 / (6 * t2) - Math.cos(2 * P));
  const Ra1 = Math.sqrt(1 - 12 * t2 * Math.cos(2 * P) + 36 * t2 * t2);   // 1/Ra
  return { I, nu, xi, nup, nupp2, R, Ra1 };
}
// nodal factor f and angle u (degrees) for each basic type
function fu(type, k) {
  const { I, nu, xi, nup, nupp2, R, Ra1 } = k, sI = Math.sin(I), c2 = Math.cos(I / 2), s2 = Math.sin(I / 2);
  switch (type) {
    case 'none': return [1, 0];
    case 'Mm': return [(2 / 3 - sI * sI) / 0.5021, 0];
    case 'Mf': return [sI * sI / 0.1578, -2 * xi / D2R];
    case 'O1': return [sI * c2 * c2 / 0.3800, (2 * xi - nu) / D2R];
    case 'J1': return [Math.sin(2 * I) / 0.7214, -nu / D2R];
    case 'OO1': return [sI * s2 * s2 / 0.0164, (-2 * xi - nu) / D2R];
    case 'M2': return [c2 ** 4 / 0.9154, (2 * xi - 2 * nu) / D2R];
    case 'K1': return [Math.sqrt(0.8965 * Math.sin(2 * I) ** 2 + 0.6001 * Math.sin(2 * I) * Math.cos(nu) + 0.1006), -nup / D2R];
    case 'K2': return [Math.sqrt(19.0444 * sI ** 4 + 2.7702 * sI * sI * Math.cos(2 * nu) + 0.0981), -nupp2 / D2R];
    case 'L2': return [c2 ** 4 / 0.9154 * Ra1, (2 * xi - 2 * nu - R) / D2R];
  }
  throw new Error('unknown nodal type ' + type);
}

// ---- constituents. d = Doodson-style coefficients on [T, s, h, p, pp, 90deg]; n = nodal type, or for compound
// (shallow-water) constituents c = [[name, multiplier], ...] whose V, f, u combine those of its parts.
const C = {};
function basic(name, d, n) { C[name] = { name, d, n }; }
function compound(name, c) { C[name] = { name, c }; }
basic('Z0', [0, 0, 0, 0, 0, 0], 'none');
// long period
basic('Sa', [0, 0, 1, 0, 0, 0], 'none');
basic('Ssa', [0, 0, 2, 0, 0, 0], 'none');
basic('Mm', [0, 1, 0, -1, 0, 0], 'Mm');
basic('MSf', [0, 2, -2, 0, 0, 0], 'M2inv');
basic('Mf', [0, 2, 0, 0, 0, 0], 'Mf');
// diurnal
basic('2Q1', [1, -4, 1, 2, 0, 1], 'O1');
basic('Q1', [1, -3, 1, 1, 0, 1], 'O1');
basic('rho1', [1, -3, 3, -1, 0, 1], 'O1');
basic('O1', [1, -2, 1, 0, 0, 1], 'O1');
basic('M1', [1, -1, 1, 1, 0, -1], 'O1');     // simplified nodal treatment (small constituent)
basic('P1', [1, 0, -1, 0, 0, 1], 'none');
basic('S1', [1, 0, 0, 0, 0, 0], 'none');
basic('K1', [1, 0, 1, 0, 0, -1], 'K1');
basic('J1', [1, 1, 1, -1, 0, -1], 'J1');
basic('OO1', [1, 2, 1, 0, 0, -1], 'OO1');
// semidiurnal
basic('2N2', [2, -4, 2, 2, 0, 0], 'M2');
basic('mu2', [2, -4, 4, 0, 0, 0], 'M2');
basic('N2', [2, -3, 2, 1, 0, 0], 'M2');
basic('nu2', [2, -3, 4, -1, 0, 0], 'M2');
basic('M2', [2, -2, 2, 0, 0, 0], 'M2');
basic('lambda2', [2, -1, 0, 1, 0, 2], 'M2');
basic('L2', [2, -1, 2, -1, 0, 2], 'L2');
basic('T2', [2, 0, -1, 0, 1, 0], 'none');
basic('S2', [2, 0, 0, 0, 0, 0], 'none');
basic('R2', [2, 0, 1, 0, -1, 2], 'none');
basic('K2', [2, 0, 2, 0, 0, 0], 'K2');
// terdiurnal and shallow water (compounds of the above)
compound('M3', [['M2', 1.5]]);
compound('MK3', [['M2', 1], ['K1', 1]]);
compound('2MK3', [['M2', 2], ['K1', -1]]);
compound('MN4', [['M2', 1], ['N2', 1]]);
compound('M4', [['M2', 2]]);
compound('MS4', [['M2', 1], ['S2', 1]]);
compound('S4', [['S2', 2]]);
compound('S6', [['S2', 3]]);
compound('MK4', [['M2', 1], ['K2', 1]]);
compound('SK4', [['S2', 1], ['K2', 1]]);
compound('2MN6', [['M2', 2], ['N2', 1]]);
compound('M6', [['M2', 3]]);
compound('2MS6', [['M2', 2], ['S2', 1]]);
compound('M8', [['M2', 4]]);
compound('2SM2', [['S2', 2], ['M2', -1]]);
compound('MSN2', [['M2', 1], ['S2', 1], ['N2', -1]]);

// angular speed in degrees per hour (from the Doodson coefficients and the rates of T, s, h, p, pp)
const RATES = [15, 0.5490165, 0.0410686, 0.0046418, 0.0000020];
function speedOf(name) {
  const c = C[name];
  if (c.c) return c.c.reduce((a, [n, m]) => a + m * speedOf(n), 0);
  return c.d.slice(0, 5).reduce((a, x, i) => a + x * RATES[i], 0);
}
function vOf(name, a) {   // equilibrium argument V (degrees)
  const c = C[name];
  if (c.c) return c.c.reduce((s, [n, m]) => s + m * vOf(n, a), 0);
  const d = c.d;
  return d[0] * a.T + d[1] * a.s + d[2] * a.h + d[3] * a.p + d[4] * a.pp + d[5] * 90;
}
function fuOf(name, k) {   // [f, u]
  const c = C[name];
  if (c.c) return c.c.reduce(([f, u], [n, m]) => { const [fn, un] = fuOf(n, k); return [f * Math.pow(fn, Math.abs(m)), u + m * un]; }, [1, 0]);
  if (c.n === 'M2inv') { const [f, u] = fu('M2', k); return [f, -u]; }
  return fu(c.n, k);
}
// V+u (degrees) and f for every requested constituent at time ms. Nodal terms change slowly: callers may pass
// a fixed nodal time (e.g. the middle of the period), as NOAA and the Admiralty do.
function args(names, ms, nodalMs) {
  const a = astro(ms), k = nodal(nodalMs == null ? a : astro(nodalMs));
  return names.map(n => { const [f, u] = fuOf(n, k); return { n, vu: vOf(n, a) + u, f }; });
}

// ---- prediction
// cons: [{ name, H, G }] (metres, degrees), z0: mean level. Returns height at each time in ms[].
function predict(cons, z0, times, opts) {
  opts = opts || {};
  const names = cons.map(c => c.name);
  const out = new Float64Array(times.length);
  // nodal factors: recompute once a day (they change ~0.1%/day at most)
  let nodalDay = null, nf = null;
  const a0 = astro(times[0] || 0);
  for (let j = 0; j < times.length; j++) {
    const t = times[j], day = Math.floor(t / 86400000);
    if (day !== nodalDay) { nodalDay = day; const k = nodal(astro(day * 86400000 + 43200000)); nf = names.map(n => fuOf(n, k)); }
    const a = astro(t);
    let h = z0;
    for (let i = 0; i < cons.length; i++) {
      const c = cons[i];
      h += nf[i][0] * c.H * Math.cos((vOf(c.name, a) + nf[i][1] - c.G) * D2R);
    }
    out[j] = h;
  }
  return out;
}

// High and low waters between t0 and t1: step through at `stepMin`, then refine each turning point to ~10 s.
function extremes(cons, z0, t0, t1, stepMin) {
  const step = (stepMin || 10) * 60000, ts = [];
  for (let t = t0 - step; t <= t1 + step; t += step) ts.push(t);
  const h = predict(cons, z0, ts);
  const at = t => predict(cons, z0, [t])[0];
  const out = [];
  for (let i = 1; i < ts.length - 1; i++) {
    const up = h[i] >= h[i - 1], down = h[i] >= h[i + 1];
    const isHigh = h[i] > h[i - 1] && h[i] >= h[i + 1], isLow = h[i] < h[i - 1] && h[i] <= h[i + 1];
    if (!isHigh && !isLow) continue;
    // golden-section search on [t-step, t+step]
    let a = ts[i - 1], b = ts[i + 1], g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a), d = a + g * (b - a), fc = at(c), fd = at(d);
    while (b - a > 10000) {
      if (isHigh ? fc > fd : fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = at(c); }
      else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = at(d); }
    }
    const t = Math.round((a + b) / 2);
    if (t >= t0 && t <= t1) out.push({ t, h: at(t), type: isHigh ? 'HW' : 'LW' });
    void up; void down;
  }
  // drop tiny wiggles (double tides / stand of the tide): keep alternating HW/LW, the stronger of two in a row
  const clean = [];
  for (const e of out) {
    const last = clean[clean.length - 1];
    if (last && last.type === e.type) { if (e.type === 'HW' ? e.h > last.h : e.h < last.h) clean[clean.length - 1] = e; continue; }
    clean.push(e);
  }
  return clean;
}

// ---- harmonic analysis (least squares). obs: [{ t: ms, h: metres }]. Returns { z0, cons: [{name,H,G,speed}], rms, n, days }.
// Constituents are chosen by the Rayleigh criterion for the record length (two constituents need
// |speed difference| * duration >= 360 deg to be separated), in order of importance. Gross outliers (bad readings)
// are removed in two passes at 5 sigma; storm surges remain in the residual.
const PRIORITY = ['M2', 'S2', 'K1', 'O1', 'N2', 'M4', 'MS4', 'K2', 'P1', 'Q1', 'L2', 'nu2', 'mu2', '2N2', 'MN4', 'M6', '2MS6',
  'MK3', 'M3', 'J1', 'OO1', 'T2', 'lambda2', '2SM2', 'S4', 'M8', '2MN6', 'MSN2', '2MK3', 'rho1', '2Q1', 'Mm', 'Mf', 'MSf', 'Ssa', 'Sa', 'M1', 'S1', 'R2'];
function chooseConstituents(hours, rayleigh) {
  const r = rayleigh == null ? 1 : rayleigh, picked = [];
  for (const n of PRIORITY) {
    const sp = speedOf(n);
    if (sp * hours < 360 * r && sp > 0) continue;   // period longer than the record
    if (picked.every(m => Math.abs(speedOf(m) - sp) * hours >= 360 * r)) picked.push(n);
  }
  return picked;
}
function solve(M, v) {   // Gaussian elimination with partial pivoting (M is n x n, symmetric positive)
  const n = v.length, A = M.map((r, i) => r.concat([v[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const piv = A[c][c]; if (Math.abs(piv) < 1e-12) throw new Error('analysis is singular (record too short or gappy)');
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = A[r][c] / piv; if (f) for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((r, i) => r[n] / r[i]);
}
function analyse(obs, opts) {
  opts = opts || {};
  obs = obs.filter(o => Number.isFinite(o.h) && Number.isFinite(o.t)).sort((a, b) => a.t - b.t);
  if (obs.length < 200) throw new Error('not enough observations');
  const t0 = obs[0].t, t1 = obs[obs.length - 1].t, hours = (t1 - t0) / 3600000;
  const names = opts.constituents || chooseConstituents(hours, opts.rayleigh);
  const mid = (t0 + t1) / 2, k = nodal(astro(mid));
  const fus = names.map(n => fuOf(n, k));
  let use = obs.map(() => true), z0 = 0, coef = null, rms = 0;
  for (let pass = 0; pass < 3; pass++) {
    const m = 1 + 2 * names.length, AtA = Array.from({ length: m }, () => new Float64Array(m)), Atb = new Float64Array(m);
    const row = new Float64Array(m);
    obs.forEach((o, j) => {
      if (!use[j]) return;
      const a = astro(o.t);
      row[0] = 1;
      for (let i = 0; i < names.length; i++) {
        const ang = (vOf(names[i], a) + fus[i][1]) * D2R;
        row[1 + 2 * i] = fus[i][0] * Math.cos(ang); row[2 + 2 * i] = fus[i][0] * Math.sin(ang);
      }
      for (let r = 0; r < m; r++) { Atb[r] += row[r] * o.h; const rr = row[r], ar = AtA[r]; for (let c = r; c < m; c++) ar[c] += rr * row[c]; }
    });
    for (let r = 0; r < m; r++) for (let c = 0; c < r; c++) AtA[r][c] = AtA[c][r];
    coef = solve(AtA.map(r => Array.from(r)), Array.from(Atb));
    z0 = coef[0];
    const cons = names.map((n, i) => ({ name: n, H: Math.hypot(coef[1 + 2 * i], coef[2 + 2 * i]), G: norm(Math.atan2(coef[2 + 2 * i], coef[1 + 2 * i]) / D2R) }));
    const pred = predict(cons, z0, obs.map(o => o.t));
    let ss = 0, n = 0; obs.forEach((o, j) => { if (use[j]) { ss += (o.h - pred[j]) ** 2; n++; } });
    rms = Math.sqrt(ss / n);
    if (pass < 2) use = obs.map((o, j) => Math.abs(o.h - pred[j]) <= 5 * rms);
  }
  const cons = names.map((n, i) => ({ name: n, H: Math.hypot(coef[1 + 2 * i], coef[2 + 2 * i]), G: norm(Math.atan2(coef[2 + 2 * i], coef[1 + 2 * i]) / D2R), speed: speedOf(n) }));
  return { z0, cons, rms, n: use.filter(Boolean).length, rejected: use.filter(x => !x).length, days: hours / 24, from: t0, to: t1 };
}

// ---- tidal levels from the constants. LAT/HAT: the lowest/highest predicted level over a full 18.6-year nodal
// cycle (hourly, then refined at the extremes) - the definition used for UK Chart Datum (LAT) since 2000s.
// MHWS etc.: the standard harmonic approximations (Z0 +/- (M2 +/- S2)).
function levels(cons, z0, fromMs) {
  const H = n => (cons.find(c => c.name === n) || { H: 0 }).H;
  const start = fromMs == null ? Date.UTC(2020, 0, 1) : fromMs, end = start + 18.61 * 365.25 * 86400000;
  let lo = Infinity, hi = -Infinity, tlo = 0, thi = 0;
  const step = 3600000, chunk = 24 * 30;
  for (let t = start; t < end; t += step * chunk) {
    const ts = []; for (let i = 0; i < chunk; i++) ts.push(t + i * step);
    const h = predict(cons, z0, ts);
    for (let i = 0; i < h.length; i++) { if (h[i] < lo) { lo = h[i]; tlo = ts[i]; } if (h[i] > hi) { hi = h[i]; thi = ts[i]; } }
  }
  // refine around the hourly extremes
  const near = t => extremes(cons, z0, t - 3 * 3600000, t + 3 * 3600000, 5);
  const L = near(tlo).filter(e => e.type === 'LW').reduce((m, e) => e.h < m ? e.h : m, lo);
  const Hh = near(thi).filter(e => e.type === 'HW').reduce((m, e) => e.h > m ? e.h : m, hi);
  return {
    LAT: L, HAT: Hh, MSL: z0,
    MHWS: z0 + H('M2') + H('S2'), MHWN: z0 + H('M2') - H('S2'), MLWN: z0 - H('M2') + H('S2'), MLWS: z0 - H('M2') - H('S2')
  };
}

// ---- Admiralty secondary port method (Admiralty Tide Tables, NP 120 "Admiralty Method").
// sec: { hwTimes: [[stdTimeHHMM, diffMin], [stdTimeHHMM, diffMin]], lwTimes: [...same...],
//        std: { MHWS, MHWN, MLWN, MLWS }  (the standard port's tabulated heights)
//        diff: { MHWS, MHWN, MLWN, MLWS }  (the secondary port's height differences, metres) }
// Time difference: linear interpolation by the time of the standard port HW (or LW) between the two tabulated
// times, cyclic over 12 hours (0000 = 1200, 0600 = 1800). Height difference: linear interpolation (and
// extrapolation) by the standard port's predicted height between its neap and spring values.
function hhmm(s) { const m = String(s).match(/^(\d{1,2}):?(\d{2})$/); if (!m) throw new Error('time must be HHMM'); return (+m[1] * 60 + +m[2]) % 720; }
function timeDiff(pairs, stdMs) {
  const m = (new Date(stdMs).getUTCHours() * 60 + new Date(stdMs).getUTCMinutes()) % 720;
  const [[a, da], [b, db]] = pairs.map(([t, d]) => [hhmm(t), +d]).sort((x, y) => x[0] - y[0]);
  // positions on the 12-hour circle: a -> b -> a+720
  let x = m < a ? m + 720 : m;
  if (x <= b) return da + (db - da) * (x - a) / (b - a);
  return db + (da - db) * (x - b) / (a + 720 - b);
}
function heightDiff(spring, neap, dSpring, dNeap, h) {
  if (Math.abs(spring - neap) < 1e-6) return (dSpring + dNeap) / 2;
  return dNeap + (dSpring - dNeap) * (h - neap) / (spring - neap);
}
function secondaryExtremes(stdExt, sec) {
  return stdExt.map(e => {
    const hw = e.type === 'HW';
    const dt = timeDiff(hw ? sec.hwTimes : sec.lwTimes, e.t);
    const dh = hw ? heightDiff(sec.std.MHWS, sec.std.MHWN, sec.diff.MHWS, sec.diff.MHWN, e.h)
      : heightDiff(sec.std.MLWS, sec.std.MLWN, sec.diff.MLWS, sec.diff.MLWN, e.h);
    return { t: Math.round(e.t + dt * 60000), h: e.h + dh, type: e.type, std: { t: e.t, h: e.h }, dt, dh };
  });
}
// The secondary port's curve: between each pair of standard-port turning points, map time and height linearly
// onto the secondary port's turning points (keeps the standard port's curve shape - the Admiralty assumption).
function secondaryCurve(stdTimes, stdHeights, stdExt, secExt) {
  const out = [];
  for (let k = 0; k < stdExt.length - 1; k++) {
    const A = stdExt[k], Bx = stdExt[k + 1], a = secExt[k], b = secExt[k + 1];
    for (let j = 0; j < stdTimes.length; j++) {
      const t = stdTimes[j]; if (t < A.t || t >= Bx.t) continue;
      const ft = (t - A.t) / (Bx.t - A.t), fh = (stdHeights[j] - A.h) / (Bx.h - A.h);
      out.push({ t: Math.round(a.t + ft * (b.t - a.t)), h: a.h + fh * (b.h - a.h) });
    }
  }
  return out;
}

module.exports = { astro, nodal, speedOf, args, predict, extremes, analyse, chooseConstituents, levels, secondaryExtremes, secondaryCurve, timeDiff, heightDiff, CONSTITUENTS: Object.keys(C).filter(n => n !== 'Z0') };
