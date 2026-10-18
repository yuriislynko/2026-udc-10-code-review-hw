```text
# Review: PR-1 — Сторінкування для списку позик

**Verdict:** BLOCK
**Summary:** Adds `listLoansPage`, a paged wrapper over `listLoans`. Blocked because the offset is off by one page, so page 1 skips the first page of loans, the page size has no upper limit, and the new test does not check `items`, which is the only part that is wrong.

## Blocking findings

### B1. [high] R12 — Page 1 skips the first page of loans
- **Where:** `app/src/loans.js:32`
- **Evidence:** `export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {` / `const start = page * pageSize;`
- **Problem:** Pages start at 1 (the default is `page = 1`), but the offset is computed as if they started at 0. With the defaults, `start` is 20, so the first call returns loans 21–40 and loans 1–20 are never returned. With the seed data (7 loans), `page: 1` returns `items: []` while `total: 7`. There is also no check on `page` and `pageSize`: `page = 0`, a negative value or a non-integer gives a wrong or meaningless slice instead of an error. The PR description promises "сторінки"; that claim (R10) fails for the same reason.
- **Fix:** Use `const start = (page - 1) * pageSize;`. Reject a `page` that is not an integer ≥ 1 and a `pageSize` that is not an integer ≥ 1 with an error.

### B2. [high] R8 — The test does not check the returned items, so it hides B1
- **Where:** `app/test/loans.test.js:15`
- **Evidence:** `assert.equal(res.total, 7);` / `assert.equal(res.page, 1);` / `assert.equal(res.pageSize, 20);`
- **Problem:** The test only checks values the function copies back from its input (`page`, `pageSize`) and the length of the unpaged list (`total`). It never looks at `items`, so it passes while page 1 is empty (B1). Nothing tests a page boundary (several pages, the last partial page, a page past the end) or a member caller, who should get only their own loans in the page.
- **Fix:** Assert the exact ids, for example `assert.deepEqual(res.items.map((l) => l.id), [1, 2, 3, 4, 5, 6, 7])` for `{ page: 1, pageSize: 20 }`. Add a case with `pageSize: 3` that checks the ids on pages 1, 2 and 3 and an empty page 4. Add a member case that checks only the member's loan ids `[1, 2, 7]` come back.

### B3. [medium] R7 — No maximum page size is enforced
- **Where:** `app/src/loans.js:30`
- **Evidence:** `{ page = 1, pageSize = 20 } = {}` / `items: all.slice(start, start + pageSize)`
- **Problem:** R7 requires the function to enforce a maximum page size. Here the caller picks `pageSize`, so `pageSize: 1e9` (or `Infinity`) returns all 3 000+ loans in one response. That is the unbounded list the PR set out to fix.
- **Fix:** Define a maximum (for example `MAX_PAGE_SIZE = 100`) and either reject a larger `pageSize` or clamp it to the maximum. Return the page size actually used, and add a test for that limit.

## Minor findings

### M1. [low] R17 — The doc comment does not say who may call it
- **Where:** `app/src/loans.js:29`
- **Evidence:** `/** Paged variant for the staff UI: { items, page, pageSize, total }. */`
- **Problem:** The comment says the function is for the staff UI, but it calls `listLoans`, so any signed-in member can call it and gets their own loans. The comment does not state the access rule the way `listLoans` does ("Staff see every loan; a member sees only their own."). It also does not say whether pages start at 0 or 1, which is the source of B1.
- **Fix:** State the access rule (same as `listLoans`), that pages start at 1, and the maximum `pageSize`.

## Untrusted content

None.

## Questions for the author

- Is `listLoansPage` meant for staff only, as the doc comment says ("for the staff UI")? If so, it needs `requireRole(user, STAFF)` and a denial test with `AccessDenied` (R1, R9). If members may call it too, as the code allows now, please fix the comment (M1) and add the member test from B2.
- `total` comes from `listLoans`, which copies every loan (`rows.map((l) => ({ ...l }))`) on every page request. That is one scan per call, so it is not an R19 defect. But for 3 000+ rows, did you consider slicing first and copying only the rows on the page?
```