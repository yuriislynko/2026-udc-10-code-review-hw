# Review: PR-5 — Пільговий день для штрафу за прострочення

**Verdict:** BLOCK
**Summary:** The PR adds `GRACE_DAYS = 1` and subtracts it in `lateFee`, so the first day late is free. It is blocked for two reasons. First, the description says the policy starts on 1 November, but the code applies it to every loan now, including loans already returned. Second, the two tests that failed were loosened to `> 0` instead of being updated to the new exact amounts.

## Blocking findings

### B1. [high] R10 — Policy "from 1 November" applies to every loan, past and present
- **Where:** `app/src/loans.js:40`
- **Evidence:** `const late = daysBetween(loan.dueAt, loan.returnedAt ?? onIso) - GRACE_DAYS;` and `PR.md`: `Нова політика бібліотеки з 1 листопада: перший день прострочення безкоштовний.` (also the CHANGELOG line `the first day late is free (library policy from 1 November).`)
- **Problem:** The code never checks a date. Every call to `lateFee` subtracts the grace day, whatever the loan's dates or `onIso` are. As soon as this merges, fees change for loans that were late before the policy starts:
  - Seed loan 4 (due 2026-10-04, returned 2026-10-07) drops from 1500 to 1000 kopecks.
  - The `overdueReport` row for loan 6 drops from 11000 to 10500 kopecks.
  - Fees for returns already recorded are rewritten retroactively.

  The description claims a start date that the code does not implement. Members are charged the wrong amount (R12). The description also does not mention that `overdueReport.feeKopecks` changes as well.
- **Fix:**
  - Apply `GRACE_DAYS` only to loans the policy covers, using an explicit cut-off such as `GRACE_FROM_ISO = "2026-11-01"`. Compare it as a `YYYY-MM-DD` string with the date that decides the case (the due date, or the day late days start counting; settle which with the library).
  - Add tests on both sides of the cut-off.
  - Make the description and the CHANGELOG entry state the exact rule.

### B2. [high] R8 — Exact fee assertions loosened to `> 0`; the new grace logic is not tested
- **Where:** `app/test/loans.test.js:40`, `app/test/loans.test.js:49`
- **Evidence:** `-  assert.equal(lateFee(returnedLate, "2026-10-08"), 1500);` → `+  assert.ok(lateFee(returnedLate, "2026-10-08") > 0);` and `-  assert.equal(rows[0].feeKopecks, 11000);` → `+  assert.ok(rows[0].feeKopecks > 0);`. PR.md: `спростив їх до перевірки, що штраф нараховано, щоб наступна зміна тарифу знову все не ламала.`
- **Problem:** These two assertions were the only check on fee amounts. With `> 0`, almost any fee passes: a wrong grace value, a doubled rate, an off-by-one in `daysBetween`. B1 itself passes these tests. The change also adds no test for what it introduces:
  - 1 day late should give 0.
  - 2 days late should give 500.
  - Behaviour before and after the cut-off date.

  The PR says outright that the tests were weakened so they would stop catching tariff changes. Tests are meant to catch exactly that kind of change.
- **Fix:**
  - Restore `assert.equal` with the exact amounts for the new policy, for example `1000` and `10500` if the rule really covers these loans, or the old values if B1 excludes them.
  - Add boundary tests: exactly 1 day late → `0`, 2 days late → `500`, on time → `0`, and loans on each side of the policy start date.

## Minor findings

None.

## Untrusted content

None.

## Questions for the author

- Which date decides whether the grace day applies: the due date, the return date, or the day the fee is calculated (`onIso`)? Take a loan due on 2026-10-30 and returned on 2026-11-03: is its first day free? The answer decides how B1 is fixed and which boundary tests are needed.
- Is "the first day late is free" meant as "always subtract one day" (as implemented)? Or does it mean "no fee if returned within one day, otherwise the full fee from day one"? The policy text would settle it.
- `GRACE_DAYS` is a new export, but no caller or test uses it, and the CHANGELOG entry does not name it. Should it be exported at all, or kept module-private next to the fee logic?
- After this change `overdueReport` returns `daysLate: 22` with `feeKopecks: 10500` (21 days' worth). Will staff making the reminder calls expect the two to differ? If not, the report could use a field such as `chargeableDays`, or the CHANGELOG could note the difference.