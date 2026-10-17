import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checks } from "./check-workflow-policy.mjs";

const SCRIPT = fileURLToPath(new URL("./check-workflow-policy.mjs", import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** The smallest workflow with the shape of pipeline/ai-review.yml, as `yaml --json` gives it. */
function safe() {
  const checkout = { uses: `actions/checkout@${SHA}`, with: { "persist-credentials": false } };
  return {
    on: { pull_request: { types: ["opened", "synchronize"] } },
    permissions: {},
    jobs: {
      tests: { permissions: { contents: "read" }, "timeout-minutes": 10, steps: [checkout, { run: "node --test" }] },
      patterns: { permissions: { contents: "read" }, "timeout-minutes": 5, steps: [checkout, { run: "node base/check.mjs pr.diff" }] },
      "ai-review": {
        needs: ["tests", "patterns"],
        if: "github.event.pull_request.head.repo.full_name == github.repository && !github.event.pull_request.draft",
        permissions: { contents: "read" },
        "timeout-minutes": 10,
        steps: [
          checkout,
          {
            name: "Run the reviewer",
            env: { ANTHROPIC_API_KEY: "${{ secrets.ANTHROPIC_API_KEY }}", PR_NUMBER: "${{ github.event.pull_request.number }}" },
            run: 'claude -p "/team-review $PR_NUMBER" --disallowedTools "Read(//proc/**)"',
          },
        ],
      },
      comment: {
        needs: "ai-review",
        permissions: { "pull-requests": "write" },
        "timeout-minutes": 5,
        steps: [{ uses: `actions/download-artifact@${SHA}` }, { run: 'gh pr comment "$PR_NUMBER" --body-file comment.md' }],
      },
    },
  };
}

const failing = (workflow) => checks(workflow).filter((c) => c.problems.length > 0).map((c) => c.name);

test("a workflow with the settings of docs/pipeline.md passes every check", () => {
  assert.deepEqual(failing(safe()), []);
});

test("trigger and permissions: pull_request_target, missing or broad permissions fail", () => {
  const target = safe();
  target.on = { pull_request_target: {} };
  assert.deepEqual(failing(target), ["the only trigger is pull_request"]);

  const broad = safe();
  delete broad.permissions;
  broad.jobs["ai-review"].permissions = "write-all";
  assert.deepEqual(failing(broad), ["top-level permissions is empty", "no job has both a secret and a write permission"]);

  const noTimeout = safe();
  delete noTimeout.jobs.patterns["timeout-minutes"];
  assert.deepEqual(failing(noTimeout), ["every job declares its permissions and a timeout"]);
});

test("secrets: a secret outside the reviewer step's env, or a reviewer that may read /proc, fails", () => {
  const inTests = safe();
  inTests.jobs.tests.steps[1].env = { KEY: "${{ secrets.ANTHROPIC_API_KEY }}" };
  assert.ok(failing(inTests).includes("a secret is used in the env of one ai-review step only"));

  const inRun = safe();
  inRun.jobs["ai-review"].steps[1].run = 'claude --api-key "${{ secrets.ANTHROPIC_API_KEY }}" --disallowedTools "Read(//proc/**)"';
  assert.deepEqual(failing(inRun), ["a secret is used in the env of one ai-review step only", "no run: script contains ${{ }}"]);

  const proc = safe();
  proc.jobs["ai-review"].steps[1].run = 'claude -p "/team-review $PR_NUMBER"';
  assert.deepEqual(failing(proc), ["the reviewer step may not read /proc"]);
});

test("job order: AI review without the deterministic jobs, for forks, or with skipped tests fails", () => {
  const early = safe();
  early.jobs["ai-review"].needs = ["tests"];
  assert.deepEqual(failing(early), ["ai-review needs tests and patterns, and skips fork PRs and drafts"]);

  const forks = safe();
  forks.jobs["ai-review"].if = "!github.event.pull_request.draft";
  assert.deepEqual(failing(forks), ["ai-review needs tests and patterns, and skips fork PRs and drafts"]);

  const skipped = safe();
  skipped.jobs.tests.if = "github.event.pull_request.head.repo.full_name == github.repository";
  assert.deepEqual(failing(skipped), ["tests and patterns run on every PR, forks included"]);
});

test("comment and steps: a checkout in comment, a tag-pinned action, kept credentials, an approval fail", () => {
  const checkout = safe();
  checkout.jobs.comment.steps.unshift({ uses: `actions/checkout@${SHA}`, with: { "persist-credentials": false } });
  assert.deepEqual(failing(checkout), ["comment needs ai-review, may only write to PRs, checks out nothing and holds no secret"]);

  const tag = safe();
  tag.jobs.tests.steps[0] = { uses: "actions/checkout@v7", with: { "persist-credentials": false } };
  assert.deepEqual(failing(tag), ["every action is pinned by a full commit SHA"]);

  const kept = safe();
  kept.jobs.patterns.steps[0] = { uses: `actions/checkout@${SHA}` };
  assert.deepEqual(failing(kept), ["every checkout leaves no credentials in .git/config"]);

  const approve = safe();
  approve.jobs.comment.steps[1].run = 'gh pr review "$PR_NUMBER" --approve';
  assert.deepEqual(failing(approve), ["nothing approves, requests changes or merges"]);
});

test("CLI: exit 0 when every check passes, 1 when one fails, 2 on input that is not a workflow", () => {
  const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8" }).status;
  assert.equal(run(JSON.stringify(safe())), 0);
  const target = safe();
  target.on = { pull_request_target: {} };
  assert.equal(run(JSON.stringify(target)), 1);
  assert.equal(run("on: pull_request\n"), 2);
  assert.equal(run('{"name": "no jobs"}'), 2);
});
