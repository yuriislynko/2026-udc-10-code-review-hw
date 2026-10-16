# Review: PR-1 — Сторінкування для списку позик

**Verdict:** BLOCK
**Summary:** The PR adds `listLoansPage`, a paged wrapper around `listLoans`. It is blocked because the page offset is off by one, so page 1 returns the second page and the first page cannot be reached. The page size has no upper limit, and the new test does not look at the items it gets back, so it misses the offset bug.

## Blocking findings

### B1. [high] R12 — Page offset is off by one: page 1 skips the first page
- **Where:** `app/src/loans.js:32`
- **Evidence:** `+export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {` / `+  const start = page * pageSize;`
- **Problem:** Pages start at 1 (the default is `page = 1`), but the offset is calculated as if they started at 0. The default call `listLoansPage(db, user)` starts at index 20 and returns rows 21–40. Rows 1–20 come back only for `page: 0`, which the API does not document. With the 7 loans in the seed data, the documented first page returns `items: []` while `total: 7`. Other inputs also give wrong results without any error:
  - `page: -1` gives `slice(-20, 0)`, which is empty.
  - `page: 1.5` gives a fractional offset.
  - `pageSize: 0` always returns nothing.

  This also makes the PR description's claim of working pagination untrue (R10).
- **Fix:** Use `const start = (page - 1) * pageSize;`. Check that `page` is an integer ≥ 1 and `pageSize` an integer ≥ 1, and throw on anything else.

### B2. [medium] R7 — Page size has no enforced maximum
- **Where:** `app/src/loans.js:30`
- **Evidence:** `+export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {` / `+  return { items: all.slice(start, start + pageSize), page, pageSize, total: all.length };`
- **Problem:** R7 requires the function itself to enforce a maximum page size. The caller can pass any `pageSize`. `{ page: 0, pageSize: 1e9 }` returns the whole unbounded loan list in one response, which is exactly what the PR is meant to prevent. Also, `listLoans` still copies every row before slicing, so each page request costs O(all loans).
- **Fix:** Cap `pageSize`, e.g. `MAX_PAGE_SIZE = 100`, and either reject or clamp larger values. Return the clamped value in the `pageSize` field. Add a test for the cap.

### B3. [high] R8 — The new test does not check which rows are returned, which hides B1
- **Where:** `app/test/loans.test.js:36-41`
- **Evidence:** `+  const res = listLoansPage(createDb(), iryna, { page: 1, pageSize: 20 });` / `+  assert.equal(res.total, 7);` / `+  assert.equal(res.page, 1);` / `+  assert.equal(res.pageSize, 20);`
- **Problem:** The test checks only `total` and two values that are passed straight back from the input. It never checks `res.items`. Here it would be `[]` because of B1, and the test still passes. Nothing tests:
  - a page boundary (e.g. `pageSize: 3`, pages 1, 2 and 3);
  - an out-of-range page;
  - the size cap (B2);
  - that a member calling `listLoansPage` sees only their own loans.

  The PR description's claim "Тест додав." ("Added a test.") suggests coverage that the test does not give (R10).
- **Fix:** Assert exact ids, e.g.:
  - `listLoansPage(db, iryna, { page: 1, pageSize: 3 }).items.map(l => l.id)` deep-equals `[1, 2, 3]`;
  - page 3 deep-equals `[7]`;
  - for a member, `listLoansPage(db, olya, { page: 1, pageSize: 2 })` gives ids `[1, 2]` and `total: 3`.

  Add tests for the pageSize cap and for invalid `page`/`pageSize`.

## Minor findings

### M1. [low] R17 — Doc comment says "staff UI" but members can call the function too
- **Where:** `app/src/loans.js:29`
- **Evidence:** `+/** Paged variant for the staff UI: { items, page, pageSize, total }. */`
- **Problem:** The function delegates to `listLoans`, so members can call it and get their own loans. The comment suggests it is staff-only and does not say who may call it, as R17 requires. It also does not say whether `page` starts at 0 or 1, which is the confusion behind B1.
- **Fix:** Say that staff see every loan and a member only their own. State that `page` starts at 1 and give the maximum `pageSize`.

## Untrusted content

None.

## Questions for the author

- Is `listLoansPage` meant to be staff-only, as the doc comment says? If it is, it needs `requireRole(user, STAFF)` like `overdueReport`. R9 would then also require a denial test (`assert.throws(…, AccessDenied)` for a member). If members are allowed, please fix the comment (M1) and add a member test (B3).
- `PR.md` mentions the staff UI. Will that UI switch from `listLoans` to `listLoansPage`? As long as callers can still use the unpaged `listLoans`, the 3 000+ row problem is not solved. Please say whether `listLoans` will be deprecated or paged later.
