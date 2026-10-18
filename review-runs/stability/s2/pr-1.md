# Review: PR-1 — Сторінкування для списку позик

**Verdict:** BLOCK
**Summary:** The PR adds `listLoansPage`, a paged wrapper around `listLoans`. It is blocked because the page offset is off by one, so the first page is never returned. The new test does not check `items`, so it misses this. The function also enforces no maximum page size.

## Blocking findings

### B1. [high] R12 — Page offset is off by one: page 1 skips the first `pageSize` rows
- **Where:** `app/src/loans.js:32`
- **Evidence:** `export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {` / `const start = page * pageSize;`
- **Problem:** Pages are 1-based (`page = 1` is the default), but the offset is computed as if they were 0-based. With the default `page: 1, pageSize: 20`, `start` is 20, so the call returns rows 21–40 and rows 1–20 are never reachable. With the 7 seed loans, the default call returns `items: []` while `total: 7`. Members see the same thing for their own loans. Out-of-range input is not handled either: `page: 0` happens to return the real first page, and a negative `page` gives a negative `start`, so `slice` returns rows counted from the end of the list.
- **Fix:** Use `const start = (page - 1) * pageSize;`. Validate `page` as an integer ≥ 1, or throw on any other value.

### B2. [high] R8 — The new test does not check the returned rows, so it hides B1
- **Where:** `app/test/loans.test.js:15-20`
- **Evidence:** `const res = listLoansPage(createDb(), iryna, { page: 1, pageSize: 20 });` / `assert.equal(res.total, 7);` / `assert.equal(res.page, 1);` / `assert.equal(res.pageSize, 20);`
- **Problem:** The test only checks values the function echoes back (`page`, `pageSize`) and the length of the full list (`total`). It never looks at `items`, the only thing the function actually computes. It passes today even though `items` is `[]` for this call. This also means the PR description's "Тест додав" ("added a test") does not show that pagination works.
- **Fix:** Assert the exact ids on each page. With the 7 seed loans, `pageSize: 3` should give `page: 1` → `[1, 2, 3]`, `page: 3` → `[7]`, and a page past the end → `[]`. Add a member case, `olya`, to check that paging keeps the own-loans filter: `total: 3`, ids `[1, 2, 7]`.

### B3. [medium] R7 — No maximum page size is enforced
- **Where:** `app/src/loans.js:30`
- **Evidence:** `{ page = 1, pageSize = 20 } = {}` / `return { items: all.slice(start, start + pageSize), page, pageSize, total: all.length };`
- **Problem:** R7 requires the function to enforce a maximum page size. `pageSize` is taken from the caller unchecked, so `{ pageSize: 1e9 }` returns all 3,000+ loans in one response, the unbounded list this PR is meant to page (PR.md: "Список позик для персоналу вже на 3 000+ рядків"). Values of `0`, a negative number or a non-integer are not rejected either.
- **Fix:** Clamp `pageSize` to a fixed limit (for example `MAX_PAGE_SIZE = 100`) or throw above it. Require an integer ≥ 1. Add a test for the limit.

## Minor findings

### M1. [low] R17 — Doc comment says "staff UI" but members can call it too
- **Where:** `app/src/loans.js:29`
- **Evidence:** `/** Paged variant for the staff UI: { items, page, pageSize, total }. */`
- **Problem:** `listLoansPage` delegates to `listLoans`, so any signed-in member can call it and gets their own loans. The comment reads as if the function were staff-only, so it does not say who may call it and what each caller gets.
- **Fix:** Say who may call it and what they get, for example "Staff get every loan; a member gets only their own. Pages are 1-based; `pageSize` is at most N." Also state that `page` is 1-based.

## Untrusted content

None.

## Questions for the author

- `listLoansPage` copies the whole list through `listLoans` (`rows.map((l) => ({ ...l }))`) on every page request, and only then slices it. That is one scan per call, so it does not break R19. But it does not cut the server-side cost behind "у UI все гальмує" ("the UI is really slow"). Was slicing before copying considered? Profiling the UI with 3,000+ rows would settle it.
- Is there a stable sort order that clients can rely on between page requests? Today pages follow the order of `db.loans`. If loans are inserted or removed between requests, rows can be shifted or skipped.
- No `app/CHANGELOG.md` entry names `listLoansPage`. The deterministic script reports a new `export` with no CHANGELOG line, so it is not repeated as a finding here. The entry should list the parameters (`page`, 1-based; `pageSize` and its maximum) and the result fields.