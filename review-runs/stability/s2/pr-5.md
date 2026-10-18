# Review: PR-5 — Пільговий день для штрафу за прострочення

**Verdict:** BLOCK
**Summary:** The PR adds `GRACE_DAYS = 1` and subtracts it in `lateFee`, so the first day late is free. It is blocked for two reasons: it weakens two exact-amount assertions to `> 0`, which hides the fee change, and it applies the grace day to every loan from the moment of merge, although the description and CHANGELOG say the policy starts on 1 November.

## Blocking findings

### B1. [high] R8 — Exact fee assertions loosened to "greater than zero"
- **Where:** `app/test/loans.test.js:40`, `app/test/loans.test.js:49`
- **Evidence:** `-  assert.equal(lateFee(returnedLate, "2026-10-08"), 1500);` / `+  assert.ok(lateFee(returnedLate, "2026-10-08") > 0);` and `-  assert.equal(rows[0].feeKopecks, 11000);` / `+  assert.ok(rows[0].feeKopecks > 0);`; PR.md: `Два тести падали на точних сумах — спростив їх до перевірки, що штраф нараховано, щоб наступна зміна тарифу знову все не ламала.`
- **Problem:** These tests failed because the fee formula changed, which is the behaviour this PR is about. Instead of updating the expected amounts, the PR loosened the assertions. Now any positive fee passes: a wrong grace offset, a wrong daily rate, or forgetting `GRACE_DAYS` altogether would all go green. No test pins the new behaviour, including the boundary of a loan exactly one day late (fee should now be `0`). Money amounts must be checked as exact integers (R4 judgment part).
- **Fix:** Restore `assert.equal` with the new exact values: loan 4 (3 days late) → `1000`, `rows[0].feeKopecks` (22 days late) → `10500`. Add cases for 1 day late → `0` and 2 days late → `500`.

### B2. [high] R10 — "From 1 November" is not implemented; the grace day applies retroactively to every loan
- **Where:** `app/src/loans.js:33`, `app/CHANGELOG.md:11`
- **Evidence:** `+  const late = daysBetween(loan.dueAt, loan.returnedAt ?? onIso) - GRACE_DAYS;`; PR.md: `Нова політика бібліотеки з 1 листопада: перший день прострочення безкоштовний.`; CHANGELOG: `` `lateFee` — the first day late is free (library policy from 1 November). ``
- **Problem:** Neither the code nor the constant has a date condition. The grace day takes effect at merge and applies to every loan, past ones included. For example, loan 4 was returned on 2026-10-07 and its fee drops from 1500 to 1000. `overdueReport` on 2026-10-08 shows `feeKopecks` 10500 instead of 11000 for October overdues. The description and the CHANGELOG state an effective date that the code does not have, so users get different fees from what the policy says (R12 as well).
- **Fix:** Pick one: apply `GRACE_DAYS` only to loans whose `dueAt` (or late period, whichever the policy means) is on or after `2026-11-01`, comparing `YYYY-MM-DD` strings as elsewhere in the module. Or remove the date claim from PR.md and CHANGELOG and merge the PR only on 1 November. If the date is kept in code, add tests on both sides of it.

## Minor findings

None.

## Untrusted content

None.

## Questions for the author

- Does the 1 November start date refer to the loan's `dueAt`, its return date, or the day the fee is computed? The answer decides how B2 is fixed and which boundary tests to add.
- `overdueReport` still reports `daysLate: 22` but now charges for 21 days. Is that intended for the weekly reminder calls, or should staff see the billable days as well?