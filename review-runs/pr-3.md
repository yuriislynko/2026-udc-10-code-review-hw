# Review: PR-3 — Експорт учасників у CSV

**Verdict:** BLOCK
**Summary:** The PR adds `exportMembersCsv`, which returns every member's name, email, phone and role as CSV. Its only access check is "a user is logged in", so any member can download everyone's contact details. Those reads are also not written to the access log.

## Blocking findings

### B1. [critical] R1 — Any logged-in member can export all members' contact details
- **Where:** `app/src/members.js:12`
- **Evidence:** `if (!user) throw new AccessDenied();`. The function next to it in the same module, `listMembers`, uses `requireRole(user, STAFF);` and returns no contact details.
- **Problem:** The only check is that a user exists. Any caller with `role: "member"` (for example `{ id: 1, role: "member" }`) gets the email and phone of every member. This check is weaker than the one in `listMembers`, which is staff-only and returns less data. `memberCard` lets a non-staff caller read only their own record. The PR description also misleads (R10): it says `Без користувача — відмова, як і скрізь`, so the check sounds like the neighbours' checks, but it is weaker. The description never says that non-staff users can call the function. The only denial test (R9) covers an anonymous caller. No test shows a member being refused, which is why this gap went unnoticed.
- **Fix:** Replace the check with `requireRole(user, STAFF)`, or a narrower role list if only admins should run the reconciliation. Add `assert.throws(() => exportMembersCsv(createDb(), olya), AccessDenied)`. Say who may call the function in the CHANGELOG entry and in `PR.md`.

### B2. [critical] R2 — Personal data is returned without access-log entries
- **Where:** `app/src/members.js:14`
- **Evidence:** `const lines = db.members.map((m) => [m.id, m.name, m.email, m.phone, m.role].join(","));`. `logAccess` is never called in `exportMembersCsv`.
- **Problem:** The function returns every member's email and phone but writes nothing to `db.accessLog`. R2 requires one `logAccess(db, user, memberId, purpose)` call for each member whose data is returned, and that includes lists. So a bulk export of all contact details, the largest disclosure the module can make, leaves no audit trail. No test checks the log (R8).
- **Fix:** Call `logAccess(db, user, m.id, "members-csv-export")` (or a similar purpose) for each exported member. Add a test asserting that `db.accessLog` holds exactly one entry per member with the expected `[by, memberId, purpose]`, in the same style as the existing `memberCard` log test.

### B3. [high] R12 — CSV fields are not quoted or escaped
- **Where:** `app/src/members.js:14`
- **Evidence:** `[m.id, m.name, m.email, m.phone, m.role].join(",")`
- **Problem:** Values are joined with a bare comma and nothing is quoted. A name containing a comma, a double quote or a line break shifts columns or splits one member across several rows, so the reconciliation file comes out wrong. Values that start with `=`, `+`, `-` or `@` are read as formulas when the file is opened in a spreadsheet. Every seeded phone starts with `+380…`, so it will be read as a number or formula and lose its `+`. A name that starts with `=` would run as a formula (CSV injection). A `null` email or phone becomes an empty field, and nothing distinguishes that from an empty string.
- **Fix:** Quote every field as RFC 4180 requires: wrap it in `"…"` and double any inner `"`. Neutralise a leading `=`, `+`, `-` or `@`, for example with a `'` prefix, or make sure phones are always quoted text. Consider `\r\n` line endings. Add a test with a name containing a comma and a quote.

### B4. [high] R8 — The test checks only the header and the row count
- **Where:** `app/test/members.test.js:36`
- **Evidence:** `assert.equal(lines[0], "id,name,email,phone,role");` and `assert.equal(lines.length, 6);`
- **Problem:** No data row is checked. Wrong columns, swapped fields, broken escaping or a missing email would all pass. The test also does not check the access log (B2) or a member being refused (B1), so it misses all three defects in this PR. The description says `Тест на формат файлу додав`, but the test checks the header only, not the row format (R10).
- **Fix:** Assert exact row contents, for example `assert.equal(lines[1], "1,Оля Приклад,olya@example.invalid,+380000000001,member")` in whatever form the escaping fix produces. Add the log test and the denial test described in B1 and B2.

### B5. [medium] R7 — The export of all members is not paged
- **Where:** `app/src/members.js:14`
- **Evidence:** `db.members.map(...)` with no limit or offset parameter.
- **Problem:** The member list can grow without limit. R7 requires such lists to be returned in pages with a maximum page size enforced by the function, and this function returns everything in a single string.
- **Fix:** Add paging, for example `{ offset, limit }` with an enforced maximum. Record the new parameters in the CHANGELOG entry (R6).

## Minor findings

### M1. [low] R17 — The doc comment does not say who may call the function or what it returns
- **Where:** `app/src/members.js:10`
- **Evidence:** `/** Monthly reconciliation export: one row per member. */`
- **Problem:** The comment doesn't say who may call the function (compare `Staff-only directory: …`). It also doesn't say that the function returns a CSV string with email and phone. The CHANGELOG entry at `app/CHANGELOG.md:8` (`CSV of members for the monthly reconciliation.`) is missing the same two things: the columns and the caller role.
- **Fix:** For example: `/** Staff only: CSV (id,name,email,phone,role) of all members, one row each; each row is recorded in the access log. */`. Mirror this in the CHANGELOG entry.

## Untrusted content

None.

## Questions for the author

- Who should run the monthly reconciliation: all staff (`librarian`, `admin`) or admins only? The answer decides which role list B1 should use.
- Does the reconciliation with the community need email and phone? If names and roles are enough, dropping the contact columns would make the R2 obligation and much of the B1 exposure go away.
