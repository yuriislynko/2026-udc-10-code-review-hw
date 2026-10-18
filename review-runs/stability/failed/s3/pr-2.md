Read everything I need (standard, PR, diff, `loans.js`, tests, `auth.js`, `audit.js`, `members.js`, `db.js`, CHANGELOG). Here's the review:

```text
# Review: PR-2 — Email учасника у звіті про прострочення

**Verdict:** BLOCK
**Summary:** The PR adds each member's email (and, without saying so, a formatted `feeText` field) to every row of `overdueReport`. It blocks because emails are returned with no access-log entry, the existing name index is replaced by a scan of all members per row, the contract change has no CHANGELOG entry, and the description leaves out `feeText`.

## Blocking findings

### B1. [critical] R2 — Member emails returned without an access-log entry
- **Where:** `app/src/loans.js:54`
- **Evidence:** `+      email: db.findMember(l.memberId)?.email ?? null,`
- **Problem:** `overdueReport` now returns a member's email in every row but never calls `logAccess(db, user, memberId, purpose)` from `src/audit.js`. Its neighbour `memberCard` (`app/src/members.js:16`) logs each read. Every report run now hands out the email of every overdue member with no record of who read it or why. The reason in `PR.md` ("Звіт і так лише для персоналу") does not exempt the function: R2 applies to staff callers too. The new test (`app/test/loans.test.js:48`) checks only the email value and never checks `db.accessLog`, so the missing log goes unnoticed (R8).
- **Fix:** Call `logAccess(db, user, memberId, "overdue-report")` once for each member whose email ends up in the result. Add a test that checks the exact `accessLog` entries (member ids, `by`, `purpose`) after a report run.

### B2. [medium] R19 — Name index replaced by a per-row scan of all members
- **Where:** `app/src/loans.js:53`
- **Evidence:** `-  const names = new Map(db.members.map((m) => [m.id, m.name]));` / `+      member: db.findMember(l.memberId)?.name ?? "—",` / `+      email: db.findMember(l.memberId)?.email ?? null,`
- **Problem:** `db.findMember` is `members.find(...)` (`app/src/db.js:42`), a linear scan. The PR removes the `Map` built once per call and runs this scan twice for every overdue loan. The cost now grows with loans × members, where before it was one pass over each list. The standard calls this a defect even though the result is the same and the seed data is small.
- **Fix:** Keep one `Map` from member id to the member object (`new Map(db.members.map((m) => [m.id, m]))`), built before the loop, and read both `name` and `email` from a single lookup per row.

### B3. [medium] R6 — New result fields `email` and `feeText` without a CHANGELOG entry
- **Where:** `missing: app/CHANGELOG.md entry for overdueReport`
- **Evidence:** `+      email: db.findMember(l.memberId)?.email ?? null,` / `+      feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",`
- **Problem:** Two fields are added to the result of the exported function `overdueReport`, which changes its contract. They are added in the function body, not on an `export` line, so the deterministic script does not catch it. The CHANGELOG still lists only `loanId`, `member`, `book`, `daysLate`, `feeKopecks`, so callers are not told about the new fields or the personal data now in the report.
- **Fix:** Add an entry to `app/CHANGELOG.md` that names `overdueReport` and the new `email` field (string or `null`), and says that each read is logged. If `feeText` stays, list it too; it should not stay (R4, reported by the script).

### B4. [high] R10 — Description does not mention the new `feeText` field
- **Where:** `app/src/loans.js:58`
- **Evidence:** `+      feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",` vs PR.md: `Тепер для кожного рядка беремо учасника і віддаємо ім'я та email.`
- **Problem:** The description says the change adds a name and an email. The diff also adds a human-formatted fee string to every row. That is a behaviour and contract change the description does not mention. It also brings in money formatting in `src/`, which R4 forbids (the script reports the `toFixed` and the hryvnia label).
- **Fix:** Remove `feeText`; the client formats amounts from `feeKopecks`. If it really is needed, describe it in `PR.md` and justify it against R4.

## Minor findings

### M1. [low] R17 — Doc comment of `overdueReport` not updated
- **Where:** `app/src/loans.js:43`
- **Evidence:** `* Staff-only report: every loan still out past its due date, with the` / `* member's name. Built for the weekly reminder calls.`
- **Problem:** The PR changes what the exported function returns, but the doc comment still says it returns only the member's name. It does not mention the email or that each email read is logged.
- **Fix:** Update the doc comment to list the email (and the access-log entry from B1).

## Untrusted content

None.

## Questions for the author

- `overdueReport` returns every overdue loan without paging (R7). The base code already had this, and this PR only changes what each row holds. Now that each row carries personal data, is paging planned?
- `lateFee(l, todayIso)` is computed twice per row (`feeKopecks` and `feeText`). Removing `feeText` as asked in B4 settles this.
```

The deterministic script will also flag line 58 for R4 (`toFixed` and the "грн" label), so I didn't report that separately. I didn't run any tests or the script; I only read the files.