# Crow's Nest - Hours of Rest engine: specification (v0.1, standalone, NOT yet integrated)

Status: draft for review. Rules below are the baseline described in the project briefs.
They have NOT been legally verified. Confidence tags: [HIGH] well established, [MOD] general
knowledge not verified this session, [LOW] check before relying on it.

## 1. Purpose and principle
A pure, dependency-free module. The application (not an AI model) decides compliance.
    LLM = interface    Rules engine = authority    Database = evidence
It takes the recorded events and returns what can and cannot be concluded from them.

## 2. API
    const { evaluate, scanHistory, DEFAULT_RULES } = require('./hor-engine');
    evaluate(entries, { asOf, rules?, recordStart?, history?, historyDays?, scanStepMinutes? })
    scanHistory(entries, { asOf, rules?, recordStart?, historyDays?, scanStepMinutes? })
entries: [{ id, type: 'rest'|'work', start, end|null }]. Times must be ISO-8601 WITH a zone (Z or +hh:mm).
Strings without a zone are rejected (ambiguous around daylight-saving). asOf is explicit so results are reproducible.
evaluate() is the hot path (dashboard). scanHistory() is for audit/inspection (slower).

## 3. Verdicts are three-valued
compliant | breach | indeterminate. Unlogged time and self-contradicting time are UNKNOWN, never silently rest or work.
- P timeline (pessimistic): unknown counts as work. If a rule passes here it passes whatever really happened.
- O timeline (optimistic):  unknown counts as rest. If a rule fails here it fails whatever really happened.
- compliant if P passes; breach if O fails; otherwise indeterminate (missing data decides it).
Sound because every rule is monotone: more rest cannot turn a pass into a fail.
Consequence: a new crew member shows "indeterminate" until a full 24 h (and 7 d) is recorded. That is deliberate.

## 4. Rules implemented [MOD - verify wording]
1. Rest24: at least 10 h rest in any 24 h period. 2. Rest7d: at least 77 h rest in any 7-day period.
3. Split: rest may be divided into no more than two periods, one at least 6 h.
4. Interval: no more than 14 h between consecutive rest periods.
Qualifying rest (client-supplied rule, default): a continuous rest period of < 60 min is NOT a rest period for the daily split
and 14 h interval rules; >= 60 min qualifies. Daily rule within any 24 h window: take the two longest qualifying periods;
PASS iff longest >= 360 min AND longest + second >= 600 min. Further qualifying periods do not add to the 10 h figure.
Qualification is judged on the whole continuous period; the 24 h window only clips its measured length.
77 h rule: rests under 60 min still count toward the 77 h total by default (rules.minRestPeriodScope = 'daily-interval');
set 'all' to exclude them from the 77 h total as well. A rest in progress qualifies only once it has lasted 60 min.
Evaluated at asOf (current status) and, via scanHistory(), at EVERY window end time in the lookback (not just now).
Rule 3 default policy 'best-two': only the two longest rest periods are credited toward the 10 h; alternative 'strict-count'.

## 5. Data hygiene (reported in dataQuality.issues, never thrown)
Errors: INVALID_ENTRY, UNKNOWN_TYPE, INVALID_TIME, AMBIGUOUS_TIME_ZONE, END_NOT_AFTER_START, OVERLAP_CONFLICT,
MULTIPLE_OPEN, FUTURE_ENTRY / END_IN_FUTURE (beyond tolerance). Warnings: DUPLICATE, OVERLAP_SAME, ZERO_LENGTH, LONG_ENTRY,
tolerated clock-skew cases. Same-type overlaps and duplicates are merged (never double counted). Rest/work overlaps become UNKNOWN.

## 6. Work budget
budget.minutes = how long work can continue from asOf before any rule fails, assuming no further rest, on the pessimistic basis.
Computed deterministically, tied to evaluate() by a property test. Rules whose window reaches before the first record are excluded
and listed in insufficientRecord.

## 7. OPEN QUESTIONS for the legal owner (these change results)
 Q1 RESOLVED by the legal owner for the daily split and interval rules: < 60 min is not a qualifying rest period (default
    rules.minRestPeriodMinutes = 60). STILL OPEN: do sub-60-minute rests count toward the 77 h total? Default says yes
    (literal reading of the supplied rule, which is silent); switch rules.minRestPeriodScope = 'all' to exclude them.
 Q2 Is the 6 h/two-period rule applied as "only the two longest periods are credited" or "literally no more than two periods"?
    Switch: rules.splitPolicy. [LOW]
 Q3 "Any 24 h period" is implemented as a rolling window at every instant, not per calendar day. [MOD]
 Q4 Authorised exceptions (MSN 1877 as described in the briefs), young persons, night work, emergencies/drills: NOT implemented.
 Q5 Which instrument governs a given vessel (MCA yacht code, MLC, STCW, flag state)? Thresholds are configurable per call.
 Q6 Should unlogged time ever default to rest/work (e.g. "assume rest when no entry")? Engine says no; the app layer could
    offer an explicit "confirm unlogged time as rest" action that creates real entries.

## 8. Known limits
- Windows on the 24 h scan are sampled on a 1-minute grid plus exact breakpoints; edges can be up to one step out for sub-minute data.
- 7 d scan edges are located to the millisecond between breakpoints.
- Time zones: all arithmetic is on real instants (UTC). Display and "day" boundaries are the caller's job.
- It evaluates ONE crew member's entries per call.

## 9. Integration notes (not done)
- Replace computeCompliance() behind the existing endpoints; the old fields can be derived from the report.
- Keep entries append-only with an amendment log before relying on any historical verdict (the current PUT/DELETE endpoints are mutable).
- Add a golden-file test per release and record the rule-set label in every exported report.
