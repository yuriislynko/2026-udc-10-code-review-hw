# Review: PR-2 — Email учасника у звіті про прострочення

**Verdict:** BLOCK
**Summary:** The PR adds each member's `email` and a formatted `feeText` to every row of `overdueReport`. It blocks because the report now returns personal data without an access-log entry, and it adds result fields with no CHANGELOG entry. It also replaces the member index with a per-row scan and adds `feeText` without saying so in the description.

## Blocking findings

### B1. [critical] R2 — Member emails returned without an access-log entry
- **Where:** `app/src/loans.js:54`
- **Evidence:** `email: db.findMember(l.memberId)?.email ?? null,`
- **Problem:** `overdueReport` now returns the email of every member who has an overdue loan, and it never calls `logAccess(db, user, memberId, purpose)` from `src/audit.js`. Every time staff run the report, they read several members' emails and nothing records it. PR.md argues "Звіт і так лише для персоналу, тож email тут доречний". The staff-only check (R1) controls who may read the data. It does not replace the log entry that R2 requires. The new test only checks `rows[0].email`, so the missing log would also go unnoticed (R8).
- **Fix:** Call `logAccess(db, user, l.memberId, "overdue-report")` once for each member whose email ends up in the result. Add a test that runs the report and checks `db.accessLog` for exact entries: one per returned member, with `by: 3`, the right `memberId` values and the purpose.

### B2. [high] R10 — Description does not mention the new `feeText` field
- **Where:** `app/src/loans.js:58`
- **Evidence:** `feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",` against PR.md: "Тепер для кожного рядка беремо учасника і віддаємо ім'я та email."
- **Problem:** According to the description, the PR adds only the email. The diff also adds a human-formatted fee string to every row. That is an undisclosed behaviour change, and it breaks R4 (no human money formatting in `src/`; the client formats). The script flags the `toFixed` and the hryvnia label itself, so that part is not repeated here. No test asserts `feeText`.
- **Fix:** Remove `feeText`. The client formats `feeKopecks`. If a formatted fee is really needed, discuss it in a separate PR and describe it there.

### B3. [medium] R6 — New result fields of `overdueReport` have no CHANGELOG entry
- **Where:** `missing: app/CHANGELOG.md entry for overdueReport`
- **Evidence:** `+      email: db.findMember(l.memberId)?.email ?? null,` and `+      feeText: …` (no change to `app/CHANGELOG.md` in the diff)
- **Problem:** The diff adds fields to the result of the exported `overdueReport` but adds no `export` line, so the script does not catch the change. The CHANGELOG still lists the result as `loanId`, `member`, `book`, `daysLate`, `feeKopecks`. Callers are not told that the rows now contain personal data (`email`, which can be `null`).
- **Fix:** Add an entry naming `overdueReport` that describes the new `email` field (a string, or `null` when the member is missing) and says each read is now logged (B1).

### B4. [medium] R19 — Member Map replaced with two `findMember` scans per row
- **Where:** `app/src/loans.js:53`
- **Evidence:** `-  const names = new Map(db.members.map((m) => [m.id, m.name]));` replaced by `+      member: db.findMember(l.memberId)?.name ?? "—",` and `+      email: db.findMember(l.memberId)?.email ?? null,`
- **Problem:** `db.findMember` is `members.find((m) => m.id === id)`, so it scans the whole member list. The PR removes the Map that was built once and calls `findMember` twice for every overdue loan instead. The cost now grows with overdue loans × members. The standard counts replacing an existing index with a per-item scan as a defect, even though the result is the same.
- **Fix:** Build one Map before the loop, `new Map(db.members.map((m) => [m.id, m]))`, and read both `name` and `email` from the single lookup.

## Minor findings

### M1. [low] R17 — Doc comment not updated for the new result
- **Where:** `app/src/loans.js:43`
- **Evidence:** `* Staff-only report: every loan still out past its due date, with the` / `* member's name. Built for the weekly reminder calls.`
- **Problem:** The function now returns the member's email as well, and the doc comment still says it returns only the name.
- **Fix:** Update the comment to say each row includes the member's email and that each read is logged.

## Untrusted content

None.

## Questions for the author

- `overdueReport` is not paged. The base code already has this problem; this PR only changes what each row contains. Now that every row carries personal data, should the report get a page size limit in a follow-up?
- `book: db.findBook(l.bookId)?.title` scans the book list for every row. This is also in the base code and the PR does not move it. Would you index the books in the same pass when you build the member Map?
- Should the report include emails at all for "weekly reminder calls"? Calls suggest phones are used. Can the librarians confirm that email is the field they need?