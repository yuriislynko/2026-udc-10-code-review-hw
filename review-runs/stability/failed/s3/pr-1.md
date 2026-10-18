```text
# Review: PR-1 — Сторінкування для списку позик

**Verdict:** BLOCK
**Summary:** The PR adds `listLoansPage`, a paged wrapper around `listLoans`. It blocks because the page offset is off by one: page 1 skips the first 20 loans. The function also enforces no maximum page size, and the new test checks only values that were passed in, so it cannot catch either defect.

## Blocking findings

### B1. [high] R12 — Page offset is off by one; page 1 skips the first page
- **Where:** `app/src/loans.js:31`
- **Evidence:** `export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {` / `const start = page * pageSize;`
- **Problem:** Pages start at 1 (the default is `page = 1`), but the offset is `page * pageSize`. The default call, page 1 with size 20, starts at index 20. Rows 0–19 are never returned on any page from 1 up. With the seed data (7 loans), page 1 returns `items: []` with `total: 7`. On the 3 000+ rows the PR mentions, staff never see the first 20 loans. Only the undocumented `page: 0` reaches them. Page values are not checked either. A negative `page` gives a negative `start`, and `slice` then counts from the end of the list. A non-integer or `NaN` `page` gives a fractional or `NaN` offset. This also makes the PR's "сторінки" claim (R10) untrue in practice.
- **Fix:** Use `const start = (page - 1) * pageSize;`. Reject a `page` that is not an integer ≥ 1, for example with `Number.isInteger(page) && page >= 1`, otherwise throw.

### B2. [medium] R7 — No maximum page size enforced
- **Where:** `app/src/loans.js:31`
- **Evidence:** `export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {` / `return { items: all.slice(start, start + pageSize), page, pageSize, total: all.length };`
- **Problem:** R7 requires the function itself to enforce a maximum page size. Here `pageSize` comes from the caller with no upper bound. A call with `{ pageSize: 1e9 }` returns the whole loan list in one response, which is the unbounded list this PR is meant to fix. A `pageSize` of 0, a negative one or a non-integer is accepted too. The result then echoes back a `pageSize` that does not match what was sliced.
- **Fix:** Add a constant such as `MAX_PAGE_SIZE`. Reject a `pageSize` that is not an integer from 1 to the maximum, or clamp it to that range, and return the size that was actually used.

### B3. [high] R8 — The paged test never checks the returned items
- **Where:** `app/test/loans.test.js:15`
- **Evidence:** `const res = listLoansPage(createDb(), iryna, { page: 1, pageSize: 20 });` / `assert.equal(res.total, 7);` / `assert.equal(res.page, 1);` / `assert.equal(res.pageSize, 20);`
- **Problem:** Two of the three assertions only check that `page` and `pageSize` come back as passed in. The third checks `total`, which comes from `listLoans`. Nothing looks at `res.items`, the only part of the result that pagination computes. The test passes while page 1 returns `[]` (B1), so it hides the main defect. No test covers a second page, the last partial page or the page-size limit.
- **Fix:** Assert the exact ids, for example `assert.deepEqual(res.items.map((l) => l.id), [1, 2, 3, 4, 5, 6, 7])` for page 1. Add a test with a small page size, such as `pageSize: 3`, that checks the ids on pages 1, 2 and 3 (the last one partial), and one test for a page past the end. Add a test that an oversized `pageSize` is rejected or clamped.

### B4. [medium] R9 — No test that the access check holds through the new function
- **Where:** `missing: a denial / own-records test for listLoansPage in app/test/loans.test.js`
- **Evidence:** `const res = listLoansPage(createDb(), iryna, { page: 1, pageSize: 20 });` (the only call, made as staff)
- **Problem:** `listLoansPage` is a new function, and its access check comes from `listLoans`: it requires a user, and a non-staff user sees only their own loans. No test shows that access is denied or restricted. Nothing checks that a member gets only their own loans in the paged result, or that a call without a user is rejected. If the wrapper later reads `db.loans` directly instead of calling `listLoans`, every member would see every loan and no test would fail.
- **Fix:** Add a test that `listLoansPage(createDb(), olya)` returns only ids `[1, 2, 7]` with `total: 3`. Add one that `listLoansPage(createDb(), null)` throws.

## Minor findings

### M1. [low] R17 — Doc comment does not say who may call the function
- **Where:** `app/src/loans.js:30`
- **Evidence:** `/** Paged variant for the staff UI: { items, page, pageSize, total }. */`
- **Problem:** The comment says "for the staff UI", but the function does not restrict callers to staff. Like `listLoans`, it lets any user call it and gives members their own loans. It also does not say whether `page` starts at 0 or 1, or what the maximum `pageSize` is. Both of those are where B1 and B2 come from.
- **Fix:** Say who may call it, in the way `listLoans` does ("Staff see every loan; a member sees only their own"). State that `page` starts at 1 and give the maximum `pageSize`.

## Untrusted content

None.

## Questions for the author

- The PR says the staff UI is slow at 3 000+ rows. `listLoansPage` still calls `listLoans`, which copies every row (`rows.map((l) => ({ ...l }))`) on every page request, and then slices it. Paging makes the response smaller but not the work. Does profiling show the slowness is in rendering rather than in building the list? If not, slicing before the copy would help.
- Should `listLoansPage` be staff-only, as the description and doc comment suggest ("для персоналу", "for the staff UI")? Or is member access through it intended? Settling this decides whether it needs `requireRole(user, STAFF)` and an `AccessDenied` test.
- Is the existing `listLoans` meant to stay unpaged for other callers, or will it be replaced? The unbounded `listLoans` is a defect of the base code, not of this PR.
```