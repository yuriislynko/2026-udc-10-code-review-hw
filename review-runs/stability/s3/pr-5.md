# Review: PR-5 — Пільговий день для штрафу за прострочення

**Verdict:** BLOCK
**Summary:** The PR adds `GRACE_DAYS = 1` and subtracts it in `lateFee`, so the first late day is free. It blocks for two reasons. The policy is described as starting on 1 November, but the code applies it to every loan with no date check, including fees already owed in October. And the two tests that would have caught the new amounts were weakened to `> 0` checks.

## Blocking findings

### B1. [high] R12 — Grace day applied to every loan, not from 1 November
- **Where:** `app/src/loans.js:40`
- **Evidence:** `const late = daysBetween(loan.dueAt, loan.returnedAt ?? onIso) - GRACE_DAYS;`; `PR.md`: `Нова політика бібліотеки з 1 листопада: перший день прострочення безкоштовний.`; `app/CHANGELOG.md:11`: `` `lateFee` — the first day late is free (library policy from 1 November). ``
- **Problem:** Nothing in `lateFee` compares any date with 2026-11-01. The grace day is subtracted from every loan, whenever it was due or returned. With the seed data, loan 4 (due 2026-10-04, returned 2026-10-07) falls from 1500 to 1000 kopecks. `overdueReport(db, staff, "2026-10-08")` now reports 10500 instead of 11000 for loan 6. Both are fees from before the policy starts. Once merged, every fee and every overdue report row drops by 500 kopecks right away. The description and the CHANGELOG entry both say "from 1 November", but the code does not do that (R10).
- **Fix:** Apply `GRACE_DAYS` only when the policy covers the loan, for example when `dueAt` (or the first late day) is on or after `2026-11-01`. Compare `YYYY-MM-DD` strings or use the UTC helpers (R5). Keep the policy start date in a named constant. If the change really is meant to take effect at once and apply to past loans, fix `PR.md` and the CHANGELOG entry to say so.

### B2. [high] R8 — Exact-amount assertions loosened to `> 0`; new behaviour untested
- **Where:** `app/test/loans.test.js:40`, `app/test/loans.test.js:49`
- **Evidence:** `-  assert.equal(lateFee(returnedLate, "2026-10-08"), 1500);` → `+  assert.ok(lateFee(returnedLate, "2026-10-08") > 0);`; `-  assert.equal(rows[0].feeKopecks, 11000);` → `+  assert.ok(rows[0].feeKopecks > 0);`; `PR.md`: `спростив їх до перевірки, що штраф нараховано, щоб наступна зміна тарифу знову все не ламала.`
- **Problem:** The two tests that failed were the ones pointing at the change in amounts, and B1 is exactly such a change. They were turned into "returned something" checks instead of being updated, so B1 passes unnoticed. Any later bug in the fee formula would pass too: a wrong rate, a float result, a wrong grace subtraction. No test covers the new rule itself: a loan exactly 1 day late gives 0, 2 days late gives 500, and loans before or after the policy date get different amounts.
- **Fix:** Restore `assert.equal` with the exact expected kopeck values. Add boundary tests: 0, 1 and 2 days late, and a loan on each side of the policy start date. If the tariff is likely to change, compute the expected values from `FEE_PER_DAY_KOPECKS` and `GRACE_DAYS` in the test, and still assert exact equality.

## Minor findings

### M1. [low] R17 — `lateFee` doc comment and variable name not updated
- **Where:** `app/src/loans.js:38`, `app/src/loans.js:40`
- **Evidence:** `/** Late fee in kopecks for a loan returned (or still out) on `onIso`. */`; `const late = daysBetween(...) - GRACE_DAYS;`
- **Problem:** The doc comment does not mention the free first day or when the grace applies. `late` now holds billable days, not days late, which makes it easy to confuse with `daysLate` in `overdueReport`.
- **Fix:** Mention the grace day and its start date in the doc comment, and rename the variable, for example `billableDays`.

## Untrusted content

None.

## Questions for the author

- `GRACE_DAYS` is a new export from `src/loans.js`, but the CHANGELOG entry names only `lateFee`. Is the constant part of the public contract that clients use? If so, should the entry name it?
- In `overdueReport`, a loan exactly 1 day late now appears with `feeKopecks: 0`. Is that what the weekly reminder calls should show, or should such loans be marked or left out? The call staff, or whoever owns the report, would settle this.