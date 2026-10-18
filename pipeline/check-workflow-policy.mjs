#!/usr/bin/env node
// Checks the safety settings of the Task D workflow (pipeline/ai-review.yml) that
// docs/pipeline.md describes. Node has no YAML parser, so the workflow is read as JSON:
//
//   npx --yes yaml@2.9.1 --json --single < pipeline/ai-review.yml | node pipeline/check-workflow-policy.mjs
//
// The `patterns` job runs the base branch's copy of it on the PR's copy of the workflow;
// run it locally after every change to the workflow. It reads the settings, it does not
// run the workflow: what only GitHub can show (the merge ref, the fork condition at run
// time, the comment permission) stays untested.
// Exit code: 0 = every check passes, 1 = a check fails, 2 = the input is not a workflow.

import { pathToFileURL } from "node:url";

const PINNED = /@[0-9a-f]{40}$/;
const EXPRESSION = /\$\{\{/;
const SECRET = /\bsecrets\./;
const APPROVES = /\bgh\s+pr\s+(?:review|merge)\b|--approve\b|\bpulls\/[^/\s]+\/(?:reviews|merge)\b/;
// The whole condition, not two parts of it: a match on parts lets `... || true` through.
const REVIEW_IF = "github.event.pull_request.head.repo.full_name == github.repository && !github.event.pull_request.draft";
// The /proc deny rule must be an argument of the claude call itself (backslash
// continuations joined), not text elsewhere in the script such as a comment or an
// unused variable. A `;` or `#` before the flag ends the call.
const PROC_DENY = /^\s*claude\b[^\n;#]*\s--disallowed(?:Tools|-tools)\s+(["'])Read\(\/\/proc\/\*\*\)\1/m;

const json = (value) => JSON.stringify(value ?? null);
const writes = (permissions) => permissions === "write-all" || Object.values(permissions ?? {}).includes("write");
const unless = (holds, problem) => (holds ? [] : [problem]);
/** An `if:` condition without a `${{ }}` wrapper, with whitespace collapsed. */
const condition = (text) =>
  String(text ?? "")
    .replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** Every check as { name, problems }; an empty list of problems means the check passes. */
export function checks(workflow) {
  const jobs = Object.entries(workflow.jobs ?? {});
  const job = (id) => workflow.jobs?.[id];
  const needs = (id) => [].concat(job(id)?.needs ?? []);
  const steps = jobs.flatMap(([id, j]) =>
    (j.steps ?? []).map((step, i) => ({ id, step, where: `${id}: ${step.name ?? step.uses ?? `step ${i + 1}`}` })),
  );
  const on = workflow.on ?? {};
  const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on);
  const secretSteps = steps.filter((s) => SECRET.test(json(s.step)));
  const review = job("ai-review");
  const comment = job("comment");

  return [
    {
      name: "the only trigger is pull_request",
      problems: unless(json(triggers) === '["pull_request"]', `triggers: ${triggers.join(", ")}`),
    },
    {
      name: "top-level permissions is empty",
      problems: unless(json(workflow.permissions) === "{}", `permissions: ${json(workflow.permissions)}`),
    },
    {
      name: "every job declares its permissions and a timeout",
      problems: jobs.flatMap(([id, j]) => [
        ...unless(j.permissions !== undefined, `${id}: no permissions`),
        ...unless(Number.isFinite(j["timeout-minutes"]), `${id}: no timeout-minutes`),
      ]),
    },
    {
      name: "no job has both a secret and a write permission",
      problems: jobs.filter(([, j]) => SECRET.test(json(j)) && writes(j.permissions)).map(([id]) => id),
    },
    {
      name: "only comment may write",
      problems: jobs.filter(([id, j]) => id !== "comment" && writes(j.permissions)).map(([id, j]) => `${id}: ${json(j.permissions)}`),
    },
    {
      name: "a secret is used in the env of one ai-review step only",
      problems: [
        ...unless(secretSteps.length <= 1, `${secretSteps.length} steps use a secret`),
        ...secretSteps
          .filter((s) => s.id !== "ai-review" || SECRET.test(json({ ...s.step, env: undefined })))
          .map((s) => `${s.where}: outside ai-review or outside env`),
        ...jobs.filter(([, j]) => SECRET.test(json({ ...j, steps: undefined }))).map(([id]) => `${id}: a secret at job level`),
      ],
    },
    {
      name: "the reviewer step may not read /proc",
      problems: secretSteps
        .filter((s) => !PROC_DENY.test((s.step.run ?? "").replace(/\\\r?\n/g, " ")))
        .map((s) => `${s.where}: no Read(//proc/**) deny rule`),
    },
    {
      name: "tests and patterns run on every PR, forks included",
      problems: ["tests", "patterns"].filter((id) => !job(id) || job(id).if !== undefined).map((id) => `${id}: missing or has an if:`),
    },
    {
      name: "ai-review needs tests and patterns, and skips fork PRs and drafts",
      problems: [
        ...["tests", "patterns"].filter((id) => !needs("ai-review").includes(id)).map((id) => `does not need ${id}`),
        ...unless(condition(review?.if) === REVIEW_IF, `if: ${review?.if ?? "(none)"}`),
      ],
    },
    {
      name: "comment needs ai-review, may only write to PRs, checks out nothing and holds no secret",
      problems: [
        ...unless(needs("comment").includes("ai-review"), "does not need ai-review"),
        ...unless(json(comment?.permissions) === '{"pull-requests":"write"}', `permissions: ${json(comment?.permissions)}`),
        ...(comment?.steps ?? []).filter((s) => s.uses?.startsWith("actions/checkout@")).map(() => "checks out code"),
        ...unless(!SECRET.test(json(comment)), "uses a secret"),
      ],
    },
    {
      name: "every action is pinned by a full commit SHA",
      problems: steps.filter((s) => s.step.uses && !PINNED.test(s.step.uses)).map((s) => `${s.where}: ${s.step.uses}`),
    },
    {
      name: "every checkout leaves no credentials in .git/config",
      problems: steps
        .filter((s) => s.step.uses?.startsWith("actions/checkout@") && s.step.with?.["persist-credentials"] !== false)
        .map((s) => s.where),
    },
    {
      name: "no run: script contains ${{ }}",
      problems: steps.filter((s) => EXPRESSION.test(s.step.run ?? "")).map((s) => s.where),
    },
    {
      name: "nothing approves, requests changes or merges",
      problems: steps.filter((s) => APPROVES.test(s.step.run ?? "")).map((s) => s.where),
    },
  ];
}

async function main() {
  if (process.stdin.isTTY) {
    console.error("usage: npx --yes yaml@2.9.1 --json --single < pipeline/ai-review.yml | node pipeline/check-workflow-policy.mjs");
    return 2;
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let workflow;
  try {
    workflow = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    console.error(`input is not JSON: ${error.message}`);
    return 2;
  }
  if (!workflow || typeof workflow !== "object" || typeof workflow.jobs !== "object") {
    console.error("input is not a workflow: no jobs");
    return 2;
  }
  const results = checks(workflow);
  for (const { name, problems } of results) {
    console.log(problems.length === 0 ? `PASS  ${name}` : [`FAIL  ${name}`, ...problems.map((p) => `        - ${p}`)].join("\n"));
  }
  const failed = results.filter((r) => r.problems.length > 0).length;
  console.log(`${results.length - failed} of ${results.length} checks pass.`);
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
