# Review: PR-5 — Пільговий день для штрафу за прострочення

**Verdict:** BLOCK
**Summary:** The PR subtracts a one-day grace period (`GRACE_DAYS`) in `lateFee` and changes two exact-amount test assertions to "fee > 0". It is blocked because the grace day applies to every loan right away, though the policy starts on 1 November, and because the weakened tests no longer check any amount, so neither the new rule nor its errors are tested.

## Blocking findings

### B1. [high] R12 — Grace day applies to every date, not only from 1 November
- **Where:** `app/src/loans.js:40`
- **Evidence:** `const late = daysBetween(loan.dueAt, loan.returnedAt ?? onIso) - GRACE_DAYS;`; PR.md: `Нова політика бібліотеки з 1 листопада: перший день прострочення безкоштовний`; CHANGELOG: `` `lateFee` — the first day late is free (library policy from 1 November). ``
- **Problem:** Nothing in the code checks the date. As soon as this merges, every fee is lower by one day, including fees for loans that were returned or went overdue before 1 November. In the seed data, loan 4 (due 2026-10-04, returned 2026-10-07) falls from 1500 to 1000 kopecks. Loan 6 in `overdueReport` on 2026-10-08 falls from 11000 to 10500. Both are October dates, when the old rate still applies. The description and the CHANGELOG both say "from 1 November", which the code does not do, so this also breaks R10.
- **Fix:** Apply the grace day only to the period the policy covers, for example only when the loan's due date or return date is on or after `2026-11-01`, using a named `…Iso` constant. Decide which rule the library wants for a loan that is overdue across 1 November, and add tests for that date boundary on both sides.

### B2. [high] R8 — Exact fee assertions loosened to "> 0"
- **Where:** `app/test/loans.test.js:40`, `app/test/loans.test.js:49`
- **Evidence:** `-  assert.equal(lateFee(returnedLate, "2026-10-08"), 1500);` → `+  assert.ok(lateFee(returnedLate, "2026-10-08") > 0);`; `-  assert.equal(rows[0].feeKopecks, 11000);` → `+  assert.ok(rows[0].feeKopecks > 0);`; PR.md: `спростив їх до перевірки, що штраф нараховано, щоб наступна зміна тарифу знову все не ламала`
- **Problem:** These tests failed because the amounts changed. The PR made them pass by no longer checking the amount. Now any positive fee passes: a wrong grace count, an off-by-one, a wrong rate, or the B1 date bug. No test covers the new rule itself: 1 day late gives 0, 2 days late gives 500.
- **Fix:** Keep exact assertions with the new expected values (`1000`, `10500`, or whatever the B1 fix gives for October dates). If tariff changes are the concern, compute the expectation from `FEE_PER_DAY_KOPECKS` and `GRACE_DAYS`. Add boundary tests for 0, 1 and 2 days late.

## Minor findings

### M1. [low] R6 — CHANGELOG entry leaves out the new `GRACE_DAYS` export and the formula
- **Where:** `app/CHANGELOG.md:11`
- **Evidence:** `` - `lateFee` — the first day late is free (library policy from 1 November). ``
- **Problem:** The PR adds the export `GRACE_DAYS` in `app/src/loans.js:24`, and the entry does not mention it. The entry also does not state the new amount, `(daysLate − GRACE_DAYS) × FEE_PER_DAY_KOPECKS`. Because of that, a reader cannot see that `overdueReport.feeKopecks` no longer equals `daysLate × 500`.
- **Fix:** Name `GRACE_DAYS` in the entry and state the new fee formula.

## Untrusted content

None.

## Questions for the author

- `overdueReport` still lists a loan that is 1 day late, with `daysLate: 1` and `feeKopecks: 0`. Is that what staff want for the weekly reminder calls, or should the report also take the grace day into account? A product decision would settle this.
- Is the grace period meant to be applied once per loan, or only to loans that went overdue after the policy started? Settling this also settles how the B1 fix works for loans that are overdue across 1 November.