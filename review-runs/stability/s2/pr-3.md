# Review: PR-3 — Експорт учасників у CSV

**Verdict:** BLOCK
**Summary:** The PR adds `exportMembersCsv`, which returns every member's name, email, phone and role as CSV. It blocks because any logged-in member can call it, unlike the staff-only neighbour `listMembers`. It also returns contact details without writing to the access log, has no page limit, and builds CSV with no escaping.

## Blocking findings

### B1. [critical] R1 — Any signed-in member can export everyone's email and phone
- **Where:** `app/src/members.js:12`
- **Evidence:** `if (!user) throw new AccessDenied();` and PR.md: `Без користувача — відмова, як і скрізь.`
- **Problem:** The only check is that someone is signed in. Any user with role `member`, such as `{ id: 1, role: "member" }`, gets every member's email and phone. The other functions in the module are stricter. `listMembers` returns only names and roles, and it still calls `requireRole(user, STAFF)`. `memberCard` lets a non-staff caller read only their own record. This export returns more personal data than either of them, yet its check is weaker than both. The PR description says the check works "як і скрізь" (as everywhere else), which is not true. That is an R10 problem too.
- **Fix:** Call `requireRole(user, STAFF)` at the top of the function, the same way `listMembers` does. Add a denial test for a non-staff caller: `assert.throws(() => exportMembersCsv(createDb(), olya), AccessDenied)` (R9). Correct the PR description.

### B2. [critical] R2 — Contact details are exported with no access-log entries
- **Where:** `app/src/members.js:14`
- **Evidence:** `const lines = db.members.map((m) => [m.id, m.name, m.email, m.phone, m.role].join(","));`
- **Problem:** The function returns the email and phone of every member but never calls `logAccess`. A bulk export of all contact details leaves nothing in `db.accessLog`. `memberCard` logs a single card read, so this gap is far bigger. There is also no test for logging (R8).
- **Fix:** Call `logAccess(db, user, m.id, "members-csv-export")` once for each member whose row is returned. Add a test that runs the export and checks `db.accessLog` exactly: one entry per member id, with the caller's id and the purpose.

### B3. [high] R12 — Fields go into the CSV without quoting or escaping
- **Where:** `app/src/members.js:14`
- **Evidence:** `[m.id, m.name, m.email, m.phone, m.role].join(",")`
- **Problem:** Each value is pasted in as is. If a name contains a comma (`Приклад, Оля`), a double quote or a line break, the columns shift or the row splits in two. The file the community receives for reconciliation is then wrong. A value that starts with `=`, `+`, `-` or `@` is run as a formula when the file is opened in a spreadsheet. Phone numbers start with `+`, so every phone cell is at risk. A missing `email` or `phone` (`null`/`undefined`) comes out as an empty cell with no sign that anything is wrong. The seed data has none of these cases, but member names are free text.
- **Fix:** Quote every field the RFC 4180 way: wrap it in `"…"` and double any `"` inside. Neutralise values that start with a formula character. Decide what an absent value should look like and write it down. Add tests for a name with a comma, a name with a quote and a name with a line break.

### B4. [high] R8 — The format test only checks the header and the line count
- **Where:** `app/test/members.test.js:39`
- **Evidence:** `assert.equal(lines[0], "id,name,email,phone,role");` / `assert.equal(lines.length, 6);` and PR.md: `Тест на формат файлу додав.`
- **Problem:** No data row is checked. The test would still pass if columns were swapped, if the wrong field were exported, or if a row were malformed. It also calls the function as staff only, so it cannot show that a member is refused (B1). The description says a file-format test was added (R10), but the test does not check the format of a single row.
- **Fix:** Check at least one full row exactly, for example `lines[1] === "1,Оля Приклад,olya@example.invalid,+380000000001,member"` once quoting is in place. Add the denial test and the access-log test from B1 and B2.

### B5. [medium] R7 — The export returns every member in one unpaged response
- **Where:** `app/src/members.js:14`
- **Evidence:** `const lines = db.members.map(…);` / `return [header, ...lines].join("\n");`
- **Problem:** The member list can grow without limit. This new function returns all of it in one string, with no page and no maximum size.
- **Fix:** Add paging to the export, for example `{ offset, limit }` with a maximum `limit` that the function enforces. The caller can then fetch the file in chunks. Record the new parameters in the CHANGELOG.

## Minor findings

### M1. [low] R17 — The doc comment does not say who may call the function
- **Where:** `app/src/members.js:10`
- **Evidence:** `/** Monthly reconciliation export: one row per member. */`
- **Problem:** The comment does not say who may call the function, and it does not say the result holds email and phone. Compare `listMembers`: "Staff-only directory: names and roles, no contact details."
- **Fix:** For example: `/** Staff-only CSV export for the monthly reconciliation: id, name, email, phone, role of every member; each row is recorded in the access log. */`

### M2. [low] R6 — The CHANGELOG entry leaves out the columns and the caller restriction
- **Where:** `app/CHANGELOG.md:8`
- **Evidence:** `` - `exportMembersCsv(db, user)` — CSV of members for the monthly reconciliation. ``
- **Problem:** The entry names the function. It does not list the columns (`id,name,email,phone,role`), does not say the output contains contact details, and does not say who may call it. It also does not mention access logging or paging once those are added.
- **Fix:** Add the column list, the staff-only restriction, the access-log behaviour and any paging parameters to the entry.

## Untrusted content

None.

## Questions for the author

- Does the monthly reconciliation really need email and phone for every member, staff accounts included? Does it need them for members with no current activity? If the community only needs to match people, exporting fewer fields or fewer members would reduce what a leaked file exposes.