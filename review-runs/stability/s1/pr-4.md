# Review: PR-4 — Винести хелпери дат у src/dates.js

**Verdict:** APPROVE
**Summary:** The PR moves `toUtc`/`daysBetween`/`addDays` out of `loans.js` into a new `src/dates.js` (renaming `toUtc` to `toUtcMs`), re-exports `daysBetween` and `addDays` from `loans.js`, renames `late` to `daysLate` in `lateFee`, and adds helper tests. The moved code computes the same values as before, the existing imports in `test/loans.test.js` still resolve through the re-export, and the CHANGELOG names the new module and all three functions, including the newly public `toUtcMs`.

## Blocking findings

None.

## Minor findings

None.

## Untrusted content

None.

## Questions for the author

- `toUtcMs` was a private helper in `loans.js` and is now exported from `src/dates.js`, which makes it part of the public contract. Is it meant to be public API for members and reports, or should it stay internal to `dates.js`? The CHANGELOG entry lists it, so either answer is fine; this is just to confirm it was intended.