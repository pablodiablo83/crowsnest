'use strict';
/*
 * Crow's Nest - Hours of Rest compliance engine (pure functions, no I/O, no dependencies).
 *
 * Input : entries [{ id, type: 'rest'|'work', start, end|null }]  (ISO-8601 WITH time zone, e.g. ...Z or ...+01:00)
 * Output: JSON-serialisable report. See SPEC.md for the rules, assumptions and open legal questions.
 *
 * Core idea: unlogged time (and self-contradicting time) is UNKNOWN, never silently rest or work.
 *   P timeline (pessimistic): unknown counts as work  -> if a rule passes here, it passes whatever happened.
 *   O timeline (optimistic) : unknown counts as rest  -> if a rule fails here, it fails whatever happened.
 *   verdict = 'compliant' if P passes; 'breach' if O fails; otherwise 'indeterminate' (data gaps decide it).
 * This is sound because every rule is monotone: more rest can never turn a pass into a fail.
 *
 * NOTE: rule thresholds below are the baseline described in the project briefs. They have NOT been
 * legally verified. Treat results as decision support until the open questions in SPEC.md are closed.
 */

const MIN = 60000;

const DEFAULT_RULES = Object.freeze({
  ruleSetLabel: 'baseline MLC 2006 / STCW A-VIII/1 per project briefs - NOT legally verified',
  window24Minutes: 1440,
  minRest24Minutes: 600,           // 10 h in any 24 h
  window7dMinutes: 10080,
  minRest7dMinutes: 4620,          // 77 h in any 7 days
  maxIntervalMinutes: 840,         // interval between consecutive rest periods <= 14 h
  splitMaxPeriods: 2,              // rest may be divided into no more than two periods ...
  splitMinLongestMinutes: 360,     // ... one of which is at least 6 h
  splitPolicy: 'best-two',         // 'best-two': only the two longest periods are credited toward the 10 h
                                   // 'strict-count': total >= 10 h AND at most two periods (any size)
  minRestPeriodMinutes: 0,         // rest shorter than this is treated as work (0 = literal reading)
  maxPlausibleEntryMinutes: 1440,  // entries longer than this raise a warning
  futureToleranceMinutes: 1,       // clock-skew allowance for entries ending/starting after asOf
});

/* ---------------------------------------------------------------- parsing and validation */

const TZ_RE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

function parseTime(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? { ms: v } : { err: 'INVALID_TIME' };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? { err: 'INVALID_TIME' } : { ms: v.getTime() };
  if (typeof v !== 'string') return { err: 'INVALID_TIME' };
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return { err: 'INVALID_TIME' };
  if (!TZ_RE.test(s)) return { err: 'AMBIGUOUS_TIME_ZONE' };
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? { err: 'INVALID_TIME' } : { ms };
}

const iso = ms => new Date(ms).toISOString();

function normalize(entries, asOf, R, issues) {
  const items = [];
  const tol = R.futureToleranceMinutes * MIN;
  const add = (code, severity, ids, message, from, to) => {
    const o = { code, severity, entryIds: ids, message };
    if (from != null) o.from = iso(from);
    if (to != null) o.to = iso(to);
    issues.push(o);
  };
  (Array.isArray(entries) ? entries : []).forEach((en, idx) => {
    const id = en && typeof en === 'object' && en.id != null ? String(en.id) : 'index:' + idx;
    if (!en || typeof en !== 'object') return add('INVALID_ENTRY', 'error', [id], 'Entry is not an object; excluded.');
    if (en.type !== 'rest' && en.type !== 'work') return add('UNKNOWN_TYPE', 'error', [id], 'Type must be "rest" or "work"; excluded.');
    const ps = parseTime(en.start);
    if (ps.err) return add(ps.err, 'error', [id], ps.err === 'AMBIGUOUS_TIME_ZONE' ? 'Start has no time zone; excluded.' : 'Start is not a valid time; excluded.');
    let e, open = false;
    if (en.end == null || en.end === '') { open = true; e = asOf; }
    else {
      const pe = parseTime(en.end);
      if (pe.err) return add(pe.err, 'error', [id], pe.err === 'AMBIGUOUS_TIME_ZONE' ? 'End has no time zone; excluded.' : 'End is not a valid time; excluded.');
      e = pe.ms;
    }
    const s = ps.ms;
    if (!open && e === s) return add('ZERO_LENGTH', 'warn', [id], 'Zero-length entry ignored.');
    if (!open && e < s) return add('END_NOT_AFTER_START', 'error', [id], 'End is before start; excluded.', e, s);
    if (s >= asOf) return add('FUTURE_ENTRY', s > asOf + tol ? 'error' : 'warn', [id], 'Entry starts at or after the evaluation time; ignored.', s);
    let ee = e;
    if (e > asOf) { ee = asOf; add('END_IN_FUTURE', e > asOf + tol ? 'error' : 'warn', [id], 'Entry ends after the evaluation time; clipped.', asOf, e); }
    if (ee - s > R.maxPlausibleEntryMinutes * MIN) add('LONG_ENTRY', 'warn', [id], 'Entry is longer than ' + R.maxPlausibleEntryMinutes + ' minutes; check it.', s, ee);
    items.push({ id, type: en.type, s, e: ee, open });
  });
  items.sort((a, b) => a.s - b.s || a.e - b.e || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return items;
}

function detectOverlaps(items, issues) {
  let active = [];
  let multiOpen = items.filter(i => i.open);
  if (multiOpen.length > 1) {
    issues.push({ code: 'MULTIPLE_OPEN', severity: 'error', entryIds: multiOpen.map(i => i.id), message: 'More than one open entry.' });
  }
  for (const it of items) {
    active = active.filter(a => a.e > it.s);
    for (const a of active) {
      const dup = a.type === it.type && a.s === it.s && a.e === it.e;
      const same = a.type === it.type;
      issues.push({
        code: dup ? 'DUPLICATE' : same ? 'OVERLAP_SAME' : 'OVERLAP_CONFLICT',
        severity: same ? 'warn' : 'error',
        entryIds: [a.id, it.id],
        message: dup ? 'Duplicate entry (merged, not double counted).'
          : same ? 'Overlapping entries of the same type (merged, not double counted).'
          : 'Overlapping rest and work entries; the overlap is treated as UNKNOWN.',
        from: iso(it.s), to: iso(Math.min(a.e, it.e)),
      });
    }
    active.push(it);
  }
}

/* ---------------------------------------------------------------- timelines */

function pushMerge(out, s, e, key, val) {
  if (e <= s) return;
  const l = out[out.length - 1];
  if (l && l.e === s && l[key] === val) l.e = e; else out.push({ s, e, [key]: val });
}

// base timeline over [from, to]: states 'rest' | 'work' | 'gap' (nothing logged) | 'conflict' (rest and work both logged)
function buildBase(items, from, to) {
  const pts = new Set([from, to]);
  const ev = [];
  for (const i of items) {
    if (i.s > from && i.s < to) pts.add(i.s);
    if (i.e > from && i.e < to) pts.add(i.e);
    const k = i.type === 'rest' ? 0 : 1;
    ev.push([i.s, k, 1], [i.e, k, -1]);
  }
  const b = [...pts].sort((x, y) => x - y);
  ev.sort((x, y) => x[0] - y[0]);
  const out = [];
  const cnt = [0, 0];
  let ei = 0;
  for (let k = 0; k < b.length - 1; k++) {
    while (ei < ev.length && ev[ei][0] <= b[k]) { cnt[ev[ei][1]] += ev[ei][2]; ei++; }
    const st = cnt[0] > 0 && cnt[1] > 0 ? 'conflict' : cnt[0] > 0 ? 'rest' : cnt[1] > 0 ? 'work' : 'gap';
    pushMerge(out, b[k], b[k + 1], 'st', st);
  }
  return out;
}

// fully-known timeline: 'P' (unknown -> work) or 'O' (unknown -> rest); returns [{s,e,rest}]
function knownTimeline(base, mode, R) {
  let out = [];
  for (const g of base) {
    const rest = g.st === 'rest' || (mode === 'O' && (g.st === 'gap' || g.st === 'conflict'));
    pushMerge(out, g.s, g.e, 'rest', rest);
  }
  if (R.minRestPeriodMinutes > 0) {
    const min = R.minRestPeriodMinutes * MIN;
    const re = [];
    for (const g of out) pushMerge(re, g.s, g.e, 'rest', g.rest && g.e - g.s < min ? false : g.rest);
    out = re;
  }
  return out;
}

// pieces of timeline K clipped to [a,b]; time outside K is filled with pre / post values
function slices(K, key, a, b, pre, post) {
  const out = [];
  if (b <= a) return out;
  if (!K.length) { pushMerge(out, a, b, key, pre); return out; }
  const k0 = K[0].s, kn = K[K.length - 1].e;
  if (a < k0) pushMerge(out, a, Math.min(b, k0), key, pre);
  if (b > k0 && a < kn) {
    const x = Math.max(a, k0);
    let lo = 0, hi = K.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (K[m].e > x) hi = m; else lo = m + 1; }
    for (let i = lo; i < K.length && K[i].s < b; i++) pushMerge(out, Math.max(K[i].s, a), Math.min(K[i].e, b), key, K[i][key]);
  }
  if (b > kn) pushMerge(out, Math.max(a, kn), b, key, post);
  return out;
}

/* ---------------------------------------------------------------- rule checks */

function restMetrics(sl) {
  let rest = 0;
  const periods = [];
  for (const g of sl) if (g.rest) { rest += g.e - g.s; periods.push(g.e - g.s); }
  periods.sort((x, y) => y - x);
  return { restMs: rest, count: periods.length, longestMs: periods[0] || 0, bestTwoMs: (periods[0] || 0) + (periods[1] || 0) };
}

function check24(m, R) {
  const need = R.minRest24Minutes * MIN, long = R.splitMinLongestMinutes * MIN;
  const total = m.restMs >= need;
  const structure = R.splitPolicy === 'strict-count'
    ? m.count <= R.splitMaxPeriods && m.longestMs >= long
    : m.bestTwoMs >= need && m.longestMs >= long;
  return { total, structure, pass: total && structure };
}

const verdictOf = (p, o) => (p ? 'compliant' : o ? 'indeterminate' : 'breach');
const combine = vs => (vs.includes('breach') ? 'breach' : vs.includes('indeterminate') ? 'indeterminate' : 'compliant');

function window24(KP, KO, t, R, forceO) {
  const a = t - R.window24Minutes * MIN;
  const mp = restMetrics(slices(KP, 'rest', a, t, false, false));
  const cp = check24(mp, R);
  let mo = mp, co = cp;
  if (forceO || !cp.pass) { mo = restMetrics(slices(KO, 'rest', a, t, true, true)); co = check24(mo, R); }
  return { mp, cp, mo, co };
}

function window7d(KP, KO, t, R, forceO) {
  const a = t - R.window7dMinutes * MIN, need = R.minRest7dMinutes * MIN;
  const mp = restMetrics(slices(KP, 'rest', a, t, false, false));
  const pass = mp.restMs >= need;
  let mo = mp, opass = pass;
  if (forceO || !pass) { mo = restMetrics(slices(KO, 'rest', a, t, true, true)); opass = mo.restMs >= need; }
  return { mp, pass, mo, opass };
}

function nonRestRuns(K) {
  const out = [];
  K.forEach((g, i) => { if (!g.rest) out.push({ s: g.s, e: g.e, leading: i === 0, trailing: i === K.length - 1 }); });
  return out;
}

function intervalBreaches(KP, KO, R) {
  const max = R.maxIntervalMinutes * MIN;
  const orr = nonRestRuns(KO).filter(r => r.e - r.s > max);
  return nonRestRuns(KP).filter(r => r.e - r.s > max).map(r => {
    const definite = orr.some(o => o.s < r.e && o.e > r.s);
    return { from: iso(r.s), to: iso(r.e), minutes: (r.e - r.s) / MIN, verdict: definite ? 'breach' : 'indeterminate', ongoing: r.trailing };
  });
}

/* ---------------------------------------------------------------- context */

function prepare(entries, opts) {
  const o = opts || {};
  const R = Object.assign({}, DEFAULT_RULES, o.rules || {});
  const issues = [];
  let asOf;
  if (o.asOf == null) asOf = Date.now();
  else { const p = parseTime(o.asOf); if (p.err) throw new Error('asOf must be an ISO-8601 time with a time zone'); asOf = p.ms; }
  const items = normalize(entries, asOf, R, issues);
  detectOverlaps(items, issues);
  let from = items.length ? items[0].s : asOf;
  if (o.recordStart != null) { const p = parseTime(o.recordStart); if (!p.err) from = Math.min(p.ms, asOf); }
  const base = buildBase(items, from, asOf);
  const KP = knownTimeline(base, 'P', R);
  const KO = knownTimeline(base, 'O', R);
  return { o, R, issues, asOf, items, from, base, KP, KO };
}

function sumStates(base, a, b) {
  const sl = slices(base, 'st', a, b, 'pre', 'pre');
  const r = { rest: 0, work: 0, unknown: 0 };
  for (const g of sl) {
    const d = (g.e - g.s) / MIN;
    if (g.st === 'rest') r.rest += d; else if (g.st === 'work') r.work += d; else r.unknown += d;
  }
  return r;
}

/* ---------------------------------------------------------------- work budget */

function lastTrue(maxMin, f) {          // f monotone: true ... true false ... false; returns last true minute, or -1
  if (!f(0)) return -1;
  let lo = 0, hi = maxMin;               // f(lo) true, f(hi) assumed false
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f(m)) lo = m; else hi = m; }
  return lo;
}

function budget(c) {
  const { R, asOf, KP } = c;
  const w24 = R.window24Minutes * MIN, w7 = R.window7dMinutes * MIN, need7 = R.minRest7dMinutes * MIN;
  const f24 = m => { const t = asOf + m * MIN; return check24(restMetrics(slices(KP, 'rest', t - w24, t, false, false)), R).pass; };
  const f7 = m => { const t = asOf + m * MIN; return restMetrics(slices(KP, 'rest', t - w7, t, false, false)).restMs >= need7; };
  const b24 = lastTrue(R.window24Minutes, f24), b7 = lastTrue(R.window7dMinutes, f7);
  const last = KP.length ? KP[KP.length - 1] : null;
  const cur = last && !last.rest ? (last.e - last.s) / MIN : 0;
  const bi = Math.max(0, Math.floor(R.maxIntervalMinutes - cur));
  const by = { rest24: Math.max(0, b24), rest7d: Math.max(0, b7), interval: bi };
  // a rule whose window reaches back before the first record cannot be judged: exclude it, say so
  const insufficient = [];
  if (c.from > asOf - w24) { by.rest24 = null; insufficient.push('rest24'); }
  if (c.from > asOf - w7) { by.rest7d = null; insufficient.push('rest7d'); }
  const live = Object.keys(by).filter(k => by[k] !== null);
  const binding = live.reduce((x, k) => (by[k] < by[x] ? k : x), live[0]);
  return {
    minutes: by[binding], binding, byRule: by, insufficientRecord: insufficient,
    assumes: 'work continues from asOf with no further rest', basis: 'pessimistic (unlogged time counted as work)',
  };
}

/* ---------------------------------------------------------------- public: evaluate */

function evaluate(entries, opts) {
  const c = prepare(entries, opts);
  const { R, asOf, KP, KO, base, from, issues } = c;
  const w24 = window24(KP, KO, asOf, R, true);
  const w7 = window7d(KP, KO, asOf, R, true);
  const s24 = sumStates(base, asOf - R.window24Minutes * MIN, asOf);
  const s7 = sumStates(base, asOf - R.window7dMinutes * MIN, asOf);

  const rest24 = {
    windowMinutes: R.window24Minutes, requiredMinutes: R.minRest24Minutes,
    loggedRestMinutes: s24.rest, loggedWorkMinutes: s24.work, unknownMinutes: s24.unknown,
    worstCaseRestMinutes: w24.mp.restMs / MIN, bestCaseRestMinutes: w24.mo.restMs / MIN,
    longestRestMinutes: w24.mp.longestMs / MIN, bestCaseLongestRestMinutes: w24.mo.longestMs / MIN,
    restPeriods: w24.mp.count,
    total: verdictOf(w24.cp.total, w24.co.total),
    structure: verdictOf(w24.cp.structure, w24.co.structure),
  };
  rest24.verdict = verdictOf(w24.cp.pass, w24.co.pass);

  const rest7d = {
    windowMinutes: R.window7dMinutes, requiredMinutes: R.minRest7dMinutes,
    loggedRestMinutes: s7.rest, loggedWorkMinutes: s7.work, unknownMinutes: s7.unknown,
    worstCaseRestMinutes: w7.mp.restMs / MIN, bestCaseRestMinutes: w7.mo.restMs / MIN,
    verdict: verdictOf(w7.pass, w7.opass),
  };

  const lastP = KP.length ? KP[KP.length - 1] : null, lastO = KO.length ? KO[KO.length - 1] : null;
  const curRunP = lastP && !lastP.rest ? (lastP.e - lastP.s) / MIN : 0;
  const curRunO = lastO && !lastO.rest ? (lastO.e - lastO.s) / MIN : 0;
  const maxI = R.maxIntervalMinutes;
  const longestRun = nonRestRuns(KP).reduce((m, r) => Math.max(m, (r.e - r.s) / MIN), 0);
  const interval = {
    maxMinutes: maxI, currentRunMinutes: curRunP, bestCaseCurrentRunMinutes: curRunO,
    remainingMinutes: Math.max(0, maxI - curRunP), longestRunMinutes: longestRun,
    verdict: verdictOf(curRunP <= maxI * 1, curRunO <= maxI),
  };

  const lastBase = base.length ? base[base.length - 1] : null;
  const errors = issues.filter(i => i.severity === 'error').length, warns = issues.length - errors;
  const rep = {
    asOf: iso(asOf), ruleSet: R,
    recordStart: items0(c) ? iso(from) : null,
    current: lastBase ? { state: lastBase.st, since: iso(lastBase.s), minutes: (lastBase.e - lastBase.s) / MIN } : { state: 'none', since: null, minutes: 0 },
    rest24, rest7d, interval,
    overall: combine([rest24.verdict, rest7d.verdict, interval.verdict]),
    budget: budget(c),
    dataQuality: { level: errors ? 'errors' : warns ? 'warnings' : 'clean', errors, warnings: warns, issues },
  };
  if (c.o.history) rep.history = scan(c);
  return rep;
}
const items0 = c => c.items.length > 0;

/* ---------------------------------------------------------------- history scan (audit / inspection use) */

function scan(c) {
  const { R, asOf, KP, KO, base, from, o } = c;
  const histMs = (o.historyDays == null ? 30 : o.historyDays) * 1440 * MIN;
  const step = Math.max(1, o.scanStepMinutes || 1) * MIN;
  const lowest = asOf - histMs;
  const bounds = new Set();
  for (const g of base) { bounds.add(g.s); bounds.add(g.e); }

  // Episodes = maximal runs of non-compliant window-end times. Candidates are every breakpoint (exact for
  // linear rules) plus, for the 24h rule, a regular grid (the split rule is not piecewise-linear).
  // With refine=true the episode edges are located to the millisecond between candidates (7d rule).
  function episodes(W, grid, refine, evalAt) {
    const t0 = Math.max(from + W, lowest);
    const cand = new Set();
    if (t0 <= asOf) {
      cand.add(t0); cand.add(asOf);
      for (const b of bounds) { if (b >= t0 && b <= asOf) cand.add(b); if (b + W >= t0 && b + W <= asOf) cand.add(b + W); }
      if (grid) for (let t = t0; t <= asOf; t += step) cand.add(t);
    }
    const ts = [...cand].sort((x, y) => x - y);
    const res = ts.map(evalAt);
    const eps = [];
    let cur = null;
    ts.forEach((t, i) => {
      const r = res[i];
      if (!r) { cur = null; return; }
      if (!cur) { cur = { first: t, last: t, worst: r.rest, verdict: r.verdict, reasons: new Set(r.reasons), i0: i, i1: i }; eps.push(cur); }
      else { cur.last = t; cur.i1 = i; cur.worst = Math.min(cur.worst, r.rest); if (r.verdict === 'breach') cur.verdict = 'breach'; r.reasons.forEach(x => cur.reasons.add(x)); }
    });
    if (refine) {
      for (const e of eps) {
        if (e.i0 > 0) { let lo = ts[e.i0 - 1], hi = e.first; while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (evalAt(m)) hi = m; else lo = m; } e.first = hi; }
        if (e.i1 < ts.length - 1) { let lo = e.last, hi = ts[e.i1 + 1]; while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (evalAt(m)) lo = m; else hi = m; } e.last = lo; }
      }
    }
    return eps.map(e => ({
      windowEndFrom: iso(e.first), windowEndTo: iso(e.last), windowStartFrom: iso(e.first - W),
      worstCaseRestMinutes: e.worst / MIN, verdict: e.verdict, reasons: [...e.reasons].sort(),
    }));
  }

  const eps24 = episodes(R.window24Minutes * MIN, true, false, t => {
    const w = window24(KP, KO, t, R, false);
    if (w.cp.pass) return null;
    const reasons = [];
    if (!w.co.total) reasons.push('total'); else if (!w.cp.total) reasons.push('total?');
    if (!w.co.structure) reasons.push('structure'); else if (!w.cp.structure) reasons.push('structure?');
    return { rest: w.mp.restMs, verdict: w.co.pass ? 'indeterminate' : 'breach', reasons };
  });
  const eps7 = episodes(R.window7dMinutes * MIN, false, true, t => {
    const w = window7d(KP, KO, t, R, false);
    if (w.pass) return null;
    return { rest: w.mp.restMs, verdict: w.opass ? 'indeterminate' : 'breach', reasons: ['total'] };
  });
  const ints = intervalBreaches(KP, KO, R).filter(b => Date.parse(b.to) >= lowest);
  return { historyDays: histMs / 1440 / MIN, scanStepMinutes: step / MIN, rest24: eps24, rest7d: eps7, interval: ints };
}

function scanHistory(entries, opts) { return scan(prepare(entries, opts)); }

module.exports = { evaluate, scanHistory, DEFAULT_RULES, parseTime };
