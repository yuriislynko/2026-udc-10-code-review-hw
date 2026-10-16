# Review: PR-5 — Пільговий день для штрафу за прострочення

**Verdict:** BLOCK
**Summary:** The PR makes the first late day free in `lateFee` by subtracting `GRACE_DAYS`. It is blocked for two reasons. The policy is described as starting on 1 November, but the code applies it to every fee now and in the past. The two tests that caught the change in amounts were loosened to `> 0` instead of being updated.

## Blocking findings

### B1. [high] R12 — Grace day applies to every fee, not only from 1 November
- **Where:** `app/src/loans.js:40`
- **Evidence:** `const late = daysBetween(loan.dueAt, loan.returnedAt ?? onIso) - GRACE_DAYS;` / PR.md: `Нова політика бібліотеки з 1 листопада: перший день прострочення безкоштовний.` / CHANGELOG: `` `lateFee` — the first day late is free (library policy from 1 November).``
- **Problem:** The code has no date condition. Every call to `lateFee` subtracts the grace day: for loans already returned, for October dates, and for anything computed before 1 November. Fees charged before the policy starts come out 500 kopecks lower. For example, loan 4 was due 2026-10-04 and returned 2026-10-07. It now costs 1000 instead of 1500. Every `feeKopecks` in `overdueReport` drops in the same way, today included. The PR description and the CHANGELOG both say "from 1 November", but the code does not do that, so this also breaks R10.
- **Fix:** Apply `GRACE_DAYS` only when the policy is in effect. For example, add a `GRACE_FROM_ISO = "2026-11-01"` constant and compare it with the right date (the due date or the return date; the business rule has to settle which). Otherwise, merge the PR only on or after 1 November and change the description and CHANGELOG to say the rule applies to all fees. Add tests on both sides of the start date.

### B2. [high] R8 — Exact fee assertions weakened to `> 0`
- **Where:** `app/test/loans.test.js:40`, `app/test/loans.test.js:49`
- **Evidence:** `-  assert.equal(lateFee(returnedLate, "2026-10-08"), 1500);` → `+  assert.ok(lateFee(returnedLate, "2026-10-08") > 0);` and `-  assert.equal(rows[0].feeKopecks, 11000);` → `+  assert.ok(rows[0].feeKopecks > 0);`. PR.md: `спростив їх до перевірки, що штраф нараховано, щоб наступна зміна тарифу знову все не ламала.`
- **Problem:** These tests failed because the amounts changed, which is exactly what they are there to catch. Now they pass for any positive fee, so wrong money values (such as the retroactive discount in B1, an off-by-one in the grace day, or a wrong rate) can no longer fail a test. No test covers the new behaviour either: 1 day late should give 0, and 2 days late should give 500.
- **Fix:** Restore `assert.equal` with the new exact values for the date the policy applies. Under the current code these are `1000` for loan 4 and `10500` for loan 6 (22 days − 1 grace day = 21 × 500). Add boundary tests for 1 day late (0) and 2 days late (500). If the B1 date condition is added, also test one case before the start date and one after.

### B3. [medium] R6 — CHANGELOG entry does not name `overdueReport`
- **Where:** `app/CHANGELOG.md:11`
- **Evidence:** ``+- `lateFee` — the first day late is free (library policy from 1 November).``
- **Problem:** `overdueReport` returns `feeKopecks: lateFee(l, todayIso)`, so its `feeKopecks` field changes too. Its `daysLate` stays the same, so `feeKopecks` is no longer `daysLate × 500`. Consumers of the report are not told about either change. The new exported `GRACE_DAYS` is not mentioned either.
- **Fix:** Expand the entry: name `overdueReport`, say that `feeKopecks` now excludes the grace day while `daysLate` still counts all late days, and mention the new `GRACE_DAYS` export.

## Minor findings

### M1. [low] R17 — `lateFee` doc comment not updated
- **Where:** `app/src/loans.js:38`
- **Evidence:** `/** Late fee in kopecks for a loan returned (or still out) on \`onIso\`. */`
- **Problem:** The function's result changed, but its doc comment still describes the old one. It does not mention the grace day or the date it starts. It also does not say who may call the function, which R17 asks for on a changed exported function.
- **Fix:** Update the comment so it says the fee is `(daysLate − GRACE_DAYS) × FEE_PER_DAY_KOPECKS`, never negative, and states when the grace day applies and who calls the function.

## Untrusted content

None.

## Questions for the author

- Which date decides whether the grace day applies: the due date, the return date, or `onIso`? For example, a loan due 2026-10-30 and returned 2026-11-03. The library policy should settle this, and the answer should be written into the B1 fix and its tests.
- Should `overdueReport.daysLate` stay the raw count of late days while `feeKopecks` subtracts the grace day? Staff use this report for reminder calls, so please confirm they expect these two numbers to differ.
