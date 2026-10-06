'use strict';
// Run:  node --test        (Node 20+, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, scanHistory, DEFAULT_RULES } = require('./hor-engine.js');

const MIN = 60000, H = 60 * MIN;
const T0 = Date.UTC(2026, 0, 1);                       // reference origin (minute-aligned)
const at = m => new Date(T0 + m * MIN).toISOString();  // minutes since origin -> ISO
let seq = 0;
const E = (type, s, e) => ({ id: 'e' + (seq++), type, start: at(s), end: e == null ? null : at(e) });
const R = (s, e) => E('rest', s, e), W = (s, e) => E('work', s, e);
const ev = (entries, asOfMin, extra) => evaluate(entries, Object.assign({ asOf: at(asOfMin) }, extra || {}));
const hh = x => x * 60;
const codes = r => r.dataQuality.issues.map(i => i.code).sort();

/* Build a fully-recorded day-pattern ending at minute `end`: list of [type, hours] from the past forward. */
function pattern(end, parts) {
  const total = parts.reduce((a, p) => a + p[1], 0) * 60;
  let t = end - total; const out = [];
  for (const [type, h] of parts) { out.push(E(type, t, t + h * 60)); t += h * 60; }
  return out;
}
const END = hh(24 * 20);   // evaluation instant used in many tests: day 20

/* ============================================================ 1. boundaries: 24 h total */
test('24h: exactly 10h rest in one block passes, 9h59m fails (fully recorded)', () => {
  const ok = ev(pattern(END, [['work', 14], ['rest', 10]]), END);
  assert.equal(ok.rest24.total, 'compliant');
  assert.equal(ok.rest24.verdict, 'compliant');
  const bad2 = ev([W(END - 24 * 60, END - 599), R(END - 599, END)], END);
  assert.equal(bad2.rest24.worstCaseRestMinutes, 599);
  assert.equal(bad2.rest24.total, 'breach');
  assert.equal(bad2.rest24.verdict, 'breach');
});

test('24h: 10h rest total but only 5h+5h is a structure breach (no 6h block)', () => {
  const r = ev(pattern(END, [['rest', 5], ['work', 9], ['rest', 5], ['work', 5]]), END);
  assert.equal(r.rest24.total, 'compliant');
  assert.equal(r.rest24.structure, 'breach');
  assert.equal(r.rest24.verdict, 'breach');
});

test('24h: 6h + 4h split passes; 6h + 3h59m fails; 7h + 3h passes', () => {
  assert.equal(ev(pattern(END, [['rest', 6], ['work', 8], ['rest', 4], ['work', 6]]), END).rest24.verdict, 'compliant');
  const S = END - 1440;
  assert.equal(ev([R(S, S + 360), W(S + 360, END - 239), R(END - 239, END)], END).rest24.verdict, 'breach');
  assert.equal(ev(pattern(END, [['rest', 7], ['work', 7], ['rest', 3], ['work', 7]]), END).rest24.verdict, 'compliant');
});

test('24h split policy: 8h + 1h + 1h = 10h total but best-two credit is 9h -> breach; strict-count also breach', () => {
  const es = pattern(END, [['rest', 8], ['work', 4], ['rest', 1], ['work', 4], ['rest', 1], ['work', 6]]);
  assert.equal(ev(es, END).rest24.verdict, 'breach');
  assert.equal(ev(es, END, { rules: { splitPolicy: 'strict-count' } }).rest24.verdict, 'breach');
});

test('24h split policy difference: 9h + 0.5h + 0.5h: strict-count fails (3 periods), best-two fails (9.5h)', () => {
  const es = pattern(END, [['rest', 9], ['work', 5], ['rest', 0.5], ['work', 4], ['rest', 0.5], ['work', 5]]);
  assert.equal(ev(es, END).rest24.verdict, 'breach');
  assert.equal(ev(es, END, { rules: { splitPolicy: 'strict-count' } }).rest24.verdict, 'breach');
});

test('24h split policy difference: 10h + 0.25h + 0.25h: best-two passes, strict-count fails', () => {
  const es = pattern(END, [['rest', 10], ['work', 6], ['rest', 0.25], ['work', 3], ['rest', 0.25], ['work', 4.5]]);
  assert.equal(ev(es, END).rest24.verdict, 'compliant');
  assert.equal(ev(es, END, { rules: { splitPolicy: 'strict-count' } }).rest24.verdict, 'breach');
});

/* ============================================================ 2. boundaries: 7 day */
test('7d: exactly 77h passes, 76h59m fails', () => {
  const week = 7 * 1440, need = 77 * 60;
  const mk = restMin => [W(END - week, END - restMin), R(END - restMin, END)];
  assert.equal(ev(mk(need), END).rest7d.verdict, 'compliant');
  assert.equal(ev(mk(need - 1), END).rest7d.verdict, 'breach');
});

test('7d: rolling window is exact at the edge (rest just outside the window does not count)', () => {
  const week = 7 * 1440;
  const es = [R(END - week - 120, END - week + 60), W(END - week + 60, END)];
  assert.equal(ev(es, END).rest7d.worstCaseRestMinutes, 60);
});

/* ============================================================ 3. 14 h interval */
test('interval: 14h work is allowed, 14h01m is a breach', () => {
  const mk = w => [R(END - w - 600, END - w), W(END - w, END)];
  assert.equal(ev(mk(840), END).interval.verdict, 'compliant');
  assert.equal(ev(mk(841), END).interval.verdict, 'breach');
});

test('interval: work run crossing midnight is measured in elapsed time', () => {
  const es = [R(0, 600), W(600, 600 + 15 * 60), R(600 + 15 * 60, 600 + 25 * 60)];
  const h = scanHistory(es, { asOf: at(600 + 25 * 60), historyDays: 30 });
  assert.equal(h.interval.length, 1);
  assert.equal(h.interval[0].minutes, 900);
  assert.equal(h.interval[0].verdict, 'breach');
});

test('interval: a 5-minute rest breaks the run when minRestPeriodMinutes=0, not when 60', () => {
  const es = [R(0, 600), W(600, 600 + 600), R(1200, 1205), W(1205, 1205 + 600), R(1805, 1805 + 600)];
  const asOf = 1805 + 600;
  assert.equal(scanHistory(es, { asOf: at(asOf) }).interval.length, 0);
  const strict = scanHistory(es, { asOf: at(asOf), rules: { minRestPeriodMinutes: 60 } });
  assert.equal(strict.interval.length, 1);
  assert.equal(strict.interval[0].minutes, 1205 - 600 + 600);
});

test('interval: ongoing run is reported with remaining time', () => {
  const es = [R(END - 600 - 300, END - 300), W(END - 300, null)];
  const r = ev(es, END);
  assert.equal(r.interval.currentRunMinutes, 300);
  assert.equal(r.interval.remainingMinutes, 540);
  assert.equal(r.current.state, 'work');
});

/* ============================================================ 4. data hygiene */
test('overlap, same type: merged, not double counted', () => {
  const r = ev([W(END - 1440, END - 360), R(END - 360, END), R(END - 360, END)], END);
  assert.equal(r.rest24.worstCaseRestMinutes, 360);
  assert.deepEqual(codes(r).filter(c => c !== 'OVERLAP_SAME' && c !== 'DUPLICATE'), []);
  assert.ok(codes(r).includes('DUPLICATE'));
});

test('the old engine counted two identical 6h rests as 12h; this one counts 6h', () => {
  const r = ev([R(END - 360, END), R(END - 360, END)], END);
  assert.equal(r.rest24.loggedRestMinutes, 360);
});

test('overlap, different type: conflict span is UNKNOWN, flagged as an error', () => {
  const r = ev([W(END - 1440, END), R(END - 600, END - 100)], END);
  assert.ok(codes(r).includes('OVERLAP_CONFLICT'));
  assert.equal(r.dataQuality.level, 'errors');
  assert.equal(r.rest24.unknownMinutes, 500);
  assert.equal(r.rest24.worstCaseRestMinutes, 0);
  assert.equal(r.rest24.bestCaseRestMinutes, 500);
});

test('adjacent entries leave no gap', () => {
  const r = ev([W(END - 1440, END - 600), R(END - 600, END)], END);
  assert.equal(r.rest24.unknownMinutes, 0);
});

test('input order does not matter; inputs are not mutated', () => {
  const es = pattern(END, [['work', 14], ['rest', 10]]);
  const frozen = es.map(e => Object.freeze(Object.assign({}, e)));
  Object.freeze(frozen);
  const a = ev(frozen, END);
  const b = ev([...frozen].reverse(), END);
  assert.deepEqual(a.rest24, b.rest24);
  assert.equal(a.overall, b.overall);
});

test('invalid entries are excluded with errors, never thrown', () => {
  const es = [
    { id: 'a', type: 'rest', start: 'not a date', end: at(10) },
    { id: 'b', type: 'sleep', start: at(0), end: at(10) },
    { id: 'c', type: 'rest', start: at(20), end: at(10) },
    { id: 'd', type: 'rest', start: '2026-01-01T10:00:00', end: '2026-01-01T11:00:00' },
    null,
    { id: 'z', type: 'work', start: at(30), end: at(30) },
  ];
  const r = ev(es, 100);
  assert.deepEqual(codes(r), ['AMBIGUOUS_TIME_ZONE', 'END_NOT_AFTER_START', 'INVALID_ENTRY', 'INVALID_TIME', 'UNKNOWN_TYPE', 'ZERO_LENGTH']);
  assert.equal(r.current.state, 'none');
});

test('local-time strings without a zone are rejected (ambiguous around daylight-saving)', () => {
  const r = ev([{ id: 'x', type: 'work', start: '2026-10-25T01:30:00', end: '2026-10-25T02:30:00' }], 400000);
  assert.ok(codes(r).includes('AMBIGUOUS_TIME_ZONE'));
});

test('multiple open entries are an error', () => {
  const r = ev([W(END - 100, null), W(END - 50, null)], END);
  assert.ok(codes(r).includes('MULTIPLE_OPEN'));
});

test('future entries are ignored; entries ending in the future are clipped', () => {
  const r = ev([W(END - 100, END + 500), R(END + 10, END + 20)], END);
  assert.ok(codes(r).includes('END_IN_FUTURE'));
  assert.ok(codes(r).includes('FUTURE_ENTRY'));
  assert.equal(r.current.state, 'work');
  assert.equal(r.rest24.loggedWorkMinutes, 100);
});

test('entry ending within clock-skew tolerance is a warning, not an error', () => {
  const r = evaluate([{ id: 'a', type: 'work', start: at(0), end: at(61) }], { asOf: at(60) + '' });
  assert.equal(r.dataQuality.issues.find(i => i.code === 'END_IN_FUTURE').severity, 'warn');
});

/* ============================================================ 5. unknown time */
test('6h rest with 18h unlogged is INDETERMINATE (not a breach)', () => {
  const r = ev([R(END - 1440 - 5000, END - 1440 - 4000), R(END - 360, END)], END);
  assert.equal(r.rest24.verdict, 'indeterminate');
  assert.equal(r.rest24.unknownMinutes, 1080);
});

test('definite breach even if every unknown minute were rest', () => {
  const S = END - 1440;
  const es = [W(S, S + 900), R(S + 900, S + 1140), W(S + 1380, END)];   // 240 min unlogged between
  const r = ev(es, END);
  assert.equal(r.rest24.unknownMinutes, 240);
  assert.equal(r.rest24.bestCaseRestMinutes, 480);
  assert.equal(r.rest24.verdict, 'breach');
});

test('record shorter than the window is INDETERMINATE for that window', () => {
  const r = ev([R(END - 300, END)], END);
  assert.equal(r.rest24.verdict, 'indeterminate');
  assert.equal(r.rest7d.verdict, 'indeterminate');
  assert.deepEqual(r.budget.insufficientRecord, ['rest24', 'rest7d']);
});

test('no entries at all: nothing is claimed', () => {
  const r = ev([], END);
  assert.equal(r.overall, 'indeterminate');
  assert.equal(r.current.state, 'none');
  assert.equal(r.recordStart, null);
});

/* ============================================================ 6. history */
test('a breach 30h ago is reported historically even though NOW is compliant', () => {
  const asOf = END;
  const es = [
    W(asOf - hh(70), asOf - hh(52)),
    R(asOf - hh(52), asOf - hh(50)),
    W(asOf - hh(50), asOf - hh(31)),
    R(asOf - hh(31), asOf),
  ];
  const now = ev(es, asOf);
  assert.equal(now.rest24.verdict, 'compliant');
  const h = scanHistory(es, { asOf: at(asOf), historyDays: 30 });
  assert.ok(h.rest24.length >= 1, 'historical 24h breach must be listed');
  assert.ok(h.rest24.some(x => x.verdict === 'breach'));
});

test('history episodes are merged, not one row per minute', () => {
  const es = [W(0, hh(50)), R(hh(50), hh(70))];
  const h = scanHistory(es, { asOf: at(hh(70)) });
  assert.ok(h.rest24.length <= 2);
});

test('history lookback limits what is reported', () => {
  const es = [W(0, hh(50)), R(hh(50), hh(70)), W(hh(70), hh(80)), R(hh(80), hh(24 * 40))];
  const all = scanHistory(es, { asOf: at(hh(24 * 40)), historyDays: 365 });
  const recent = scanHistory(es, { asOf: at(hh(24 * 40)), historyDays: 5 });
  assert.ok(all.rest24.length > 0);
  assert.equal(recent.rest24.length, 0);
});

/* ============================================================ 7. time zones / DST */
test('UK clocks go back 2026-10-25: elapsed time uses real instants, offsets are honoured', () => {
  // 00:30Z -> 08:30Z is 8h real time, whatever the wall clock says
  const es = [
    { id: 'a', type: 'work', start: '2026-10-25T01:30:00+01:00', end: '2026-10-25T08:30:00+00:00' },
    { id: 'b', type: 'rest', start: '2026-10-25T08:30:00Z', end: '2026-10-25T18:30:00Z' },
  ];
  const r = evaluate(es, { asOf: '2026-10-25T18:30:00Z' });
  assert.equal(r.rest24.loggedWorkMinutes, 8 * 60);
  assert.equal(r.rest24.loggedRestMinutes, 600);
  const r2 = evaluate(es, { asOf: '2026-10-25T19:30:00+01:00'.replace('19:30', '18:30') });
  assert.equal(r2.asOf, '2026-10-25T17:30:00.000Z');
});

test('equivalent instants in different zones give identical results', () => {
  const a = [{ id: '1', type: 'work', start: '2026-03-29T00:30:00Z', end: '2026-03-29T10:00:00Z' }, { id: '2', type: 'rest', start: '2026-03-29T10:00:00Z', end: '2026-03-29T20:30:00Z' }];
  const b = [{ id: '1', type: 'work', start: '2026-03-29T00:30:00+00:00', end: '2026-03-29T12:00:00+02:00' }, { id: '2', type: 'rest', start: '2026-03-29T12:00:00+02:00', end: '2026-03-29T22:30:00+02:00' }];
  const ra = evaluate(a, { asOf: '2026-03-29T20:30:00Z' }), rb = evaluate(b, { asOf: '2026-03-29T22:30:00+02:00' });
  assert.deepEqual(ra.rest24, rb.rest24);
  assert.deepEqual(ra.interval, rb.interval);
});

/* ============================================================ 8. min counted rest period, config */
test('minRestPeriodMinutes reclassifies short rests as work for totals and split', () => {
  const es = [W(END - 1440, END - 700), R(END - 700, END - 640), W(END - 640, END - 600), R(END - 600, END)];
  assert.equal(ev(es, END).rest24.worstCaseRestMinutes, 660);
  assert.equal(ev(es, END, { rules: { minRestPeriodMinutes: 120 } }).rest24.worstCaseRestMinutes, 600);
});

test('rules are read from options; defaults are frozen', () => {
  assert.ok(Object.isFrozen(DEFAULT_RULES));
  const r = ev(pattern(END, [['work', 14], ['rest', 10]]), END, { rules: { minRest24Minutes: 660 } });
  assert.equal(r.rest24.verdict, 'breach');
});

test('output is plain JSON', () => {
  const r = ev(pattern(END, [['work', 14], ['rest', 10]]), END, { history: true });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

/* ============================================================ 9. brute-force reference + fuzz */
// Independent, deliberately naive minute-by-minute model. Shares no code with the engine.
function refModel(entries, asOf, fromOpt) {
  const items = entries.map(e => ({ type: e.type, s: Math.round((Date.parse(e.start) - T0) / MIN), e: e.end == null ? asOf : Math.round((Date.parse(e.end) - T0) / MIN) })).filter(i => i.e > i.s && i.s < asOf).map(i => ({ ...i, e: Math.min(i.e, asOf) }));
  const from = fromOpt != null ? fromOpt : Math.min(...items.map(i => i.s));
  const n = asOf - from;
  const st = new Uint8Array(n);                       // 0 gap 1 rest 2 work 3 conflict
  for (const i of items) for (let m = Math.max(i.s, from); m < i.e; m++) { const k = i.type === 'rest' ? 1 : 2; const c = st[m - from]; st[m - from] = c === 0 || c === k ? k : 3; }
  const known = mode => Array.from(st, v => v === 1 || (mode === 'O' && (v === 0 || v === 3)));
  const KP = known('P'), KO = known('O');
  const cum = K => { const c = new Int32Array(K.length + 1); K.forEach((x, i) => { c[i + 1] = c[i] + (x ? 1 : 0); }); return c; };
  const cumP = cum(KP), cumO = cum(KO);
  const win = (K, a, b, pre) => { const out = []; for (let m = a; m < b; m++) out.push(m < from ? pre : K[m - from]); return out; };
  const periods = bits => { const p = []; let run = 0; for (const x of bits) { if (x) run++; else { if (run) p.push(run); run = 0; } } if (run) p.push(run); return p.sort((x, y) => y - x); };
  const ok24 = bits => { const p = periods(bits); const tot = bits.filter(Boolean).length; const best = (p[0] || 0) + (p[1] || 0); return { total: tot >= 600, structure: best >= 600 && (p[0] || 0) >= 360, tot }; };
  const v = (p, o) => (p ? 'compliant' : o ? 'indeterminate' : 'breach');
  return {
    at24(t) { const P = ok24(win(KP, t - 1440, t, false)), O = ok24(win(KO, t - 1440, t, true)); return { verdict: v(P.total && P.structure, O.total && O.structure), total: v(P.total, O.total), structure: v(P.structure, O.structure), worst: P.tot, best: O.tot }; },
    at7(t) { const cnt = (cum, a, b) => { const lo = Math.max(a, from); return cum[b - from] - cum[lo - from]; }; const P = cnt(cumP, t - 10080, t), O = cnt(cumO, t - 10080, t) + Math.max(0, Math.min(t, from) - (t - 10080)); return { verdict: v(P >= 4620, O >= 4620), worst: P, best: O }; },
    from, asOf,
    intervals() { const runs = K => { const r = []; let s = null; K.forEach((x, i) => { if (!x && s == null) s = i; if ((x || i === K.length - 1) && s != null) { const e = x ? i : i + 1; r.push([from + s, from + e]); s = null; } }); return r; }; const O = runs(KO).filter(r => r[1] - r[0] > 840); return runs(KP).filter(r => r[1] - r[0] > 840).map(r => ({ from: r[0], to: r[1], verdict: O.some(o => o[0] < r[1] && o[1] > r[0]) ? 'breach' : 'indeterminate' })); },
    failing24(t0) { const out = []; for (let t = t0; t <= asOf; t++) { const x = this.at24(t); if (x.verdict !== 'compliant') out.push([t, x.verdict]); } return out; },
    failing7(t0) { const out = []; for (let t = t0; t <= asOf; t++) { const x = this.at7(t); if (x.verdict !== 'compliant') out.push([t, x.verdict]); } return out; },
  };
}

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function randomCase(r, days, restProb) {
  restProb = restProb == null ? 0.5 : restProb;
  const entries = []; let t = Math.floor(r() * 5000);
  const endLimit = t + days * 1440;
  while (t < endLimit) {
    if (r() < 0.35) t += Math.floor(r() * 360);                       // unlogged gap
    const type = r() < restProb ? 'rest' : 'work';
    const len = 20 + Math.floor(r() * (type === 'rest' ? 700 : 1000));
    entries.push(E(type, t, t + len));
    if (r() < 0.08) entries.push(E(r() < 0.5 ? 'rest' : 'work', t + Math.floor(len / 3), t + Math.floor(len / 3) + 30 + Math.floor(r() * 300))); // overlap
    if (r() < 0.04) entries.push({ ...entries[entries.length - 1], id: 'dup' + seq++ });                                                         // duplicate
    t += len;
  }
  for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [entries[i], entries[j]] = [entries[j], entries[i]]; }
  return { entries, start: Math.min(...entries.map(e => Math.round((Date.parse(e.start) - T0) / MIN))), end: t };
}

test('FUZZ: evaluate() agrees with the brute-force reference (24h + 7d, worst/best case, verdicts)', () => {
  const r = rng(12345);
  let n = 0;
  for (let k = 0; k < 400; k++) {
    const c = randomCase(r, 3 + Math.floor(r() * 12));
    const asOf = c.start + Math.floor(r() * (c.end - c.start + 120));
    if (asOf <= c.start + 1) continue;
    const ref = refModel(c.entries, asOf), got = ev(c.entries, asOf);
    const a = ref.at24(asOf), b = ref.at7(asOf);
    assert.equal(got.rest24.verdict, a.verdict, 'rest24 verdict case ' + k);
    assert.equal(got.rest24.total, a.total, 'rest24 total case ' + k);
    assert.equal(got.rest24.structure, a.structure, 'rest24 structure case ' + k);
    assert.equal(got.rest24.worstCaseRestMinutes, a.worst, 'worst case ' + k);
    assert.equal(got.rest24.bestCaseRestMinutes, a.best, 'best case ' + k);
    assert.equal(got.rest7d.verdict, b.verdict, 'rest7d verdict case ' + k);
    assert.equal(got.rest7d.worstCaseRestMinutes, b.worst, 'rest7d worst ' + k);
    assert.equal(got.rest7d.bestCaseRestMinutes, b.best, 'rest7d best ' + k);
    n++;
  }
  assert.ok(n > 300);
});

test('FUZZ: history scan matches brute force minute by minute (24h episodes and interval breaches)', () => {
  const r = rng(777);
  let n = 0;
  for (let k = 0; k < 14; k++) {
    const c = randomCase(r, 3 + Math.floor(r() * 3));
    const asOf = c.end;
    const ref = refModel(c.entries, asOf);
    const t0 = ref.from + 1440;
    if (t0 > asOf) continue;
    const want = ref.failing24(t0);
    const h = scanHistory(c.entries, { asOf: at(asOf), historyDays: 365 });
    // expand engine episodes back to minutes and compare as sets
    const gotMin = new Map();
    for (const e of h.rest24) {
      const a = Math.round((Date.parse(e.windowEndFrom) - T0) / MIN), b = Math.round((Date.parse(e.windowEndTo) - T0) / MIN);
      for (let t = a; t <= b; t++) gotMin.set(t, e.verdict);
    }
    assert.deepEqual([...gotMin.keys()].sort((x, y) => x - y), want.map(x => x[0]), 'failing minutes case ' + k);
    // an episode is a breach iff any of its minutes is a definite breach
    for (const e of h.rest24) {
      const a = Math.round((Date.parse(e.windowEndFrom) - T0) / MIN), b = Math.round((Date.parse(e.windowEndTo) - T0) / MIN);
      const anyBreach = want.some(x => x[0] >= a && x[0] <= b && x[1] === 'breach');
      assert.equal(e.verdict, anyBreach ? 'breach' : 'indeterminate', 'episode verdict case ' + k);
    }
    const wi = ref.intervals();
    assert.equal(h.interval.length, wi.length, 'interval count case ' + k);
    h.interval.forEach((x, i) => {
      assert.equal(Math.round((Date.parse(x.from) - T0) / MIN), wi[i].from);
      assert.equal(Math.round((Date.parse(x.to) - T0) / MIN), wi[i].to);
      assert.equal(x.verdict, wi[i].verdict);
    });
    n++;
  }
  assert.ok(n >= 8);
});

test('FUZZ: 7d history scan matches brute force (breakpoints + millisecond edge refinement)', () => {
  const r = rng(4242);
  let n = 0, failingMinutes = 0, episodes = 0;
  for (let k = 0; k < 30; k++) {
    const c = randomCase(r, 11 + Math.floor(r() * 6), 0.40 + r() * 0.25);
    const asOf = c.end, ref = refModel(c.entries, asOf), t0 = ref.from + 10080;
    if (t0 > asOf) continue;
    const want = ref.failing7(t0).map(x => x[0]);
    const h = scanHistory(c.entries, { asOf: at(asOf), historyDays: 365 });
    const got = new Set();
    for (const e of h.rest7d) {
      const a = Math.ceil((Date.parse(e.windowEndFrom) - T0) / MIN), b = Math.floor((Date.parse(e.windowEndTo) - T0) / MIN);
      for (let t = a; t <= b; t++) got.add(t);
    }
    assert.deepEqual([...got].sort((x, y) => x - y), want, '7d failing minutes case ' + k);
    failingMinutes += want.length; episodes += h.rest7d.length; n++;
  }
  assert.ok(n >= 20);
  assert.ok(failingMinutes > 2000 && episodes >= 10, 'fuzz must actually exercise failures: ' + failingMinutes + ' min, ' + episodes + ' episodes');
});

test('interval history: exactly 14h is fine, 14h01m is a breach', () => {
  const mk = w => [R(0, 600), W(600, 600 + w), R(600 + w, 600 + w + 600)];
  assert.equal(scanHistory(mk(840), { asOf: at(600 + 840 + 600) }).interval.length, 0);
  assert.equal(scanHistory(mk(841), { asOf: at(600 + 841 + 600) }).interval.length, 1);
});

/* ============================================================ 10. metamorphic properties */
test('METAMORPHIC: shuffling, shifting in time, and splitting entries do not change verdicts', () => {
  const r = rng(99);
  for (let k = 0; k < 60; k++) {
    const c = randomCase(r, 5), asOf = c.end;
    const base = ev(c.entries, asOf);
    const shuffled = ev([...c.entries].reverse(), asOf);
    assert.deepEqual(shuffled.rest24, base.rest24);
    // shift every instant by 5h37m: identical results apart from timestamps
    const d = 337;
    const sh = c.entries.map(e => ({ ...e, start: at(Math.round((Date.parse(e.start) - T0) / MIN) + d), end: e.end && at(Math.round((Date.parse(e.end) - T0) / MIN) + d) }));
    const shifted = ev(sh, asOf + d);
    assert.equal(shifted.overall, base.overall);
    assert.equal(shifted.rest24.worstCaseRestMinutes, base.rest24.worstCaseRestMinutes);
    assert.equal(shifted.rest7d.worstCaseRestMinutes, base.rest7d.worstCaseRestMinutes);
    // split each entry in two adjacent halves
    const sp = [];
    c.entries.forEach(e => { const s = Math.round((Date.parse(e.start) - T0) / MIN), f = Math.round((Date.parse(e.end) - T0) / MIN), m = s + Math.floor((f - s) / 2); if (m > s && m < f) { sp.push({ ...e, id: e.id + 'a', end: at(m) }, { ...e, id: e.id + 'b', start: at(m) }); } else sp.push(e); });
    const split = ev(sp, asOf);
    assert.equal(split.rest24.verdict, base.rest24.verdict);
    assert.equal(split.rest24.worstCaseRestMinutes, base.rest24.worstCaseRestMinutes);
    assert.equal(split.rest7d.verdict, base.rest7d.verdict);
  }
});

test('METAMORPHIC: worst <= logged <= best, and adding a rest entry never lowers the best case', () => {
  const r = rng(31337);
  for (let k = 0; k < 150; k++) {
    const c = randomCase(r, 4), asOf = c.end;
    const a = ev(c.entries, asOf);
    assert.ok(a.rest24.worstCaseRestMinutes <= a.rest24.loggedRestMinutes + 1e-9);
    assert.ok(a.rest24.loggedRestMinutes <= a.rest24.bestCaseRestMinutes + 1e-9);
    // extra rest entry inside the last 24h: verdict must not get worse
    const s = asOf - 1 - Math.floor(r() * 1000), more = c.entries.concat([R(s - 200, s)]);
    const b = ev(more, asOf);
    assert.ok(b.rest24.bestCaseRestMinutes >= a.rest24.bestCaseRestMinutes - 1e-9);
  }
});

/* ============================================================ 11. work budget ties to evaluate() */
test('BUDGET: continuing to work for exactly `minutes` is compliant, one more minute is not', () => {
  const r = rng(2024);
  let checked = 0;
  for (let k = 0; k < 120; k++) {
    // fully recorded 8+ days, ending exactly at asOf, last entry random type
    const parts = []; let t = 0;
    while (t < 9 * 1440) { const type = r() < 0.5 ? 'rest' : 'work'; const len = 60 + Math.floor(r() * (type === 'rest' ? 600 : 800)); parts.push(E(type, t, t + len)); t += len; }
    const asOf = t, base = ev(parts, asOf);
    const b = base.budget.minutes;
    const keep = base.overall === 'compliant';
    const plus = m => ev(parts.concat([W(asOf, asOf + m)]), asOf + m);
    if (b > 0) {
      assert.equal(plus(b).overall, 'compliant', 'at budget, case ' + k);
      checked++;
    } else assert.notEqual(plus(0 + 1).overall === 'compliant' && keep, true, 'zero budget but still compliant, case ' + k);
    assert.notEqual(plus(b + 1).overall, 'compliant', 'one minute past budget must not be compliant, case ' + k);
  }
  assert.ok(checked > 20);
});

test('BUDGET: documented example', () => {
  // 10h rest from 16h to 6h ago, then 6h work: 24h window keeps the full rest for 8 more hours
  const es = [W(END - hh(30), END - hh(16)), R(END - hh(16), END - hh(6)), W(END - hh(6), null)];
  const r = ev(es, END);
  assert.equal(r.budget.byRule.rest24, 480);
  assert.equal(r.budget.byRule.interval, 480);
  assert.equal(r.budget.minutes, 480);
});

/* ============================================================ 12. scale */
test('SCALE: a year of entries evaluates fast; 30-day history scan completes', () => {
  const r = rng(5); const es = []; let t = 0;
  while (t < 365 * 1440) { const type = es.length % 2 ? 'rest' : 'work'; const len = 150 + Math.floor(r() * 300); es.push(E(type, t, t + len)); t += len; }
  let t0 = Date.now(); const rep = ev(es, t); const dEval = Date.now() - t0;
  t0 = Date.now(); const h = scanHistory(es, { asOf: at(t), historyDays: 30 }); const dScan = Date.now() - t0;
  assert.ok(rep.asOf);
  assert.ok(es.length > 1000);
  console.log('      scale: ' + es.length + ' entries, evaluate ' + dEval + ' ms, 30-day scan ' + dScan + ' ms');
  assert.ok(dEval < 500, 'evaluate took ' + dEval + ' ms');
  assert.ok(dScan < 5000, 'scan took ' + dScan + ' ms');
  assert.ok(h.historyDays === 30);
});
