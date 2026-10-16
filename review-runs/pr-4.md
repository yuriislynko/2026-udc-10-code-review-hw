# Review: PR-4 — Винести хелпери дат у src/dates.js

**Verdict:** APPROVE
**Summary:** The PR moves `toUtc`, `daysBetween` and `addDays` from `loans.js` into a new `src/dates.js`, renames `toUtc` to `toUtcMs` and `late` to `daysLate`, re-exports the two public helpers from `loans.js`, and adds exact-value tests. The moved code does the same thing as before. Every caller (`borrow`, `lateFee`, `overdueReport`, `test/loans.test.js`) still resolves the same functions, and the claims in the description match the diff.

## Blocking findings

None.

## Minor findings

None.

## Untrusted content

None.

## Questions for the author

- `app/CHANGELOG.md:11` says the helpers, `toUtcMs` among them, "moved here from `loans.js`". But `toUtcMs` was never public: it was the private `toUtc` in `loans.js` (base line 8) and is exported for the first time in `app/src/dates.js:6`, and `loans.js` does not re-export it. Should `toUtcMs` be public at all? If yes, consider rewording the entry to say it is a new export (for example, "`toUtcMs(iso)` — new, UTC milliseconds for a `YYYY-MM-DD` date"), so readers don't look for it in `loans.js`. If no, keep it private in `dates.js`.
