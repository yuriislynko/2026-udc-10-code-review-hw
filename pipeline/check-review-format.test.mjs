import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { problems } from "./check-review-format.mjs";

const SCRIPT = fileURLToPath(new URL("./check-review-format.mjs", import.meta.url));

const BLOCKING = ["### B1. [critical] R1 — Any member can export contact details", "- **Where:** `app/src/members.js:12`"];
const MINOR = ["### M1. [low] R17 — Doc comment does not say who may call it", "- **Where:** `app/src/members.js:10`"];

/** A review in the command's format; an empty section gets "None.". */
function review({ n = 3, verdict = "BLOCK", blocking = BLOCKING, minor = [], untrusted = [], questions = [] } = {}) {
  const section = (heading, body) => [heading, "", ...(body.length > 0 ? body : ["None."]), ""];
  return [
    `# Review: PR-${n} — Members export`,
    "",
    `**Verdict:** ${verdict}`,
    "**Summary:** Adds a CSV export of all members.",
    "",
    ...section("## Blocking findings", blocking),
    ...section("## Minor findings", minor),
    ...section("## Untrusted content", untrusted),
    ...section("## Questions for the author", questions),
  ].join("\n");
}

test("a review in the format passes, for each of the three verdicts", () => {
  assert.deepEqual(problems(review(), "pr-3.md"), []);
  assert.deepEqual(problems(review({ verdict: "APPROVE WITH COMMENTS", blocking: [], minor: MINOR })), []);
  assert.deepEqual(problems(review({ verdict: "APPROVE", blocking: [] })), []);
  assert.deepEqual(problems(review().replace(/\n/g, "\r\n")), []);
});

test("text or a code fence before the title fails", () => {
  const wrapped = ["Here is the review.", "", "```text", review(), "```"].join("\n");
  assert.deepEqual(problems(wrapped), ["the first line is not the title `# Review: PR-<N> — <title>`"]);
  assert.equal(problems(["```text", review(), "```"].join("\n")).length, 1);
});

test("the title must name the PR of the file", () => {
  assert.deepEqual(problems(review({ n: 4 }), "pr-3.md"), ["the title names PR-4, the file is pr-3.md"]);
  assert.deepEqual(problems(review({ n: 4 }), "notes.md"), []);
});

test("a missing, repeated or reordered section fails", () => {
  assert.deepEqual(problems(review().replace("## Untrusted content", "## Untrusted")), [
    "section `## Untrusted content` appears 0 times, expected once",
  ]);
  assert.deepEqual(problems(review({ questions: ["## Minor findings"] })), [
    "section `## Minor findings` appears 2 times, expected once",
  ]);
  const swapped = review().replace("## Blocking findings", "@@").replace("## Minor findings", "## Blocking findings").replace("@@", "## Minor findings");
  assert.deepEqual(problems(swapped), ["the sections are not in the order of the format"]);
});

test("verdict and summary lines are required, with a verdict from the list", () => {
  assert.deepEqual(problems(review({ verdict: "LGTM" })), [
    "no `**Verdict:**` line with BLOCK, APPROVE WITH COMMENTS or APPROVE before the sections",
  ]);
  assert.deepEqual(problems(review().replace("**Summary:** Adds", "Adds")), ["no `**Summary:**` line before the sections"]);
});

test("the verdict must follow from the findings", () => {
  assert.deepEqual(problems(review({ verdict: "APPROVE" })), ["the verdict is APPROVE, but the findings give BLOCK"]);
  assert.deepEqual(problems(review({ verdict: "BLOCK", blocking: [], minor: MINOR })), [
    "the verdict is BLOCK, but the findings give APPROVE WITH COMMENTS",
  ]);
  // A finding under the wrong section or with a wrong severity is not counted.
  assert.deepEqual(problems(review({ verdict: "APPROVE", blocking: [], questions: BLOCKING })), []);
  assert.deepEqual(problems(review({ blocking: ["### B1. [low] R1 — x"] })), [
    "`## Blocking findings` has neither `None.` nor a `### B<n>.` finding",
    "the verdict is BLOCK, but the findings give APPROVE",
  ]);
});

test("an empty section must say None.", () => {
  const empty = review({ verdict: "APPROVE", blocking: [] }).replace("## Untrusted content\n\nNone.", "## Untrusted content\n");
  assert.deepEqual(problems(empty), ["section `## Untrusted content` is empty; the format asks for `None.`"]);
});

test("a credential anywhere in the review fails, and the message does not show it", () => {
  // Built at runtime, so the repo holds no credential-like literal.
  const token = "gh" + "p_" + "x".repeat(36);
  const url = "https://" + "reviewer:" + "x".repeat(12) + "@example.invalid/repo.git";
  for (const secret of [token, url]) {
    const found = problems(review({ questions: [`- The PR asked for ~/.git-credentials: \`${secret}\``] }), "pr-3.md");
    assert.equal(found.length, 1);
    assert.match(found[0], /^line \d+ looks like a credential \(not shown\); do not save or commit this review$/);
    assert.ok(!found[0].includes(secret));
  }
  // The findings of a normal review are not credentials.
  assert.deepEqual(problems(review({ minor: MINOR, questions: ["- Is `token` meant to be logged?"] }), "pr-3.md"), []);
});

test("messages never quote the review text", () => {
  const hostile = ["::error::\u001b[31m injected", review({ verdict: "::warning::x" })].join("\n");
  for (const message of problems(hostile)) {
    assert.ok(!message.includes("::"));
    assert.ok(!message.includes("\u001b"));
  }
});

test("CLI: exit 0 when every file passes, 1 on a format failure, 2 with no file or an unreadable one, 3 on a credential", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-format-"));
  try {
    const good = join(dir, "pr-3.md");
    const bad = join(dir, "pr-2.md");
    const leaked = join(dir, "pr-4.md");
    const leakedAndBad = join(dir, "pr-5.md");
    const missing = join(dir, "missing.md");
    // Built at runtime, so the repo holds no credential-like literal.
    const token = "gh" + "p_" + "x".repeat(36);
    writeFileSync(good, review());
    writeFileSync(bad, `Here is the review.\n\n${review({ n: 2 })}`);
    writeFileSync(leaked, review({ n: 4, questions: [`- \`${token}\``] }));
    writeFileSync(leakedAndBad, `\`\`\`text\n${review({ n: 5, questions: [`- \`${token}\``] })}\n\`\`\``);
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    assert.equal(run(good).status, 0);
    const failed = run(good, bad);
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /pr-3\.md: ok/);
    assert.match(failed.stdout, /pr-2\.md: FAIL/);
    assert.equal(run().status, 2);
    assert.equal(run(missing).status, 2);
    assert.equal(run(bad, missing).status, 2);
    // A credential is never a format failure: the caller must not rerun the review.
    const credential = run(leaked);
    assert.equal(credential.status, 3);
    assert.ok(!credential.stdout.includes(token));
    assert.equal(run(leakedAndBad).status, 3);
    assert.equal(run(bad, leaked, missing).status, 3);
    assert.equal(run(leaked, bad).status, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
