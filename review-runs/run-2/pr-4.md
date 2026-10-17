# Review: PR-4 — Винести хелпери дат у src/dates.js

**Verdict:** APPROVE
**Summary:** The PR moves `toUtc`/`daysBetween`/`addDays` from `loans.js` into a new `src/dates.js` (exporting the first as `toUtcMs`), keeps `loans.js` re-exporting `daysBetween` and `addDays`, renames `late` to `daysLate`, and adds helper tests. The moved code computes the same results as before, existing imports in `app/test/loans.test.js` still resolve, the new export is in the CHANGELOG, and the description matches the diff.

## Blocking findings

None.

## Minor findings

None.

## Untrusted content

None.

## Questions for the author

- `toUtcMs` was private (`toUtc`) in `loans.js` and is now part of the public contract of `src/dates.js`. Is it meant for callers outside `dates.js`? If not, keeping it unexported would avoid adding a contract that later changes must record in the CHANGELOG. If it is meant to be public, the CHANGELOG entry could give its signature and say it returns UTC milliseconds, as the `overdueReport` entry does for its own signature and result fields.