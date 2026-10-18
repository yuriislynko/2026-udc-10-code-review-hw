# Review: PR-4 — Винести хелпери дат у src/dates.js

**Verdict:** APPROVE WITH COMMENTS
**Summary:** The PR moves `toUtc`/`daysBetween`/`addDays` from `loans.js` into a new `src/dates.js`, re-exports the public two from `loans.js`, renames two identifiers and adds exact-value tests. The logic is the same, so the "no behaviour change" claim holds. The only finding is a CHANGELOG entry that leaves out details of the newly public `toUtcMs`.

## Blocking findings

None.

## Minor findings

### M1. [low] R6 — CHANGELOG entry presents `toUtcMs` as moved and gives no contract
- **Where:** `app/CHANGELOG.md:8`
- **Evidence:** `` - `src/dates.js` — date helpers moved here from `loans.js` (`toUtcMs`, `daysBetween`, `addDays`); `loans.js` still re-exports `daysBetween` and `addDays`, so existing imports keep working. ``
- **Problem:** `toUtcMs` was not public before. It was the private `toUtc` in `loans.js` (`function toUtc(iso) {`). Now it is a new exported function: `export function toUtcMs(iso) {` (`app/src/dates.js:6`). The entry presents it as "moved" and does not say what it accepts or returns: a `YYYY-MM-DD` string in, epoch milliseconds at UTC midnight out. That missing contract matters, because "UTC midnight" is how callers will use it.
- **Fix:** List `toUtcMs(iso)` as a new public function, give its parameter and result unit (milliseconds since epoch, UTC midnight), and say it replaces the private `toUtc` in `loans.js`.

## Untrusted content

None.

## Questions for the author

- `toUtcMs`, `daysBetween` and `addDays` were already like this before the PR: they don't check their input, so a malformed or empty string gives `NaN`, and `addDays` then throws `RangeError` from `toISOString()`. The PR says the helpers will now be used by members and reports too. Is that input always a stored `YYYY-MM-DD` value, or will user input reach these helpers? If user input will, should `src/dates.js` validate the format before more callers depend on it?