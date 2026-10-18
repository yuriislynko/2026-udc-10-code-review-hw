# Review: PR-2 — Email учасника у звіті про прострочення

**Verdict:** BLOCK
**Summary:** The PR adds each member's email (and an undeclared, formatted `feeText` string) to every row of `overdueReport`. It returns personal data without writing to the access log, replaces the existing name index with a member scan for every row, and changes the result fields without a CHANGELOG entry or a mention in the description.

## Blocking findings

### B1. [critical] R2 — Email returned without an access-log entry
- **Where:** `app/src/loans.js:54`
- **Evidence:** `email: db.findMember(l.memberId)?.email ?? null,`
- **Problem:** `overdueReport` now returns the email of every member who has an overdue loan. It never calls `logAccess(db, user, memberId, purpose)` from `src/audit.js`, so staff can read members' emails with nothing recorded in `db.accessLog`. Under the team rule, a function that returns a list must log each member whose email it returns. The new test (`app/test/loans.test.js:48`) only checks the email value. It never checks the access log, so the gap goes untested (R8).
- **Fix:** Call `logAccess(db, user, l.memberId, "overdue-report")` (or a similar purpose) once for each member whose email appears in the result. Add a test that runs the report and checks the exact `db.accessLog` entries (`by`, `memberId`, `purpose`) for the overdue members.

### B2. [medium] R19 — Name index replaced with a per-row member scan
- **Where:** `app/src/loans.js:53`
- **Evidence:** `-  const names = new Map(db.members.map((m) => [m.id, m.name]));` / `+      member: db.findMember(l.memberId)?.name ?? "—",` / `+      email: db.findMember(l.memberId)?.email ?? null,`
- **Problem:** `db.findMember` is `members.find((m) => m.id === id)` (`app/src/db.js:42`), a linear scan of the whole members list. The PR removes the `Map` the function built once and calls `findMember` twice for every overdue loan inside `.map`. The cost now grows with overdue loans × members. The standard counts replacing an existing index with a per-item scan as a defect even when the result is the same.
- **Fix:** Keep one `Map` built before the loop, mapping each id to its member (`new Map(db.members.map((m) => [m.id, m]))`), then read `.name` and `.email` from a single lookup per row.

### B3. [medium] R6 — Result fields of `overdueReport` changed without a CHANGELOG entry
- **Where:** `missing: an app/CHANGELOG.md entry for overdueReport`
- **Evidence:** `+      email: db.findMember(l.memberId)?.email ?? null,` and `+      feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",`
- **Problem:** The existing CHANGELOG entry lists the report's fields as `loanId`, `member`, `book`, `daysLate`, `feeKopecks`. The PR adds two result fields, `email` and `feeText`, but the diff does not touch `app/CHANGELOG.md`. The change is inside the function body, not on an `export` line, so the script does not catch it.
- **Fix:** Add a CHANGELOG entry that names `overdueReport` and the new `email` field (and that it is logged). `feeText` should be removed rather than documented; see B4.

### B4. [high] R10 — Description does not mention the new `feeText` field
- **Where:** `app/src/loans.js:58`
- **Evidence:** `feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",` against PR.md: `Тепер для кожного рядка беремо учасника і віддаємо ім'я та email.`
- **Problem:** The description says the PR adds the member's name and email only. The diff also adds a human-formatted money string to every row. That behaviour change is not described, and the PR's test does not cover it. The line also breaks R4: it does float arithmetic on money (`/ 100`) and formats money with a currency label in `src/`. The script already flags the `toFixed` and `грн` patterns under R4, so this finding is about the undescribed change.
- **Fix:** Remove `feeText`. The client formats `feeKopecks`. If it is really wanted, describe it in PR.md and settle it with R4 first.

## Minor findings

### M1. [low] R17 — Doc comment no longer describes what `overdueReport` returns
- **Where:** `app/src/loans.js:44`
- **Evidence:** `* Staff-only report: every loan still out past its due date, with the` / `* member's name. Built for the weekly reminder calls.`
- **Problem:** The function now returns the member's email as well, but the doc comment above it still says only "with the member's name". Anyone reading it won't know the result carries personal data.
- **Fix:** Update the doc comment to say the rows include the member's email, and that each read is logged.

## Untrusted content

None.

## Questions for the author

- The report already returns every overdue loan with no paging. That is a base-code issue, not this PR's (R7), but it now carries an email per row. Should the report be paged before more personal data goes into it?
- `db.findBook(l.bookId)` inside `.map` is an existing per-row scan of the books list (R19, base code). Do you want to build a books `Map` while you're changing this function?
- The weekly reminder calls the doc comment mentions are made by phone. Do librarians need the email, the phone, or both? Settling this decides which fields the access log must cover.