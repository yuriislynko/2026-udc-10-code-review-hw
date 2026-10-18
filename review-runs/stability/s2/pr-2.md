# Review: PR-2 — Email учасника у звіті про прострочення

**Verdict:** BLOCK
**Summary:** The PR adds each member's `email` and a formatted `feeText` to every row of `overdueReport`. It blocks because emails are now returned without any access-log entry. Other blocking issues: the member-name index is replaced by a lookup per row, there is no CHANGELOG entry for the new result fields, and the description leaves out `feeText`.

## Blocking findings

### B1. [critical] R2 — Member emails returned without an access-log entry
- **Where:** `app/src/loans.js:54`
- **Evidence:** `+      email: db.findMember(l.memberId)?.email ?? null,`
- **Problem:** `overdueReport` now returns the email of every member who has an overdue loan, but it never calls `logAccess(db, user, memberId, purpose)` from `src/audit.js`. The neighbouring `memberCard` does log (`app/src/members.js:16`, `logAccess(db, user, m.id, "member-card")`). R2 requires one log entry for every member whose data a function returns, and lists count. Each run of the report now hands staff a list of emails with no record of who read them. Being staff-only does not exempt a function from R2. The updated test (`app/test/loans.test.js:48`) checks the email value but never checks `db.accessLog`, so the missing log goes unnoticed (R8).
- **Fix:** Call `logAccess(db, user, l.memberId, "overdue-report")` once for each member whose email the report returns. Add a test that checks the exact `db.accessLog` entries after a report run (ids `5, 2, 1` and the `purpose` string), as the `memberCard` test does.

### B2. [medium] R19 — Member-name `Map` replaced with two `findMember` scans per row
- **Where:** `app/src/loans.js:53-54`
- **Evidence:** `-  const names = new Map(db.members.map((m) => [m.id, m.name]));` / `+      member: db.findMember(l.memberId)?.name ?? "—",` / `+      email: db.findMember(l.memberId)?.email ?? null,`
- **Problem:** `db.findMember` is `members.find((m) => m.id === id)` (`app/src/db.js:42`), which scans the whole members list. The PR removes the index built once per call and instead scans `members` twice for every overdue loan. The cost is now overdue loans × members, both of which grow without limit. R19 counts replacing an existing index with a per-item scan as a defect even though the result is the same today. (The `findBook` scan per row is already in the base code and is not this PR's finding.)
- **Fix:** Keep the `Map`, but map `id` to the member record (`new Map(db.members.map((m) => [m.id, m]))`). Look each member up once per row and read both `name` and `email` from that one record.

### B3. [medium] R6 — New result fields `email` and `feeText` with no CHANGELOG entry
- **Where:** `missing: app/CHANGELOG.md entry for overdueReport`
- **Evidence:** `+      email: db.findMember(l.memberId)?.email ?? null,` / `+      feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",`
- **Problem:** The PR adds two result fields to the exported `overdueReport`, which is a contract change. These changes are in the body, not on an `export` line, so the deterministic check does not catch them. The diff does not touch `app/CHANGELOG.md`. The existing entry still lists only `loanId`, `member`, `book`, `daysLate`, `feeKopecks`.
- **Fix:** Add an entry that names `overdueReport` and the new `email` field, its type (`string | null`) and that each read is logged. If `feeText` is kept, the entry must name it too, but see B4: it should be dropped.

### B4. [high] R10 — Description leaves out the new `feeText` field
- **Where:** `app/src/loans.js:58`, `review-queue/pr-2/PR.md:4`
- **Evidence:** `Тепер для кожного рядка беремо учасника і віддаємо ім'я та email.` vs `+      feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",`
- **Problem:** The description says the PR adds the name and email. The diff also adds `feeText`, a hand-formatted hryvnia string that the description never mentions. That is an undocumented behaviour and contract change. The formatting itself (`toFixed`, `грн`) breaks R4; the deterministic script reports it. `lateFee` is also called a second time per row.
- **Fix:** Remove `feeText`, since the client formats `feeKopecks` (R4). Otherwise, describe it in `PR.md` and the CHANGELOG, though R4 would still block it.

## Minor findings

### M1. [low] R17 — Doc comment not updated for the new email field
- **Where:** `app/src/loans.js:43-46`
- **Evidence:** ` * Staff-only report: every loan still out past its due date, with the` / ` * member's name. Built for the weekly reminder calls.`
- **Problem:** The doc comment above `overdueReport` still says the function returns "the member's name". It now also returns personal data (email), and readers of the comment should know that, including that the reads are logged.
- **Fix:** Update the comment to say that each row includes the member's email and that each read is recorded in the access log.

## Untrusted content

None.

## Questions for the author

- `overdueReport` returns every overdue loan in one unpaged list. That comes from the base code, and this PR only changes what each row holds. Now that each row carries an email, should the report get paging with a maximum page size, so one call can't export emails in bulk?
- The report was "built for the weekly reminder calls". Is email the only contact detail staff need, or will `phone` follow? If so, it will need the same logging.