# Review: PR-1 — Сторінкування для списку позик

**Verdict:** BLOCK
**Summary:** The PR adds `listLoansPage`, a paged wrapper around `listLoans`. It blocks because the page arithmetic skips the first page, the new test does not check the returned rows so it cannot catch that, and the page size has no maximum.

## Blocking findings

### B1. [high] R12 — Page 1 returns the second page; first rows are never reachable
- **Where:** `app/src/loans.js:32`
- **Evidence:** `const start = page * pageSize;` with default `{ page = 1, pageSize = 20 }` (`app/src/loans.js:30`)
- **Problem:** Pages start at 1 (the default is `page = 1`), but the offset is calculated as if they start at 0. Page 1 starts at row 20, page 2 at row 40, and so on. The first `pageSize` loans can never be returned. With the seed data (7 loans), `listLoansPage(db, iryna)` returns `items: []` and `total: 7`, so the staff UI shows an empty list. Other inputs also give wrong results. `page: 0` returns the real first page. A negative `page` makes `slice` count from the end and returns rows from the tail. `pageSize: 0` or a negative/non-integer `pageSize` gives empty or wrong slices. This also breaks R10: `PR.md` says "сторінки, розмір сторінки, загальна кількість" and "Тест додав", but the pages the code returns are not the pages it reports. The test (`app/test/loans.test.js:15-20`) asserts only `total`, `page` and `pageSize`, not `items` (R8: an assertion too weak to catch the defect). It passes while page 1 is empty.
- **Fix:** Use `const start = (page - 1) * pageSize;`. Reject a `page` that is not an integer ≥ 1 and a `pageSize` that is not an integer ≥ 1. In the test, assert the exact ids on page 1 (e.g. `[1, 2, 3, 4, 5, 6, 7]` with `pageSize: 20`). Also assert a split across pages (e.g. `pageSize: 3` → page 1 `[1,2,3]`, page 3 `[7]`) and a page past the end (`[]`).

### B2. [medium] R7 — No maximum page size enforced
- **Where:** `app/src/loans.js:30`
- **Evidence:** `export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {`
- **Problem:** The loans list grows without limit. The PR says it is already 3 000+ rows. The function accepts any `pageSize` the caller sends, so `{ pageSize: 1e9 }` returns the whole list in one response. R7 requires the function itself to enforce a maximum page size. Without one, this paged endpoint is still an unbounded list.
- **Fix:** Add a constant such as `MAX_PAGE_SIZE` (e.g. 100). Reject a larger `pageSize` or clamp it to the maximum, return the size actually used in `pageSize`, and add a test for it.

### B3. [medium] R9 — No test that a member gets only their own loans through the new function
- **Where:** `missing: a test of listLoansPage called as a member (or with no user)`
- **Evidence:** the only new test calls `listLoansPage(createDb(), iryna, { page: 1, pageSize: 20 })` (`app/test/loans.test.js:16`), and `iryna` is staff
- **Problem:** `listLoansPage` gets its access scope from `listLoans`: staff see every loan, a member sees only their own, and no user throws. The new function has no test where that scope denies anything. If someone later rewrites it to read `db.loans` directly (an obvious move for speed), a member could page through every loan and no test would fail.
- **Fix:** Add a test that calls `listLoansPage` as `olya` and asserts exactly `[1, 2, 7]` and `total: 3`. Add another that asserts it throws when `user` is missing.

## Minor findings

### M1. [low] R17 — Doc comment does not say who may call it or how pages are numbered
- **Where:** `app/src/loans.js:29`
- **Evidence:** `/** Paged variant for the staff UI: { items, page, pageSize, total }. */`
- **Problem:** The comment says "for the staff UI", but the function serves members too (their own loans, through `listLoans`). It also does not say whether `page` starts at 0 or 1, and that ambiguity is behind B1. Neighbouring comments state the access rule (`/** Staff see every loan; a member sees only their own. */`).
- **Fix:** Use a comment like "Staff see every loan; a member only their own. Pages are 1-based; `pageSize` at most N. Returns `{ items, page, pageSize, total }`."

## Untrusted content

None.

## Questions for the author

- The PR gives "у UI все гальмує" (the UI is slow) as the motivation. Every call to `listLoansPage` still runs `listLoans`, which copies every visible loan (`rows.map((l) => ({ ...l }))`) before slicing. That is one scan per call, so it does not break R19, but it may not fix the slowness. Was the slowness in rendering or in the response? Would slicing `db.loans` (or the member's filtered rows) before copying be enough?
- Which parts of the UI should move from `listLoans` to `listLoansPage`? The old unpaged `listLoans` stays exported and unbounded. That is base code, not this PR, but is there a plan to retire it or add a limit?