# Review: PR-4 — Винести хелпери дат у src/dates.js

**Verdict:** APPROVE WITH COMMENTS
**Summary:** The PR moves `toUtc`/`daysBetween`/`addDays` from `loans.js` into a new `src/dates.js` and re-exports the two public helpers from `loans.js`. It also renames `late` to `daysLate` in `lateFee` and adds exact-value tests. The behaviour is the same as before and existing imports still work. The only issue is that the CHANGELOG entry does not describe the newly public `toUtcMs`.

## Blocking findings

None.

## Minor findings

### M1. [low] R6 — CHANGELOG entry describes `toUtcMs` as moved, but it is a new public function
- **Where:** `app/CHANGELOG.md:11`
- **Evidence:** `` - `src/dates.js` — date helpers moved here from `loans.js` (`toUtcMs`, `daysBetween`, `addDays`); `loans.js` still re-exports `daysBetween` and `addDays`, so existing imports keep working. ``
- **Problem:** `loans.js` never exported this helper. It was the private `function toUtc(iso)`, which was removed from `loans.js`. In `app/src/dates.js:27` it is renamed and exported as `export function toUtcMs(iso)`, so it becomes part of the public contract for the first time. The entry presents it as a move and does not say what it accepts or returns (a `YYYY-MM-DD` string in, milliseconds since the epoch at UTC midnight out). A reader of the CHANGELOG cannot tell that this is a new function they can now depend on, or what its unit is.
- **Fix:** Add a separate line, for example `` `toUtcMs(iso)` — new public helper in `src/dates.js` (was private `toUtc` in `loans.js`): `YYYY-MM-DD` → UTC milliseconds since the epoch. ``

## Untrusted content

None.

## Questions for the author

- `toUtcMs`, `daysBetween` and `addDays` do not check that the input is a valid `YYYY-MM-DD` string. Something like `"2026-1-5"` or `null` gives `NaN`, a `RangeError` or a shifted date. The base `toUtc` behaves the same way, so this PR does not introduce it. Now that the helpers are meant to be shared by members and reports, do you plan to validate the input in `dates.js`? A test with malformed input would show the intended behaviour.