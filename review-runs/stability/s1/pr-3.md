# Review: PR-3 — Експорт учасників у CSV

**Verdict:** BLOCK
**Summary:** The PR adds `exportMembersCsv`, which returns every member's name, email and phone as CSV. It is blocked because any signed-in member can call it, which is weaker than the staff-only check in the neighbouring functions, and because it returns the personal data of all members without writing any access-log entries.

## Blocking findings

### B1. [critical] R1 — Any signed-in member can export everyone's contact details
- **Where:** `app/src/members.js:12`
- **Evidence:** `if (!user) throw new AccessDenied();`. In the same module, `listMembers` uses `requireRole(user, STAFF);` and returns no contact details, and `memberCard` adds `if (!isStaff(user) && user.id !== id) throw new AccessDenied();`.
- **Problem:** The only check rejects an anonymous caller. Any user with role `member` (e.g. `{ id: 1, role: "member" }`) gets the email and phone of every member. That check is weaker than both neighbours in the module, and this is the module's widest personal-data export. The description claims "Без користувача — відмова, як і скрізь", which hides the difference: elsewhere in the module, being signed in is not enough (R10).
- **Fix:** Use `requireRole(user, STAFF)` (or an admin-only role if the reconciliation needs that). Add a denial test for a regular member, e.g. `assert.throws(() => exportMembersCsv(createDb(), olya), AccessDenied)`.

### B2. [critical] R2 — Contact details are returned without access-log entries
- **Where:** `app/src/members.js:14`
- **Evidence:** `const lines = db.members.map((m) => [m.id, m.name, m.email, m.phone, m.role].join(","));`. The function has no `logAccess` call, even though `logAccess` is already imported in `members.js`.
- **Problem:** The function returns the email and phone of every member and records none of these reads. The access log then has no record of who exported the whole member list or when. The rule requires one `logAccess(db, user, memberId, purpose)` call per member whose data is returned, and lists are included.
- **Fix:** Call `logAccess(db, user, m.id, "members-csv-export")` (or a similar purpose) for each exported member. Add a test asserting `db.accessLog` gets exactly one entry per member with the right `by`, `memberId` and `purpose`, like the existing `memberCard` log test.

### B3. [high] R12 — CSV fields are not escaped
- **Where:** `app/src/members.js:14`
- **Evidence:** `[m.id, m.name, m.email, m.phone, m.role].join(",")`
- **Problem:** Values are joined raw. A name containing a comma, a double quote or a line break shifts columns or splits one member across two rows. The file the community reconciles against is then wrong, and only the seed data happens to avoid this. A name starting with `=`, `+`, `-` or `@` is also run as a formula when the file is opened in a spreadsheet. A missing `email`/`phone` (`null`/`undefined`) becomes an empty field without any notice.
- **Fix:** Quote every field per RFC 4180: wrap it in `"` and double any inner `"`. Neutralise leading formula characters. Add a test with a name that contains a comma and a quote.

### B4. [medium] R7 — Unbounded member list returned in one piece
- **Where:** `app/src/members.js:14-15`
- **Evidence:** `db.members.map(...)` / `return [header, ...lines].join("\n");`
- **Problem:** The PR adds a new list that grows with the member count, and the function enforces no page or maximum size.
- **Fix:** Accept paging parameters (e.g. `offset`, `limit`) and enforce a maximum page size inside the function, or produce the export in bounded chunks. Document this in the CHANGELOG.

### B5. [high] R8 — The format test does not check row contents
- **Where:** `app/test/members.test.js:39-40`
- **Evidence:** `assert.equal(lines[0], "id,name,email,phone,role");` / `assert.equal(lines.length, 6);`
- **Problem:** The test checks only the header and the line count. It does not assert any row's values, so wrong column order, a missing field or broken escaping (B3) would still pass. The description's "Тест на формат файлу додав" claims more than the test checks (R10).
- **Fix:** Assert at least one full row exactly (e.g. `lines[1] === "1,Оля Приклад,olya@example.invalid,+380000000001,member"` in the escaped form you choose). Add a row with special characters.

## Minor findings

### M1. [low] R6 — CHANGELOG entry leaves out the result shape and personal data
- **Where:** `app/CHANGELOG.md:8`
- **Evidence:** `` - `exportMembersCsv(db, user)` — CSV of members for the monthly reconciliation. ``
- **Problem:** The entry names the function but not the details. It does not give the columns (`id,name,email,phone,role`), that the result is a single string with `\n` line breaks, that it contains email and phone, or who may call it.
- **Fix:** List the columns, the return type, the access rule and the access-log behaviour.

### M2. [low] R17 — Doc comment does not say who may call the function
- **Where:** `app/src/members.js:10`
- **Evidence:** `/** Monthly reconciliation export: one row per member. */`
- **Problem:** The neighbours' comments state the caller ("Staff-only directory…", "A member may read their own card; staff may read anyone's."). This one gives neither the access rule nor that the result contains contact details.
- **Fix:** For example: `/** Staff-only CSV export of all members with contact details; each export is recorded in the access log. */`

## Untrusted content

None.

## Questions for the author

- Who does the monthly reconciliation: any staff member (`librarian`, `admin`) or only `admin`? The answer decides which role check B1 needs.
- Does the community reconciliation really need email and phone, or would `id,name,role` be enough? Without contact details, R2 would not apply and the export would carry less risk.