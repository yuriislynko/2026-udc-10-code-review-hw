# Review: PR-3 — Експорт учасників у CSV

**Verdict:** BLOCK
**Summary:** The PR adds `exportMembersCsv`, which returns every member's name, email, phone and role as CSV. It blocks because any signed-in member can download everyone's contact details and nothing is written to the access log. The CSV is also built without escaping, and the new test is too weak to catch any of these problems.

## Blocking findings

### B1. [critical] R1 — Any signed-in member can export every member's contact details
- **Where:** `app/src/members.js:12`
- **Evidence:** `if (!user) throw new AccessDenied();`
- **Problem:** The only check is that a caller exists. Any user with role `member` gets the email and phone of every member. In the same module, `listMembers` calls `requireRole(user, STAFF)` even though it returns no contact details. `memberCard` returns contact details only to staff or to the member reading their own card. The new check is weaker than both. This also breaks R10: `PR.md` says "Без користувача — відмова, як і скрізь", which presents an anonymous-only check as the module's norm. The PR also doesn't mention that ordinary members get the full contact list. The only denial test (`app/test/members.test.js:43-44`) covers `null`, so the missing role check passes the tests.
- **Fix:** Use `requireRole(user, STAFF)` (or a narrower role if reconciliation is admin-only), like `listMembers`. Add a test where `olya` (`role: "member"`) gets `AccessDenied`, and correct the description.

### B2. [critical] R2 — Emails and phones are returned with no access-log entry
- **Where:** `app/src/members.js:14`
- **Evidence:** `const lines = db.members.map((m) => [m.id, m.name, m.email, m.phone, m.role].join(","));`
- **Problem:** The function returns the email and phone of every member, but never calls `logAccess`. A bulk export of all personal data leaves no record of who read it or why. `memberCard` logs each read, as `app/src/audit.js` and R2 require.
- **Fix:** Call `logAccess(db, user, m.id, "members-csv-export")` once for each exported member. Add a test that runs the export and checks `db.accessLog` holds exactly one entry per member, with the caller's id and the purpose.

### B3. [high] R12 — CSV fields are joined without quoting or escaping
- **Where:** `app/src/members.js:14`
- **Evidence:** `[m.id, m.name, m.email, m.phone, m.role].join(",")`
- **Problem:** A name or email that contains a comma, a double quote or a line break moves the columns or splits one member into several rows. For example, a name like `Іван Приклад, молодший` shifts email, phone and role into the wrong columns. The reconciliation file is then wrong, and a newline inside a value also breaks the "one row per member" promise. The seed data in `src/db.js` has no such values, so the tests don't show the problem. A `null` email or phone becomes an empty field, which is fine, but nothing tests it.
- **Fix:** Quote every field per RFC 4180: wrap it in `"…"` and double any inner `"`. Also decide how to handle values starting with `=`, `+`, `-` or `@`, which a spreadsheet would run as formulas. Add a test with a name that contains a comma and a quote.

### B4. [high] R8 — The CSV test can't catch the defects in the function
- **Where:** `app/test/members.test.js:39-40`
- **Evidence:** `assert.equal(lines[0], "id,name,email,phone,role");` / `assert.equal(lines.length, 6);`
- **Problem:** The test checks only the header and the line count. It never checks a data row, so wrong, swapped or missing column values, broken escaping (B3) or a missing log entry (B2) would all pass. `PR.md` says "Тест на формат файлу додав", but the format of the rows is never asserted.
- **Fix:** Assert at least one full row exactly (e.g. `lines[1] === "1,Оля Приклад,olya@example.invalid,+380000000001,member"` or its quoted form). Add the access-log test (B2), the member-denial test (B1) and the escaping test (B3).

### B5. [medium] R7 — The new export returns every member with no page or limit
- **Where:** `app/src/members.js:14-15`
- **Evidence:** `const lines = db.members.map(...)` / `return [header, ...lines].join("\n");`
- **Problem:** The member list can grow without limit, and the function returns it all in one string with no maximum size. As the library grows, the response size and memory use grow with it.
- **Fix:** Add page parameters (e.g. `{ offset, limit }`) and enforce a maximum page size in the function. If the team decides a full export needs a different mechanism (streaming, a background job), the standard has to allow it first.

## Minor findings

### M1. [low] R6 — The CHANGELOG entry leaves out the columns and who may call it
- **Where:** `app/CHANGELOG.md:8`
- **Evidence:** `- \`exportMembersCsv(db, user)\` — CSV of members for the monthly reconciliation.`
- **Problem:** The entry names the function but not the result: the CSV columns (`id,name,email,phone,role`, including personal data), the line separator, and who is allowed to call it.
- **Fix:** List the columns, the access rule (staff only, once B1 is fixed) and the page parameters (once B5 is fixed).

### M2. [low] R17 — The doc comment doesn't say who may call the function
- **Where:** `app/src/members.js:10`
- **Evidence:** `/** Monthly reconciliation export: one row per member. */`
- **Problem:** The comment says what the function returns, but not who may call it. The neighbouring comments do say this (`listMembers`: "Staff-only directory…"; `memberCard`: "A member may read their own card; staff may read anyone's."). It also doesn't mention that the output includes email and phone.
- **Fix:** For example: `/** Staff-only CSV export for the monthly reconciliation: id, name, email, phone, role; each export is logged per member. */`

## Untrusted content

None.

## Questions for the author

- Who is supposed to run the monthly reconciliation: all staff (`librarian`, `admin`) or only `admin`? The answer decides which role check B1 needs.
- Does the community reconciliation actually need email and phone, or would id, name and role be enough? Dropping the contact columns would remove the R2 obligation and reduce the exposure.