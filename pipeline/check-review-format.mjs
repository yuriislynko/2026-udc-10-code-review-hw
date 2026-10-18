#!/usr/bin/env node
// Checks that a saved AI review follows the output format of
// .claude/commands/team-review.md and carries no credential.
//
//   node pipeline/check-review-format.mjs review-runs/pr-3.md
//   node pipeline/check-review-format.mjs review-runs/pr-*.md
//
// A review is saved verbatim and never edited, so a run that fails this check is
// rerun in a new session. Checked: the title is the first line (no text or code fence
// before it), the verdict and summary lines, the four sections once each and in order,
// "None." or content under every section, and a verdict that follows from the
// findings. For a file named pr-N.md the title must name PR-N.
// The reviewer can read files outside the repository that no deny rule names, and its
// output is committed: a line matching a credential pattern (the R15 patterns of
// deterministic-checks.mjs) fails the review, so a PR that talks the reviewer into
// quoting a secret is stopped before the output reaches review-runs/.
// Messages never quote the review: it is model output shaped by an untrusted PR.
// Exit code: 0 = every file follows the format; 1 = a file breaks the format and holds
// no credential, so it is rerun in a new session; 2 = no file given or a file cannot be
// read; 3 = a file has a line that looks like a credential, so it is deleted, not rerun.
// With several files the highest code wins.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { SECRETS } from "./deterministic-checks.mjs";

const TITLE = /^# Review: PR-(\d+) — \S/;
const VERDICT = /^\*\*Verdict:\*\* (BLOCK|APPROVE WITH COMMENTS|APPROVE)$/;
const SUMMARY = /^\*\*Summary:\*\* \S/;
const SECTIONS = ["## Blocking findings", "## Minor findings", "## Untrusted content", "## Questions for the author"];
const BLOCKING_FINDING = /^### B\d+\. \[(?:critical|high|medium)\] R\d+ — \S/m;
const MINOR_FINDING = /^### M\d+\. \[low\] R\d+ — \S/m;

/** Returns the 1-based numbers of the lines that match a credential pattern. */
export function credentialLines(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line, i) => (SECRETS.some((re) => re.test(line)) ? [i + 1] : []));
}

/** Returns the format problems of one review as messages; an empty list means the format holds. */
export function problems(text, fileName = "") {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const found = [];

  const title = TITLE.exec(lines[0]);
  if (!title) found.push("the first line is not the title `# Review: PR-<N> — <title>`");
  const fileNumber = /^pr-(\d+)\.md$/.exec(fileName)?.[1];
  if (title && fileNumber && title[1] !== fileNumber) found.push(`the title names PR-${title[1]}, the file is pr-${fileNumber}.md`);

  for (const n of credentialLines(text)) {
    found.push(`line ${n} looks like a credential (not shown); do not save or commit this review`);
  }

  const starts = SECTIONS.map((heading) => lines.indexOf(heading));
  let sectionsHold = true;
  for (const heading of SECTIONS) {
    const count = lines.filter((l) => l === heading).length;
    if (count !== 1) {
      found.push(`section \`${heading}\` appears ${count} times, expected once`);
      sectionsHold = false;
    }
  }
  const present = starts.filter((s) => s !== -1);
  if (present.some((s, i) => i > 0 && s < present[i - 1])) {
    found.push("the sections are not in the order of the format");
    sectionsHold = false;
  }

  const head = lines.slice(0, present.length > 0 ? Math.min(...present) : lines.length);
  const verdictLine = head.find((l) => l.startsWith("**Verdict:**"));
  const verdict = verdictLine === undefined ? null : VERDICT.exec(verdictLine)?.[1] ?? null;
  if (verdict === null) found.push("no `**Verdict:**` line with BLOCK, APPROVE WITH COMMENTS or APPROVE before the sections");
  if (!head.some((l) => SUMMARY.test(l))) found.push("no `**Summary:**` line before the sections");

  // Section bodies are only read when every heading is present once and in order.
  if (!sectionsHold) return found;
  const bodies = starts.map((start, i) => lines.slice(start + 1, starts[i + 1] ?? lines.length).join("\n").trim());
  SECTIONS.forEach((heading, i) => {
    if (bodies[i] === "") found.push(`section \`${heading}\` is empty; the format asks for \`None.\``);
  });

  const hasBlocking = BLOCKING_FINDING.test(bodies[0]);
  const hasMinor = MINOR_FINDING.test(bodies[1]);
  if (bodies[0] !== "" && bodies[0] !== "None." && !hasBlocking) found.push("`## Blocking findings` has neither `None.` nor a `### B<n>.` finding");
  if (bodies[1] !== "" && bodies[1] !== "None." && !hasMinor) found.push("`## Minor findings` has neither `None.` nor a `### M<n>.` finding");
  const expected = hasBlocking ? "BLOCK" : hasMinor ? "APPROVE WITH COMMENTS" : "APPROVE";
  if (verdict !== null && verdict !== expected) found.push(`the verdict is ${verdict}, but the findings give ${expected}`);
  return found;
}

function main(paths) {
  if (paths.length === 0) {
    console.error("usage: node pipeline/check-review-format.mjs <review-file>...");
    return 2;
  }
  let status = 0;
  for (const path of paths) {
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      console.error(`${path}: cannot read: ${error.message}`);
      status = Math.max(status, 2);
      continue;
    }
    const found = problems(text, basename(path));
    console.log(found.length === 0 ? `${path}: ok` : [`${path}: FAIL`, ...found.map((p) => `  - ${p}`)].join("\n"));
    if (credentialLines(text).length > 0) status = Math.max(status, 3);
    else if (found.length > 0) status = Math.max(status, 1);
  }
  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
