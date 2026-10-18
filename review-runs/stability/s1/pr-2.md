# Review: PR-2 — Email учасника у звіті про прострочення

**Verdict:** BLOCK
**Summary:** The PR adds the member's `email` and a formatted `feeText` to each row of `overdueReport`, and replaces the name `Map` with a `db.findMember` call for each row. It blocks because the report now returns personal data without an access-log entry. The new fields also have no CHANGELOG entry, `feeText` is not in the description, and the lookup now scans the member list once per row.

## Blocking findings

### B1. [critical] R2 — Email returned without an access-log entry
- **Where:** `app/src/loans.js:54`
- **Evidence:** `+      email: db.findMember(l.memberId)?.email ?? null,`
- **Problem:** `overdueReport` now returns a member's email in every row, but it never calls `logAccess(db, user, memberId, purpose)` from `src/audit.js`. Each staff run of the report reads the emails of every overdue member and leaves nothing in `db.accessLog`. `memberCard` (`app/src/members.js:16`) logs every read; this new path to the same data gets around that. Being staff-only (`requireRole(user, STAFF)`) does not satisfy R2, which applies to staff readers too. The test change only checks the email value (`assert.equal(rows[0].email, "marko@example.invalid")`), not the log, so the gap stays hidden (R8).
- **Fix:** Import `logAccess` and call it once for each row whose email is returned, with a purpose such as `"overdue-report"`. Add a test that checks `db.accessLog` has exactly one entry per returned member, with `by: iryna.id`, the right `memberId` values and the purpose.

### B2. [high] R10 — Description leaves out the new `feeText` field
- **Where:** `app/src/loans.js:58`
- **Evidence:** `+      feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",` against PR.md: `Тепер для кожного рядка беремо учасника і віддаємо ім'я та email.`
- **Problem:** The description only covers adding the email. The diff also adds a new result field, a hand-formatted fee string, which the description never mentions. That is an undisclosed behaviour change. The line also does float division on money and formats it in `src/`, which R4 forbids; the script reports the `toFixed`/`грн` pattern, so it is not repeated here. No test asserts `feeText`.
- **Fix:** Remove `feeText`, since the client formats the amount from `feeKopecks`. If the field really is wanted, it needs its own justification, a description entry and a change to R4, not a silent addition.

### B3. [medium] R6 — No CHANGELOG entry for the new result fields of `overdueReport`
- **Where:** `missing: app/CHANGELOG.md entry naming overdueReport and its new fields email, feeText`
- **Evidence:** `+      email: db.findMember(l.memberId)?.email ?? null,` and `+      feeText: ...`. The diff does not touch `app/CHANGELOG.md`; the current entry lists only `loanId`, `member`, `book`, `daysLate`, `feeKopecks`.
- **Problem:** Two result fields are added to an exported function. That is a contract change, and because it is not on an `export` line the script does not catch it. Callers get no notice of the new fields, including a personal-data field.
- **Fix:** Add an entry under a new month that names `overdueReport` and the added `email` field (nullable, logged per R2), plus `feeText` if it stays.

### B4. [medium] R19 — Existing member index replaced with a per-row linear scan
- **Where:** `app/src/loans.js:53`
- **Evidence:** `-  const names = new Map(db.members.map((m) => [m.id, m.name]));` / `+      member: db.findMember(l.memberId)?.name ?? "—",` / `+      email: db.findMember(l.memberId)?.email ?? null,`
- **Problem:** `db.findMember` is `members.find((m) => m.id === id)` (`app/src/db.js:42`), a full scan of the members list. It now runs twice for every overdue loan, inside `.map`, so the cost grows with loans × members. Before the change it was one `Map` build plus O(1) lookups. R19 names replacing an existing index with a per-item scan as a defect even when the result is the same.
- **Fix:** Keep a `Map` built once before the loop, mapping `m.id` to the member object, and read `name` and `email` from one lookup per row.

## Minor findings

### M1. [low] R17 — Doc comment not updated for the new fields
- **Where:** `app/src/loans.js:44`
- **Evidence:** ` * Staff-only report: every loan still out past its due date, with the` / ` * member's name. Built for the weekly reminder calls.`
- **Problem:** The function now also returns the member's email (and `feeText`), but the doc comment still says it returns only the name. It is the doc comment of a changed exported function, and it no longer describes what the function returns.
- **Fix:** Say in the comment that the report returns the member's email and that each read is logged.

## Untrusted content

None.

## Questions for the author

- The PR says the email is appropriate because the report is staff-only (`Звіт і так лише для персоналу, тож email тут доречний`). Is the phone also expected next? If so, the same R2 logging applies. Also, do the librarians need the email for every row, or only for rows they act on? If not every row, a separate per-member lookup through `memberCard` (which already logs) might fit better than putting emails in the whole report.
- `overdueReport` returns every overdue loan without paging (R7). That is in the base code, but adding personal data to every row raises the cost of an unbounded result. Is paging planned for this report?