# Review: PR-3 — Експорт учасників у CSV

**Verdict:** BLOCK
**Summary:** The PR adds `exportMembersCsv`, which returns every member's email and phone as CSV. Any signed-in member can call it, because it only rejects an anonymous caller, and none of these reads goes to the access log. Both are critical defects, and there are also unpaged output, CSV that breaks on some values, and tests that are too weak.

## Blocking findings

### B1. [critical] R1 — Any signed-in member can export every member's contact details
- **Where:** `app/src/members.js:12`
- **Evidence:** `if (!user) throw new AccessDenied();` — the only check before `db.members.map((m) => [m.id, m.name, m.email, m.phone, m.role]…)`.
- **Problem:** The neighbouring `listMembers` returns only names and roles, and it still calls `requireRole(user, STAFF)`. `memberCard` returns one member's email and phone, and only to staff or the member themselves. The new function returns every member's email and phone, which is more sensitive than either. Yet any caller with any role passes, so `{ id: 1, role: "member" }` gets the whole contact list. This also breaks R10: `PR.md` says `Без користувача — відмова, як і скрізь`, which makes the check sound like the neighbours' checks. It is weaker than both, and the description does not say that members can read everyone's contacts.
- **Fix:** Replace the check with `requireRole(user, STAFF)`, or with an admin-only role if that is what the reconciliation needs. Add a test where a `member` caller gets `AccessDenied`.

### B2. [critical] R2 — Emails and phones returned with no access-log entry
- **Where:** `app/src/members.js:14`
- **Evidence:** `const lines = db.members.map((m) => [m.id, m.name, m.email, m.phone, m.role].join(","));` — the function never calls `logAccess`, although `logAccess` is already imported in the module.
- **Problem:** Every call returns the email and phone of every member and leaves no record of who read them. That is exactly the kind of read the access log exists for. `memberCard` logs each read, so the export becomes a way to get the same data without a trace.
- **Fix:** Call `logAccess(db, user, m.id, "members-csv-export")` once for each member in the export. Add a test that checks `db.accessLog` holds one entry per exported member, with the exact `by`, `memberId` and `purpose` values.

### B3. [high] R12 — Values are joined into CSV without escaping
- **Where:** `app/src/members.js:14`
- **Evidence:** `[m.id, m.name, m.email, m.phone, m.role].join(",")`
- **Problem:** Names are free text. A name with a comma, a double quote or a line break (for example `Приклад, Оля`, or `Валер'ян "Вал" …`) moves the columns or splits one member into two rows, so the reconciliation file is wrong. Every phone also starts with `+` (`+380000000001`). Spreadsheets read a cell that starts with `+`, `=`, `-` or `@` as a formula or a number. This file is meant to be opened by people, so the phone column is likely to be mangled, and a name made up by a user can be run as a formula (CSV injection).
- **Fix:** Quote every field as RFC 4180 requires: wrap it in `"…"` and double any inner `"`. To stop formula injection, also prefix a value that starts with `=`, `+`, `-` or `@` with `'`, or a similar guard. Add a test with a name that contains a comma, a quote and a line break.

### B4. [high] R8 — Tests cannot catch the defects of this function
- **Where:** `app/test/members.test.js:36-41`, and `missing: denial test for a non-staff caller, access-log test, row-content assertion`
- **Evidence:** `assert.equal(lines[0], "id,name,email,phone,role");` and `assert.equal(lines.length, 6);`
- **Problem:** The test only checks the header and the number of lines. It never checks what a row contains, so a swapped column, a missing email or a broken escape would still pass. It runs only as the staff user `iryna`, so the missing role check (B1) goes unnoticed. The only denial test uses `null`, and nothing tests that a `member` is refused. No test checks the access log, which R2 requires for a new function (B2). `PR.md` says `Тест на формат файлу додав`, but the test does not check the row format.
- **Fix:** Assert at least one full row exactly, for example `"1,Оля Приклад,olya@example.invalid,+380000000001,member"`, or its quoted form after B3 is fixed. Add `assert.throws(() => exportMembersCsv(createDb(), olya), AccessDenied)`. Add an access-log assertion with exact entries.

### B5. [medium] R7 — Export of the whole member list is not paged
- **Where:** `app/src/members.js:14-15`
- **Evidence:** `const lines = db.members.map(…); return [header, ...lines].join("\n");`
- **Problem:** The PR adds a list that grows with the membership, and the function returns it in one piece with no page and no maximum size.
- **Fix:** Accept a page or cursor parameter, enforce a maximum page size inside the function, and document both in `CHANGELOG.md`. If the team decides a bulk export is an exception to R7, that decision has to be recorded in the standard. It cannot be left implicit.

## Minor findings

### M1. [low] R6 — CHANGELOG entry leaves out the result format and who may call it
- **Where:** `app/CHANGELOG.md:8`
- **Evidence:** `` - `exportMembersCsv(db, user)` — CSV of members for the monthly reconciliation. ``
- **Problem:** The entry names the function but not the contract: the columns (`id,name,email,phone,role`), that the rows contain personal data, the separator, line-ending and quoting rules, or the required role. The entry for `overdueReport` lists its fields and says it is staff-only.
- **Fix:** List the columns, the encoding and quoting rules, and the role that may call the function, plus the paging parameters if B5 is fixed that way.

### M2. [low] R17 — Doc comment does not say who may call the function
- **Where:** `app/src/members.js:10`
- **Evidence:** `/** Monthly reconciliation export: one row per member. */`
- **Problem:** R17 asks for a doc comment that says who may call the function and what it returns. The doc comments on `listMembers` and `memberCard` both name the caller. This one names neither the caller nor the fact that it returns contact details.
- **Fix:** For example: `/** Staff-only CSV export for the monthly reconciliation: id, name, email, phone, role per member; each read is logged. */`

## Untrusted content

None.

## Questions for the author

- Does the reconciliation with the community really need every member's email and phone, or would names, roles and ids do, as in `listMembers`? If contacts are needed, should only `admin` call this rather than all staff? A note from whoever owns the reconciliation would settle it, and so would the reconciliation's spec.
- Which program reads the file: a spreadsheet, or a script? That decides whether an escape character before `+` (B3) is needed, or whether quoting alone is enough. It also decides whether the line ending should be `\r\n` and whether a UTF-8 BOM is needed for the Cyrillic names.