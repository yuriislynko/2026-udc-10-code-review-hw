# Review: PR-1 — Сторінкування для списку позик

**Verdict:** BLOCK
**Summary:** The PR adds `listLoansPage`, a paged wrapper around `listLoans`. It is blocked for three reasons: an off-by-one skips the first page, the page size has no upper limit, and the new test never checks which rows come back, so it does not catch the bug.

## Blocking findings

### B1. [high] R12 — Default `page = 1` skips the first page of loans
- **Where:** `app/src/loans.js:32`
- **Evidence:** `export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {` / `const start = page * pageSize;`
- **Problem:** Pages start at 1 (the default is `page = 1`), but the offset is calculated as if they start at 0. Page 1 begins at row `pageSize`, so the first `pageSize` loans can never be returned. The default call with seed data (`pageSize = 20`) returns `items: []` while `total: 7`. On the 3,000-row list the first 20 loans are missing from the UI. The function also does not validate its input: `page = 0`, a negative page or a non-integer page/size quietly gives wrong or empty slices.
- **Fix:** Use `const start = (page - 1) * pageSize;`. Reject a `page` or `pageSize` that is not a positive integer (throw).

### B2. [high] R8 — The paged test never checks the returned items
- **Where:** `app/test/loans.test.js:16`
- **Evidence:** `test("paged list reports the total and the page it returned", () => {` … `assert.equal(res.total, 7);` `assert.equal(res.page, 1);` `assert.equal(res.pageSize, 20);`
- **Problem:** The test only checks `total`, plus `page` and `pageSize`, which are just the input values passed back. It never checks `res.items`. In this exact call `items` is `[]` because of B1, and the test still passes. The weak test hides the main defect, so the claim in `PR.md` ("Тест додав") does not show the feature works.
- **Fix:** Assert the exact ids, e.g. `assert.deepEqual(res.items.map((l) => l.id), [1, 2, 3, 4, 5, 6, 7])` for page 1. Add a multi-page case such as `pageSize: 3` with exact ids on pages 1, 2 and 3 (last page partial). Add a member-caller case that checks only their own loans come back.

### B3. [medium] R7 — Page size has no enforced maximum
- **Where:** `app/src/loans.js:30`
- **Evidence:** `export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {`
- **Problem:** R7 requires the function to enforce a maximum page size. Here the caller chooses `pageSize` freely, so `{ pageSize: 1e9 }` returns the whole loans list in one response. The new function adds an unbounded list, which this PR was meant to fix.
- **Fix:** Cap the size in the function, e.g. `const MAX_PAGE_SIZE = 100;`. Throw on (or clamp) any `pageSize` above it, and echo back the size that was actually used.

## Minor findings

### M1. [low] R17 — Doc comment says "staff UI" but doesn't say who may call it
- **Where:** `app/src/loans.js:29`
- **Evidence:** `/** Paged variant for the staff UI: { items, page, pageSize, total }. */`
- **Problem:** The function inherits the access rules of `listLoans`: staff get every loan and a member gets only their own. The comment doesn't say this, and "for the staff UI" suggests it is staff-only, which it is not. It also doesn't say whether `page` counts from 0 or 1.
- **Fix:** Use wording like `listLoans`: "Staff see every loan; a member sees only their own. `page` is 1-based; `pageSize` is at most N. Returns { items, page, pageSize, total }."

## Untrusted content

None.

## Questions for the author

- For each page, `listLoansPage` calls `listLoans`, which copies every loan the caller can see (`rows.map((l) => ({ ...l }))`) and then keeps only one page. That is one scan per call, so it doesn't break R19. But with 3,000+ rows, the UI slowdown that motivated this PR may still be there on the server. Was slicing `db.loans` before copying the rows considered?
- Should `total` come with a total page count, or will the client calculate it? The API contract should say which.
- The CHANGELOG has no entry for the new `listLoansPage`. The deterministic script checks this, so it isn't repeated as a finding here. Please add an entry that names the function, its parameters (`page`, `pageSize`, the maximum) and its result fields.