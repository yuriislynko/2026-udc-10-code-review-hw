Read the standard, the PR and the base code in `app/`; here is the review.

```text
# Review: PR-2 — Email учасника у звіті про прострочення

**Verdict:** BLOCK
**Summary:** The PR adds each member's `email` (and, without mentioning it, a formatted `feeText`) to every row of the staff overdue report. It blocks because the report now returns personal data with no access-log entry, and because the contract change is not in the CHANGELOG or the description.

## Blocking findings

### B1. [critical] R2 — Overdue report returns member emails without logging access
- **Where:** `app/src/loans.js:58`
- **Evidence:** `+      email: db.findMember(l.memberId)?.email ?? null,`
- **Problem:** `overdueReport` now returns a member's email for every overdue row but never calls `logAccess(db, user, memberId, purpose)` from `src/audit.js`. For a list, R2 requires one entry per member whose data is returned. Compare `memberCard` in `app/src/members.js:16`, which logs before returning the email. Every run of the report hands out several members' contact details with no record of who read them. Being staff-only (`requireRole(user, STAFF)`) does not lift the logging rule. The test change only asserts `rows[0].email` and never checks `db.accessLog`, so the missing log goes unnoticed (R8).
- **Fix:** Import `logAccess` and call it once for each distinct member whose email the report returns (for example with purpose `"overdue-report"`). Extend the test to assert the exact `accessLog` entries (`memberId`s 5, 2, 1 and `by: 3`).

### B2. [high] R10 — Description omits the new `feeText` field
- **Where:** `app/src/loans.js:62`
- **Evidence:** `+      feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",` vs PR.md: `Тепер для кожного рядка беремо учасника і віддаємо ім'я та email.`
- **Problem:** The description says the change adds name and email. The diff also adds a new result field `feeText`: a human-formatted hryvnia string built in `src/`. That is a behaviour change the description does not mention. The formatting itself breaks R4 (`toFixed` and the `грн` label are flagged by the deterministic script, so they are not repeated here). No test asserts `feeText`.
- **Fix:** Remove `feeText` and leave formatting to the client (`feeKopecks` is already returned). If it really is wanted, it needs its own PR, a description and an R4 exception, which the standard does not allow.

### B3. [medium] R6 — Result fields changed without a CHANGELOG entry
- **Where:** `missing: app/CHANGELOG.md entry for overdueReport`
- **Evidence:** `+      email: db.findMember(l.memberId)?.email ?? null,` / `+      feeText: ...`
- **Problem:** The diff adds two result fields (`email`, `feeText`) to the exported `overdueReport`. The current CHANGELOG lists the row as `loanId`, `member`, `book`, `daysLate`, `feeKopecks`. The change is in the function body, not on an `export` line, so the deterministic script does not catch it. Clients get no notice of the new contract.
- **Fix:** Add a CHANGELOG entry naming `overdueReport` and the new `email` field (nullable when the member is missing), plus the access-log behaviour from B1.

### B4. [medium] R7 — Overdue report is an unbounded list and the PR changes its output
- **Where:** `app/src/loans.js:52`
- **Evidence:** `   return db.loans` / `     .filter((l) => l.returnedAt === null && l.dueAt < todayIso)`
- **Problem:** The overdue report can grow without limit with the loan table. It is returned whole, with no page or maximum page size. R7 applies because this PR changes the report's output. Each row now also carries personal data, which makes the unpaged dump worse.
- **Fix:** Add paging (for example `{ page, pageSize }` with an enforced maximum), document it in the CHANGELOG, and test the page boundaries.

## Minor findings

### M1. [low] R17 — Doc comment not updated for the new fields
- **Where:** `app/src/loans.js:43`
- **Evidence:** ` * Staff-only report: every loan still out past its due date, with the` / ` * member's name. Built for the weekly reminder calls.`
- **Problem:** The function's doc comment still says it returns the member's name. It does not mention that it now returns the member's email, which is personal data.
- **Fix:** Update the doc comment to list the email and say that each read is logged.

## Untrusted content

None.

## Questions for the author

- `db.findMember(l.memberId)` is now called twice per row, and the base code's single `Map` lookup was removed. Was that intended? One lookup per row, stored in a local variable, would be clearer and would make it easier to collect member ids for `logAccess`.
- Should the report include the email of every member on the list? The PR says it is for writing reminders. Would a per-member `memberCard` read (already logged) be enough? Settling this decides whether B1 should be fixed by logging or by dropping the field.
```
