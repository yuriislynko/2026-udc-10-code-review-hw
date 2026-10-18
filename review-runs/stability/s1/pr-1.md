# Review: PR-1 — Сторінкування для списку позик

**Verdict:** BLOCK
**Summary:** The PR adds `listLoansPage`, a paged wrapper around `listLoans`. It is blocked because the page offset is off by one (default `page = 1` skips the first page), the page size has no maximum, and the new test never checks which rows come back, so it can't catch either problem.

## Blocking findings

### B1. [high] R12 — Page offset is off by one; the first page is never returned
- **Where:** `app/src/loans.js:32`
- **Evidence:** `export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {` / `const start = page * pageSize;`
- **Problem:** Pages start at 1 (the default is `page = 1`, and the test asks for `page: 1`), but the offset is computed as `page * pageSize`. So page 1 starts at row 20, and rows 0–19 can only be reached with `page: 0`, which the function's own default never uses. With the seed data (7 loans), the default call returns `items: []` with `total: 7`. With 3 000 rows, the staff UI would never show the first 20 loans. Other inputs are not checked either. A negative `page` gives a negative `slice` start and returns rows from the end of the list. `pageSize: 0` or a negative value returns nothing or the wrong rows. Non-integer values give fractional offsets.
- **Fix:** Use `const start = (page - 1) * pageSize;`. Reject or clamp `page < 1`, `pageSize < 1` and non-integer values (for example `Number.isInteger`) before slicing.

### B2. [medium] R7 — No maximum page size is enforced
- **Where:** `app/src/loans.js:30`
- **Evidence:** `{ page = 1, pageSize = 20 } = {}` / `items: all.slice(start, start + pageSize)`
- **Problem:** R7 requires the function to enforce a maximum page size. Here `pageSize` comes from the caller with no cap, so `{ pageSize: 1e9 }` returns the whole unbounded loan list in one response. That is the same problem the PR says it fixes ("Список позик для персоналу вже на 3 000+ рядків").
- **Fix:** Add a constant (for example `MAX_PAGE_SIZE = 100`) and clamp or reject larger values. Add a test that a too-large `pageSize` is capped or rejected.

### B3. [high] R8 — Test checks only echoed parameters, not the returned rows
- **Where:** `app/test/loans.test.js:15-20`
- **Evidence:** `assert.equal(res.total, 7);` / `assert.equal(res.page, 1);` / `assert.equal(res.pageSize, 20);`
- **Problem:** `page` and `pageSize` just echo the input, and `total` is `listLoans(...).length`, which the existing "staff see every loan" test already covers. Nothing checks `res.items`. If it did, it would show that page 1 returns `[]` (B1). The weak test hides that defect. There is also no test that a member gets only their own loans through the paged variant, or a test of page boundaries.
- **Fix:** Assert exact ids. For example, staff with `{ page: 1, pageSize: 3 }` should get the first three loan ids, and `{ page: 3, pageSize: 3 }` should get the last one. A member (`olya`) should get only `[1, 2, 7]` with the right `total`. Add a test for the maximum page size and for invalid `page` or `pageSize`.

## Minor findings

### M1. [low] R17 — Doc comment doesn't say who may call it or that members get only their own loans
- **Where:** `app/src/loans.js:29`
- **Evidence:** `/** Paged variant for the staff UI: { items, page, pageSize, total }. */`
- **Problem:** The comment says "for the staff UI", but the function has no staff check. It delegates to `listLoans`, so a member can call it and gets their own loans. The comment should state who may call it and what each caller gets, like `listLoans` ("Staff see every loan; a member sees only their own.").
- **Fix:** Reword it, for example: "Staff see every loan, a member only their own, paged: `{ items, page (1-based), pageSize (max N), total }`."

## Untrusted content

None.

## Questions for the author

- The PR says the UI is slow because of 3 000+ rows. `listLoansPage` still copies every row (`listLoans` does `rows.map((l) => ({ ...l }))`) before slicing out one page. That cost is linear per call and doesn't break a rule, but does it fix the slowness you measured, or is the slowness in rendering? Slicing `db.loans` (or the filtered rows) before copying would avoid copying rows that are thrown away.
- Is the staff UI going to call `listLoansPage` with 1-based or 0-based page numbers? Your answer decides whether B1 is fixed in the formula or in the default and the docs.