'use strict';
// node demo.js  - the seven scenarios from the earlier review, old engine vs this one
const { evaluate } = require('./hor-engine.js');
const H = 3600e3, NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const iso = h => new Date(NOW - h * H).toISOString();
let n = 0;
const e = (type, s, f) => ({ id: 'd' + n++, type, start: iso(s), end: f == null ? null : iso(f) });
const cases = [
  ['A  exactly 10h rest ending now', [e('rest', 10, 0)], 'ok24=true'],
  ['B  two identical overlapping 6h rests', [e('rest', 6, 0), e('rest', 6, 0)], 'rest24=12h ok24=true  (DOUBLE COUNTED)'],
  ['C  6h rest only, 18h unlogged', [e('rest', 6, 0)], 'ok24=false (unlogged treated as a breach)'],
  ['D  20h work then 30h rest (breach 30h ago)', [e('work', 50, 30), e('rest', 30, 0)], 'ok24=true; breach not listed'],
  ['E  rest 8h+1h+1h in 24h', [e('rest', 24, 16), e('work', 16, 12), e('rest', 12, 11), e('work', 11, 5), e('rest', 5, 4), e('work', 4, 0)], 'okSplit=false'],
  ['F  open work 15h', [e('work', 15, null)], 'okGap=false'],
  ['G  10h work, 5-min rest, 10h work', [e('work', 20.1, 10.1), e('rest', 10.1, 10.0167), e('work', 10.0167, 0)], 'okGap=true (5-min rest reset the gap)'],
];
for (const [name, es, old] of cases) {
  const r = evaluate(es, { asOf: new Date(NOW).toISOString(), history: true, historyDays: 30 });
  console.log(name);
  console.log('   old engine : ' + old);
  console.log('   new engine : rest24=' + r.rest24.verdict + ' (worst ' + r.rest24.worstCaseRestMinutes.toFixed(0) + ' / best ' + r.rest24.bestCaseRestMinutes.toFixed(0) + ' min, unknown ' + r.rest24.unknownMinutes.toFixed(0) + ' min)  structure=' + r.rest24.structure + '  interval=' + r.interval.verdict + '  overall=' + r.overall);
  console.log('                work budget ' + r.budget.minutes + ' min (' + r.budget.binding + '), issues: ' + (r.dataQuality.issues.map(i => i.code).join(',') || 'none') + ', history: ' + r.history.rest24.length + ' 24h episode(s), ' + r.history.interval.length + ' interval breach(es)');
}
