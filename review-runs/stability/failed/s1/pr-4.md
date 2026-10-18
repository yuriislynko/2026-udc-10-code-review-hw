```text
# Review: PR-4 — Винести хелпери дат у src/dates.js

**Verdict:** APPROVE WITH COMMENTS
**Summary:** The PR moves `daysBetween` and `addDays` from `loans.js` to a new `src/dates.js` module, re-exports them from `loans.js`, makes the private `toUtc` public as `toUtcMs`, renames `late` to `daysLate` in `lateFee` and adds helper tests. The moved code computes the same results as before and existing imports still resolve. The only finding is a CHANGELOG entry that misdescribes the newly public `toUtcMs`.

## Blocking findings

None.

## Minor findings

### M1. [low] R6 — CHANGELOG calls `toUtcMs` "moved" and omits its contract
- **Where:** `app/CHANGELOG.md:8`
- **Evidence:** `` - `src/dates.js` — date helpers moved here from `loans.js` (`toUtcMs`, `daysBetween`, `addDays`); `` and `+export function toUtcMs(iso) {`
- **Problem:** `toUtcMs` was never part of `loans.js`'s public API. Before this PR it was the private, unexported `toUtc` (`app/src/loans.js:8`). Now it is a new exported function with a new name. The entry presents it as moved, and it does not say what the function accepts or returns (a `YYYY-MM-DD` string in, epoch milliseconds at UTC midnight out). It also does not say that `loans.js` does not re-export it. The entry names the function, so this is the minor part of R6.
- **Fix:** Rewrite the entry to say that `toUtcMs(iso)` is new and public, and that it returns epoch milliseconds for UTC midnight of `iso`. Keep the note that `daysBetween` and `addDays` moved, with unchanged contracts, and are still re-exported from `loans.js`.

## Untrusted content

None.

## Questions for the author

- `src/dates.js` is meant to be shared by members and reports. Is `toUtcMs` (and the other helpers) expected to receive input that is not a valid `YYYY-MM-DD` string, such as `null`, an empty string or a full date-time? Today `null` throws a `TypeError` and a malformed string gives `NaN`, as the base code did. If the new callers can pass such input, a guard or a test for it would settle this.
```