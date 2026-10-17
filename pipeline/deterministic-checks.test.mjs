import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { check, format, parseDiff } from "./deterministic-checks.mjs";

const SCRIPT = fileURLToPath(new URL("./deterministic-checks.mjs", import.meta.url));
const HRN = "\u0433\u0440\u043d"; // the hryvnia label

/** A one-hunk diff of `path`; every line starts with "+", "-" or " ". */
function diff(path, lines, { start = 10, isNew = false } = {}) {
  const oldCount = lines.filter((l) => !l.startsWith("+")).length;
  const newCount = lines.filter((l) => !l.startsWith("-")).length;
  return [
    `diff --git a/${path} b/${path}`,
    isNew ? "--- /dev/null" : `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${isNew ? 0 : start},${oldCount} +${isNew ? 1 : start},${newCount} @@`,
    ...lines,
    "",
  ].join("\n");
}

const rules = (text) => check(text).map((f) => `${f.rule} ${f.level}`);

test("parser: line numbers, and a removed line that looks like a header stays a line", () => {
  const [file] = parseDiff(diff("app/src/x.js", [" a", "--- not a header", "+b", " c"], { start: 5 }));
  assert.equal(file.path, "app/src/x.js");
  assert.deepEqual(file.removed, [{ line: 6, text: "-- not a header" }]);
  assert.deepEqual(file.added, [{ line: 6, text: "b", above: "a" }]);
});

test("R4: formatting and currency labels in added code fail; comments and unchanged lines do not", () => {
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  return (fee / 100).toFixed(2);"])), ["R4 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", [`+  return \`\${fee} ${HRN}\`;`])), ["R4 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  label: new Intl.NumberFormat(\"uk\").format(x),"])), [
    "R4 blocking",
  ]);
  // The base code has a comment with the label (app/src/loans.js:4): neither the
  // unchanged line nor a new comment may fail the PR.
  const base = `export const FEE_PER_DAY_KOPECKS = 500; // 5 ${HRN} per day`;
  assert.deepEqual(rules(diff("app/src/loans.js", [` ${base}`, "+// fee is 5 " + HRN])), []);
  assert.deepEqual(rules(diff("app/test/loans.test.js", [`+  assert.equal(label, "15 ${HRN}");`])), []);
});

test("R5: local-time methods, local constructors and zone-less date-times fail; UTC passes", () => {
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const d = due.getDate();"])), ["R5 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const d = new Date(2026, 0, 31);"])), ["R5 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ['+  const d = new Date("2026-10-01T10:00");'])), [
    "R5 blocking",
  ]);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const d = due.getUTCDate();"])), []);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const d = new Date(Date.UTC(2026, 0, 31));"])), []);
  assert.deepEqual(rules(diff("app/src/loans.js", ['+  const d = new Date("2026-10-01T10:00Z");'])), []);
  // One argument built by a nested call is an instant, not local construction.
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const last = new Date(Math.max(a, b));"])), []);
  assert.deepEqual(rules(diff("app/src/loans.js", ['+  const d = new Date(parse(s, ","));'])), []);
  // A constructor split across lines is read to its closing bracket, and reported once.
  const split = check(diff("app/src/loans.js", ["+  const d = new Date(", "+    y, m, d);"]));
  assert.deepEqual(split.map((f) => `${f.rule} ${f.line}`), ["R5 10"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const d = new Date(", "+    Date.UTC(y, m, d));"])), []);
  // A local constructor on the next line is that line's finding, not this one's.
  const next = check(diff("app/src/loans.js", ["+  const a = new Date(x);", "+  const b = new Date(y, m, d);"]));
  assert.deepEqual(next.map((f) => `${f.rule} ${f.line}`), ["R5 11"]);
});

test("R6: a changed export line needs an added CHANGELOG line", () => {
  const added = diff("app/src/loans.js", ["+/** Staff-only. */", "+export function lostBooks(db, user) {"]);
  assert.deepEqual(rules(added), ["R6 blocking"]);
  assert.deepEqual(rules(added + diff("app/CHANGELOG.md", ["+- `lostBooks(db, user)` added."])), []);

  const removed = diff("app/src/loans.js", ["-export function lateFee(loan, onIso) {"]);
  assert.equal(check(removed)[0].line, "10 (removed)");

  const deleted = "diff --git a/app/src/old.js b/app/src/old.js\n--- a/app/src/old.js\n+++ /dev/null\n"
    + "@@ -1,1 +0,0 @@\n-export const X = 1;\n";
  assert.deepEqual(rules(deleted), ["R6 blocking"]);
});

test("R8: skipped, focused and todo tests fail; a pagination option named skip does not", () => {
  assert.deepEqual(rules(diff("app/test/loans.test.js", ['+test.skip("late fee", () => {'])), ["R8 blocking"]);
  assert.deepEqual(rules(diff("app/test/loans.test.js", ['+test("late fee", { skip: true }, () => {'])), [
    "R8 blocking",
  ]);
  // A bracket in the test name does not end the search for the options object.
  assert.deepEqual(rules(diff("app/test/loans.test.js", ['+test("late fee (grace day)", { skip: true }, () => {'])), [
    "R8 blocking",
  ]);
  assert.deepEqual(rules(diff("app/test/loans.test.js", ["+  const page = listPage(db, { skip: 10 });"])), []);
  assert.deepEqual(rules(diff("app/test/loans.test.js", ['+test("page (2)", () => { listPage(db, { skip: 10 }); });'])), []);
});

test("R8: a changed script in app/package.json and a deleted or moved test file fail", () => {
  const changed = diff("app/package.json", ['   "scripts": {', '-    "test": "node --test"', '+    "test": "true"', "   },"], {
    start: 7,
  });
  assert.deepEqual(rules(changed), ["R8 blocking"]);
  assert.equal(check(changed)[0].line, 8);
  // A script added next to the test script is inside "scripts" too.
  assert.deepEqual(rules(diff("app/package.json", ['   "scripts": {', '+    "pretest": "exit 0",', '     "test": "node --test"'])), [
    "R8 blocking",
  ]);
  // A hunk that starts inside "scripts" is caught by the key of the test script.
  assert.deepEqual(rules(diff("app/package.json", ['-    "test": "node --test"', '+    "test": "true"'], { start: 8 })), [
    "R8 blocking",
  ]);
  // Removing the whole object fails; a change outside it passes.
  assert.deepEqual(rules(diff("app/package.json", ['-  "scripts": {', '-    "test": "node --test"', "-  },"], { start: 7 })), [
    "R8 blocking",
  ]);
  assert.deepEqual(rules(diff("app/package.json", ['-  "version": "1.0.0",', '+  "version": "1.1.0",', '   "private": true,'], { start: 3 })), []);
  assert.deepEqual(rules(diff("app/package.json", ["   },", '   "engines": {', '-    "node": ">=22"', '+    "node": ">=24"'], { start: 9 })), []);

  const deleted = "diff --git a/app/test/loans.test.js b/app/test/loans.test.js\ndeleted file mode 100644\n"
    + "--- a/app/test/loans.test.js\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-test(\"late fee\", () => {});\n";
  assert.deepEqual(rules(deleted), ["R8 blocking"]);
  // An empty file is deleted without a hunk: the header says so.
  assert.deepEqual(rules("diff --git a/app/test/x.test.js b/app/test/x.test.js\ndeleted file mode 100644\nindex e69de29..0000000\n"), [
    "R8 blocking",
  ]);
  const moved = (to) => `diff --git a/app/test/loans.test.js b/${to}\nsimilarity index 100%\n`
    + `rename from app/test/loans.test.js\nrename to ${to}\n`;
  assert.deepEqual(rules(moved("app/loans.test.bak")), ["R8 blocking"]);
  assert.deepEqual(rules(moved("app/test/fees.test.js")), []);
});

test("R11: tool directives fail, in comments too; a plain comment does not", () => {
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  // eslint-disable-next-line no-unused-vars"])), [
    "R11 blocking",
  ]);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  /* c8 ignore next */"])), ["R11 blocking"]);
  assert.deepEqual(rules(diff("app/test/loans.test.js", ["+  // @ts-ignore"])), ["R11 blocking"]);
  // The coverage directive of node:test itself.
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  /* node:coverage ignore next */"])), ["R11 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  /* node:coverage disable */"])), ["R11 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  // ignore returned loans here"])), []);
});

test("R14: dependencies, lock files, non-built-in and computed imports fail; node: and local imports pass", () => {
  assert.deepEqual(rules(diff("app/package.json", ['+  "dependencies": {'])), ["R14 blocking"]);
  assert.deepEqual(rules(diff("app/package-lock.json", ["+{"], { isNew: true })), ["R14 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ['+import dayjs from "dayjs";'])), ["R14 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ['+  const pad = await import("left-pad");'])), ["R14 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ['+import { readFileSync } from "node:fs";'])), []);
  assert.deepEqual(rules(diff("app/src/loans.js", ['+import { logAccess } from "./audit.js";'])), []);
  // `from "x"` inside a string is text, not an import.
  assert.deepEqual(rules(diff("app/test/imports.test.js", [`+test("rejects a file from 'outside'", () => {`])), []);
  assert.deepEqual(rules(diff("app/src/imports.js", [`+  throw new Error('copied from "vendor"');`])), []);
  assert.deepEqual(rules(diff("app/src/imports.js", ['+  const msg = `copied from "vendor"', "+    and more`;"])), []);
  // A real import next to such a string is still found.
  assert.deepEqual(rules(diff("app/src/imports.js", [`+import csv from "csv-parse"; // not 'from "x"'`])), ["R14 blocking"]);
  // A template literal is read like a quoted specifier.
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const pad = await import(`left-pad`);"])), ["R14 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const pad = require(`left-pad`);"])), ["R14 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const fs = await import(`node:fs`);"])), []);
  // A computed specifier cannot be checked against the list, so it fails.
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const mod = await import(name);"])), ["R14 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const mod = require(path.join(dir, name));"])), ["R14 blocking"]);
  // `import.meta`, a method named require and the words in a string are not imports.
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const here = new URL(import.meta.url);"])), []);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const mod = loader.require(name);"])), []);
  assert.deepEqual(rules(diff("app/src/loans.js", ['+  throw new Error("cannot import (name) here");'])), []);
});

test("R14: a relative import that leaves app/ and a symbolic link under app/ fail; imports within app/ pass", () => {
  assert.deepEqual(rules(diff("app/src/loans.js", ['+import { feeLabel } from "../../lib/fmt.js";'])), ["R14 blocking"]);
  assert.deepEqual(rules(diff("app/test/loans.test.js", ['+import { check } from "../../pipeline/deterministic-checks.mjs";'])), [
    "R14 blocking",
  ]);
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const fmt = await import(`../../lib/fmt.js`);"])), ["R14 blocking"]);
  assert.deepEqual(rules(diff("app/src/loans.js", ['+import { member } from "../test/helpers.js";', '+import { db } from "./db.js";'])), []);
  // A link's one line is the path it points to; Node follows it when the file is imported.
  const link = (path) => [
    `diff --git a/${path} b/${path}`,
    "new file mode 120000",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1 @@",
    "+../../lib/fmt.js",
    "\\ No newline at end of file",
    "",
  ].join("\n");
  assert.deepEqual(rules(link("app/src/fmt.js")), ["R14 blocking"]);
  assert.deepEqual(rules(link("docs/fmt.js")), []);
});

test("file types: .ts, .mts and .cts files and every file under app/src/ are read as code", () => {
  // Node 22 runs TypeScript files (type stripping), and require() runs a file of any
  // extension as JavaScript, so the extension cannot switch the checks off.
  assert.deepEqual(rules(diff("app/src/fmt.ts", ["+  return (k / 100).toFixed(2);"], { isNew: true })), ["R4 blocking"]);
  assert.deepEqual(rules(diff("app/src/dates.mts", ["+  const d = new Date(2026, 0, 1);"], { isNew: true })), ["R5 blocking"]);
  assert.deepEqual(rules(diff("app/src/fmt.txt", ["+  console.log(k);"], { isNew: true })), ["R18 minor"]);
  assert.deepEqual(rules(diff("app/lib/x.cts", ["+// eslint-disable-next-line"], { isNew: true })), ["R11 blocking"]);
  assert.deepEqual(rules(diff("app/test/fees.test.ts", ['+test.skip("late fee", () => {});'], { isNew: true })), ["R8 blocking"]);
  assert.deepEqual(rules(diff("app/src/fmt.ts", ["+/** Staff only. */", "+export function feeLabel(k: number) {}"], { isNew: true })), [
    "R6 blocking",
  ]);
  // A data file outside app/src/ is not code.
  assert.deepEqual(rules(diff("app/test/fixtures/rows.txt", ["+15.00 toFixed(2)"], { isNew: true })), []);
});

test("R15: credentials and real-looking contacts fail without being printed; synthetic data passes", () => {
  // Built at runtime, so the repo holds no credential-like or real-looking literal.
  const key = "sk-" + "x".repeat(24);
  const email = "person@" + "domain.ua";
  const phone = "+38067" + "0000000";

  const leak = check(diff("app/src/db.js", [`+  const apiKey = "${key}";`]));
  assert.deepEqual(leak.map((f) => f.rule), ["R15"]);
  assert.ok(!format(leak).includes(key));

  const npmToken = "npm_" + "x".repeat(36);
  assert.deepEqual(rules(diff("app/test/x.test.js", [`+// registry token ${npmToken}`])), ["R15 blocking"]);

  assert.deepEqual(rules(diff("app/src/db.js", [`+  { email: "${email}", phone: "${phone}" },`])), [
    "R15 blocking",
    "R15 blocking",
  ]);
  assert.deepEqual(rules(diff("app/src/db.js", ['+  { email: "nina@example.invalid", phone: "+380000000006" },'])), []);
  // The whole +38000 range is synthetic, not only the first ten numbers.
  assert.deepEqual(rules(diff("app/test/imports.test.js", ['+  "new1@example.invalid,+380000000010\\n"'])), []);

  // Grouped digits are the same number: spaces, dashes, dots and brackets are ignored.
  for (const grouped of ["+380 67 " + "000 00 00", "+38 (067) " + "000-00-00", "380.67." + "000.00.00"]) {
    assert.deepEqual(rules(diff("app/src/db.js", [`+  phone: "${grouped}",`])), ["R15 blocking"], grouped);
  }
  assert.deepEqual(rules(diff("app/src/db.js", ['+  phone: "+380 00 000 00 06",'])), []);
  // One number is one finding, and a number one space away from other digits is still found.
  assert.deepEqual(rules(diff("app/src/db.js", [`+  const s = "${phone} 1";`])), ["R15 blocking"]);
  // Dates and long ids are not phone numbers.
  assert.deepEqual(rules(diff("app/test/x.test.js", ['+  const at = "2026-10-16 12:30", id = "380123";'])), []);
});

test("R17 and R18 are minor: printed, but they never fail the run", () => {
  assert.deepEqual(rules(diff("app/src/report.js", ["+export function report(db, user) {"], { isNew: true })), [
    "R6 blocking",
    "R17 minor",
  ]);
  const documented = diff("app/src/loans.js", ["+/** Staff-only report. */", "+export function report(db, user) {"]);
  assert.ok(!rules(documented).includes("R17 minor"));
  // The line above is not in the diff: no guess.
  assert.ok(!rules(diff("app/src/loans.js", ["+export function report(db, user) {"])).includes("R17 minor"));

  assert.deepEqual(rules(diff("app/src/loans.js", ["+  console.log(rows);"])), ["R18 minor"]);
});

test("comments: a block comment is followed across lines, including one opened on a context line", () => {
  const commented = diff("app/src/loans.js", ["+/*", "+  console.log(rows);", "+  const d = due.getDate();", "+*/", "+  console.log(x);"]);
  assert.deepEqual(check(commented).map((f) => `${f.rule} ${f.line}`), ["R18 14"]);
  assert.deepEqual(rules(diff("app/src/loans.js", [" /* old code:", "+  console.log(rows);", " */"])), []);
  // Hunks are separate: a comment left open in one hunk does not hide the next one.
  const twoHunks = diff("app/src/loans.js", [" /*"], { start: 5 }) + diff("app/src/loans.js", ["+  console.log(x);"], { start: 40 }).split("\n").slice(3).join("\n");
  assert.deepEqual(rules(twoHunks), ["R18 minor"]);
});

test("comments: code shapes a line-by-line reader can misread are still checked", () => {
  // A line that starts with "*" after a line of code continues the expression.
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const s = (days", "+    * rate).toFixed(2);"])), ["R4 blocking"]);
  // At the top of a hunk it is read as the inside of a doc comment opened above.
  assert.deepEqual(rules(diff("app/src/loans.js", ["+ * Never call .toFixed( here.", "+ */"])), []);
  // An escaped slash pair in a regex literal does not start a comment.
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const re = /https?:\\/\\//; const s = (x / 100).toFixed(2);"])), [
    "R4 blocking",
  ]);
  // A "//" inside a multi-line template literal does not start a comment.
  assert.deepEqual(rules(diff("app/src/loans.js", ["+  const msg = `see", "+  https://x ${due.getDate()}`;"])), ["R5 blocking"]);
});

test("output: untrusted lines, paths and import names cannot inject terminal escapes or GitHub Actions commands", () => {
  const out = format(check(diff("app/src/loans.js", ["+::error::x \u001b[31m (1).toFixed(2)"])));
  assert.ok(!out.includes("\u001b"));
  assert.ok(out.split("\n").every((line) => !line.startsWith("::")));

  const spec = format(check(diff("app/src/loans.js", ['+import x from "\u001b[2Jx";'])));
  assert.match(spec, /R14/);
  assert.ok(!spec.includes("\u001b"));

  const path = format(check(diff("app/src/\u001b[2J.js", ["+  console.log(x);"])));
  assert.match(path, /R18/);
  assert.ok(!path.includes("\u001b"));
});

test("paths: a path git writes in quotes is read, and a path with spaces in a header-only entry", () => {
  // fée.js as git writes it: in quotes, the UTF-8 bytes as octal escapes.
  const name = "app/src/f\\303\\251e.js";
  const quoted = [
    `diff --git "a/${name}" "b/${name}"`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ "b/${name}"`,
    "@@ -0,0 +1,2 @@",
    '+import pad from "left-pad";',
    "+export const fmt = (k) => (k / 100).toFixed(2);",
    "",
  ].join("\n");
  assert.equal(parseDiff(quoted)[0].path, "app/src/fée.js");
  assert.deepEqual(rules(quoted), ["R14 blocking", "R4 blocking", "R6 blocking"]);

  const spaced = parseDiff("diff --git a/app/src/a b.js b/app/src/a b.js\nindex 1111111..2222222 100644\n"
    + "Binary files a/app/src/a b.js and b/app/src/a b.js differ\n");
  assert.equal(spaced[0].path, "app/src/a b.js");
  assert.equal(spaced[0].binary, true);
});

test("CLI: exit 1 on a blocking finding, 0 on minor only, 2 on empty input or input that is not a diff", () => {
  const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8" }).status;
  assert.equal(run(diff("app/src/loans.js", ["+  return x.toFixed(2);"])), 1);
  assert.equal(run(diff("app/src/loans.js", ["+  console.log(x);"])), 0);
  assert.equal(run("just some text\n"), 2);
  // A failed `git diff` in front of the pipe leaves stdin empty: that must not pass.
  assert.equal(run(""), 2);
  assert.equal(run("\n"), 2);
});

test("CLI: exit 2 when the diff hides what the checks read: a binary file under app/, a path that cannot be read", () => {
  const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8" });
  // A .gitattributes line in the PR (`* -diff`) turns every file into this.
  const binary = (path) => `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n`
    + `Binary files a/${path} and b/${path} differ\n`;
  const hidden = run(binary(".gitattributes") + binary("app/src/loans.js"));
  assert.equal(hidden.status, 2);
  assert.match(hidden.stderr, /app\/src\/loans\.js: shown as binary/);
  // A binary file outside app/ is not read by any check.
  assert.equal(run(binary("docs/logo.png")).status, 0);
  // A quoted path without its closing quote.
  assert.equal(run('--- "a/app/src/x.js\n+++ "b/app/src/x.js\n@@ -1,1 +1,1 @@\n-a\n+b\n').status, 2);
});
