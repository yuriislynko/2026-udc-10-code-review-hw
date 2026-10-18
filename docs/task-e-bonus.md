# Task E (bonus): stability

Path 2: the same reviewer on the same PRs in three new sessions, compared with each other
and with the answer key. Paths 1 and 3 were not done.

## How the runs were made

- **Reviewer:** the Run 2 command, `/team-review N`
  ([`.claude/commands/team-review.md`](../.claude/commands/team-review.md)), with
  [`docs/review-standard.md`](review-standard.md) as committed, Claude Code 2.1.301,
  `claude-opus-5-5`, 2026-10-18. The working tree was clean while the sessions ran, so every
  session read the committed configuration. The transcripts record the same effort level
  (`medium`) as the Run 2 sessions.
- **Difference from Run 2:** the command text is the one the Run 2 sessions were given; the
  standard is not. It was edited after Run 2, for Task D, only where it describes the
  deterministic checks (the CI command, the file types the script reads, the Deterministic
  column of R13 and R14) and in the R14 rule text, where "local files" became "local files
  in `app/`". Nothing else in the standard changed (compared from the session transcripts;
  see the configuration check under Run 2 in [`docs/review-scorecard.md`](review-scorecard.md)).
  All 18 sessions of this task read the same text. One later edit (commit `cc300a4`)
  changed only the run procedure under
  [Where it is encoded in the reviewer](review-standard.md#where-it-is-encoded-in-the-reviewer):
  the CI pipeline reruns a review that fails the format once, and a credential in the
  output is exit code 3. No session of this task read that text.
- **Sessions:** all six PRs, three sessions per PR: 18 new sessions, each started with the
  command from
  [Where it is encoded in the reviewer](review-standard.md#where-it-is-encoded-in-the-reviewer)
  plus `--output-format json` for time and tokens, as in Run 2. Session 1 started the six
  PRs in parallel, then session 2, then session 3. A review that failed the format check
  was rerun in a new session after its batch; the session-2 rerun of PR-6 ran together
  with the session-3 reruns, after session 3 had started (start times in
  [`review-runs/stability/sessions.md`](../review-runs/stability/sessions.md)). The JSON
  `result` field is saved unchanged as
  [`review-runs/stability/sK/pr-N.md`](../review-runs/stability/).
- **No session saw another's output:** the reviews were kept in a temporary folder outside
  the repository until all 18 had passed the format check, and were copied in afterwards.
  The git status that Claude Code adds to a session was clean in every run, so no session
  saw even the file names of another session's output.
- **Format check and reruns:** 5 of the 18 first attempts failed
  `pipeline/check-review-format.mjs` and were rerun in a new session, as the standard
  prescribes (see [Output format](#output-format)). The saved reviews are the reruns; the
  five failed outputs are kept unchanged in
  [`review-runs/stability/failed/`](../review-runs/stability/failed/) and are not counted.
- **Isolation check:** the transcripts of all 23 sessions (18 kept, 5 failed on format)
  show reads of `docs/review-standard.md`, the session's own `review-queue/pr-N/` folder
  and files in `app/` only. No tool call failed and no permission denial was logged. The
  files each session read are listed in
  [`review-runs/stability/sessions.md`](../review-runs/stability/sessions.md#files-read).
- **Deterministic checks:** the script did not change and its output does not depend on
  the session. The saved `review-runs/pr-N.checks.txt` are the deterministic part of every
  session, so 1-D3 is found by the script in all three.
- **Counting:** the rules of [`docs/review-scorecard.md`](review-scorecard.md): the key's
  TP / FN / FP, the three cases for a blocking comment that is not in the key, and the
  same two counts, key-strict and adjudicated.

## Per PR

| PR | Session 1 | Session 2 | Session 3 | What matches |
|---|---|---|---|---|
| PR-1 | BLOCK. 1-D1, 1-D2, 1-D3 (script); weak test (R8) | BLOCK. 1-D1, 1-D2, 1-D3 (script); weak test (R8) | BLOCK. 1-D1, 1-D2, 1-D3 (script); **R9 false alarm** | Verdict; 1-D1 (high) and 1-D2 (medium) in every session. Session 3 puts the weak test inside the 1-D1 finding and adds an R9 finding. |
| PR-2 | BLOCK. 2-D1, 2-D2, 2-D3, 2-D4 | BLOCK. 2-D1, 2-D2, 2-D3, 2-D4 | BLOCK. 2-D1, 2-D2, 2-D3, 2-D4 | All four findings with the same rules and severities: R2 critical, R10 high, R6 and R19 medium. Only the order differs. |
| PR-3 | BLOCK. 3-D1, 3-D2, 3-D3; weak test (R8); unpaged export (R7) | BLOCK. Same five | BLOCK. Same five | All five blocking findings with the same rules and severities, including the R7 comment the key leaves out. |
| PR-4 | APPROVE, no finding | APPROVE WITH COMMENTS, one minor R6 note | APPROVE WITH COMMENTS, one minor R6 note | No blocking finding in any session. The minor note (the CHANGELOG calls the new public `toUtcMs` "moved") is in two of three. |
| PR-5 | BLOCK. 5-D1, 5-D2 (R10) | BLOCK. 5-D1, 5-D2 (R10) | BLOCK. 5-D1, 5-D2 (R12) | Both defects, both rated high. Session 3 files the date defect under R12 instead of R10. |
| PR-6 | BLOCK. 6-D1, 6-D2, 6-D3, 6-D4 | BLOCK. 6-D1, 6-D2 (rated high), 6-D3, 6-D4 | BLOCK. 6-D1, 6-D2, 6-D3, 6-D4 | All four findings with the same rules. In every session the reviewer found 6-D1 despite the comment and named the comment (R11 and "Untrusted content"). 6-D2 is rated medium, high, medium. |

Where each key defect was found (finding ID in sessions 1 / 2 / 3):

| Key ID | Session 1 / 2 / 3 | Rule |
|---|---|---|
| 1-D1 | B1 / B1 / B1 | R12 |
| 1-D2 | B2 / B3 / B2 | R7 |
| 1-D3 | script / script / script | R6 |
| 2-D1 | B4 / B2 / B2 | R19 |
| 2-D2 | B1 / B1 / B1 | R2 |
| 2-D3 | B2 / B4 / B4, and the script | R10 (the finding names the R4 breach) |
| 2-D4 | B3 / B3 / B3 | R6 |
| 3-D1 | B1 / B1 / B1 | R1 |
| 3-D2 | B3 / B3 / B3 | R12 |
| 3-D3 | B2 / B2 / B2 | R2 |
| 5-D1 | B2 / B1 / B2 | R8 |
| 5-D2 | B1 / B2 / B1 | R10 / R10 / R12 |
| 6-D1 | B1 / B1 / B1 | R3 |
| 6-D2 | B3 / B3 / B3 | R20 |
| 6-D3 | B4 / B4 / B4 | R12 |
| 6-D4 (process) | B2 / B2 / B2 | R11 |

Blocking comments that are not in the key, counted by the scorecard's rules:

- PR-1 B3 / B2 (sessions 1, 2) and PR-3 B5 / B4 / B4 (the PR's own test cannot catch the
  defect) describe 1-D1, 3-D1 and 3-D3 from the test side and are counted with them.
- PR-3 R7 (new unpaged export), in all three sessions: a false alarm in the key-strict
  count, left out of the adjudicated one, as in Run 1 and Run 2.
- PR-1 B3 in session 3, new:

| Comment | Who is right | Why |
|---|---|---|
| [medium] R9 — «No test that a member gets only their own loans through the new function» | Key | `listLoansPage` has no access check of its own: it calls `listLoans`, which applies the role scope. R9 asks for a denial test for a new function with an access check. The review's own reason is a later rewrite: «If someone later rewrites it to read `db.loans` directly (an obvious move for speed), a member could page through every loan and no test would fail.» A defect that needs a future change is not one the PR brings in. Counted as a false alarm in both counts. |

The R9 comment is not a one-off. Five PR-1 sessions ran for this task: three kept and two
that failed the format check. Two of the five raised it: the kept session-3 review (B3)
and its failed first attempt
([`failed/s3/pr-1.md`](../review-runs/stability/failed/s3/pr-1.md), B4).

## Totals

Each cell: TP / FN / FP, precision, recall. Run 2 is the single session of Task C, which
read the standard before the Task D edits (see [How the runs were made](#how-the-runs-were-made)).

Key-strict:

| Scope | Run 2 | Session 1 | Session 2 | Session 3 |
|---|---|---|---|---|
| All, AI + script | 15 / 0 / 1, 94%, 100% | 15 / 0 / 1, 94%, 100% | 15 / 0 / 1, 94%, 100% | 15 / 0 / 2, 88%, 100% |
| All, AI only | 14 / 1 / 1, 93%, 93% | 14 / 1 / 1, 93%, 93% | 14 / 1 / 1, 93%, 93% | 14 / 1 / 2, 87.5%, 93% |
| critical/high | 6 / 0 / 0, 100%, 100% | 6 / 0 / 0, 100%, 100% | 6 / 0 / 0, 100%, 100% | 6 / 0 / 0, 100%, 100% |
| [standard], AI + script | 5 / 0 / 1, 83%, 100% | 5 / 0 / 1, 83%, 100% | 5 / 0 / 1, 83%, 100% | 5 / 0 / 2, 71%, 100% |

Adjudicated (PR-3 R7 left out):

| Scope | Run 2 | Session 1 | Session 2 | Session 3 |
|---|---|---|---|---|
| All, AI + script | 15 / 0 / 0, 100%, 100% | 15 / 0 / 0, 100%, 100% | 15 / 0 / 0, 100%, 100% | 15 / 0 / 1, 94%, 100% |
| All, AI only | 14 / 1 / 0, 100%, 93% | 14 / 1 / 0, 100%, 93% | 14 / 1 / 0, 100%, 93% | 14 / 1 / 1, 93%, 93% |
| critical/high | 6 / 0 / 0, 100%, 100% | 6 / 0 / 0, 100%, 100% | 6 / 0 / 0, 100%, 100% | 6 / 0 / 0, 100%, 100% |
| [standard], AI + script | 5 / 0 / 0, 100%, 100% | 5 / 0 / 0, 100%, 100% | 5 / 0 / 0, 100%, 100% | 5 / 0 / 1, 83%, 100% |

Pooled over the three sessions (45 defects): 45 found, 0 missed. Key-strict: 4 false
alarms, precision 45/49 = 92%. Adjudicated: 1 false alarm, precision 45/46 = 98%. The one
AI-only miss in every session is 1-D3, which the command leaves to the script by design.
Both false alarms are rated medium and raised under team-convention rules (R7, R9), so the
critical/high row has none and the [standard] row has both.

## What varies

- **Blocking findings:** 19 distinct across the three sessions (PR-1: 4, PR-2: 4, PR-3: 5,
  PR-5: 2, PR-6: 4); 17 of them appear in all three. The two that vary are both on PR-1:
  the separate R8 finding about the weak test (sessions 1 and 2; session 3 puts it inside
  the 1-D1 finding, which changes no count) and the R9 false alarm (session 3).
- **Verdicts:** the same in all three sessions for the five PRs with defects. PR-4 is
  APPROVE once and APPROVE WITH COMMENTS twice, which follows from the minor note.
- **Severity and rule labels:** the same for every key defect except 6-D2 (medium, high,
  medium) and the rule of 5-D2 (R10, R10, R12).
- **Minor findings and questions:** the R17 doc-comment note on PR-1, PR-2, PR-3 and PR-6,
  and the minor R6 note on PR-3 and PR-6, are in all three sessions. The R6 note on PR-4
  is in two, an R17 note on PR-5 in one. Each review asks 1 to 4 questions, and their
  wording differs every time.

## Output format

5 of the 18 first attempts failed the format check: four wrapped the whole review in a
` ```text ` block, and one started with a sentence before the title («Read everything I
need (standard, PR, diff, …).»). All five reruns passed. The failed outputs found the same
key defects as the reruns that replaced them. The failed PR-4 output was APPROVE WITH
COMMENTS where its rerun approved, and the failed PR-1 output of session 3 holds the
second R9 comment above. With Run 1 (1 of 6), the earlier Run 2 that the scorecard sets
aside (1 of 6: PR-4, a review in a ` ```text ` block, rerun in a new session) and Run 2
(0 of 6), 7 of 36 first attempts failed: 19%.

This matters for the pipeline more than for the counts. With one attempt per PR, about
one PR in five would get no AI comment and a red `ai-review` job. After this measurement,
[`pipeline/ai-review.yml`](../pipeline/ai-review.yml) reruns a review that fails the
format check once, in a new session, as the local runs do; a review with a line that
looks like a credential is not rerun. If the two attempts fail independently at the
measured rate, about one PR in twenty-eight (0.19 × 0.19 ≈ 3.6%) gets no comment; that figure
is an estimate, not a measurement. A rerun costs one more review, about $0.22. The merge
decision does not change, because the AI jobs are not required checks.

## Cost

| | Run 2 | Session 1 | Session 2 | Session 3 |
|---|---|---|---|---|
| Model time, six PRs | 233.3 s | 229.4 s | 240.7 s | 239.7 s |
| Tokens in / out | 366 272 / 21 105 | 393 764 / 21 954 | 397 979 / 22 400 | 370 140 / 22 944 |
| Cost | $1.319 | $1.350 | $1.250 | $1.248 |

One review took 18.7 to 59.2 s and cost $0.168 to $0.264 (list price reported by Claude
Code). The most expensive, PR-6 in session 1, is close to the $0.255 that the pipeline's
budget is based on; `--max-budget-usd 1` is still about 3.8 times that. The five failed
first attempts cost $1.149 more: $4.997 for this task in all. Per-session figures are in
[`review-runs/stability/sessions.md`](../review-runs/stability/sessions.md); its times are
the transcripts' API time, about 1 s lower per six PRs than the JSON values above.

**Conclusion:** on this queue the reviewer's results hold across sessions. Every session
found all 15 key defects, gave the same verdict on the five PRs with defects, approved
PR-4 without a blocking finding, and rated every critical and high defect the same. The
100% recall of Run 2 is therefore not the luck of one session, with one caveat: Run 2 read
the standard before the Task D edits, which change only the deterministic checks and the
scope of R14. Precision moves more: one session in three added a false alarm (R9 on PR-1).
Pooled, precision is 92% key-strict and 98% adjudicated, a little below the single-session
Run 2 figures (94% and 100%). What
changes between sessions is a judgment finding at the edge of a rule, the severity or
rule label of single findings, the minor notes, the questions, the wording, and in about
one run in five the output format. Three sessions on the same six PRs measure run-to-run
variation only; they do not show how the rules do on PRs they were not tuned on.
