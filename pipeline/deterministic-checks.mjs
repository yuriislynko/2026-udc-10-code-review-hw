#!/usr/bin/env node
// Deterministic checks from docs/review-standard.md, run over a unified diff.
//
//   node pipeline/deterministic-checks.mjs review-queue/pr-3/change.diff
//   git diff origin/main...HEAD | node pipeline/deterministic-checks.mjs
//
// Only lines the diff adds (and, for R6, removes) are checked, so code already in
// app/ never fails a pull request. Comments are stripped before the code patterns
// run (a block comment or a template literal is followed across the lines of a
// hunk); tool directives, secrets and personal data are searched in comments too.
// Exit code: 0 = no blocking finding, 1 = a blocking rule failed, 2 = empty or bad
// input, so a `git diff` that fails upstream of the pipe cannot pass as a clean diff.
// Findings under minor rules are printed and never fail the run.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SRC = /^app\/src\/.+\.[cm]?js$/;
const TEST = /^app\/test\/.+\.[cm]?js$/;
const APP_CODE = /^app\/.+\.[cm]?js$/;
const APP = /^app\//;
const CHANGELOG = "app/CHANGELOG.md";

// R4: human formatting of money. The hryvnia label and sign are written as
// escapes to keep this file ASCII.
const MONEY_FORMAT = /\.toFixed\s*\(|\.toLocaleString\s*\(|\bIntl\.NumberFormat\b|\u0433\u0440\u043d|\u20b4|\bUAH\b/i;

// R5: local-time date handling.
const LOCAL_TIME = [
  /\.(?:get|set)(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\s*\(/,
  /\.(?:getYear|getTimezoneOffset|toDateString|toTimeString|toLocaleDateString|toLocaleTimeString)\s*\(/,
  /["'`]\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?["'`]/, // no zone: parsed as local
];
const NEW_DATE = /\bnew Date\s*\(/g; // with more than one argument: see localDateConstructor

// R11: tool directives. No such tool runs in this repo, so a directive can only
// switch a check off.
const TOOL_DIRECTIVE =
  /\beslint-disable\b|\b(?:c8|istanbul|v8)\s+ignore\b|\bnode:coverage\s+(?:disable|enable|ignore)\b|@ts-(?:ignore|nocheck|expect-error)\b/;

// R6 and R17.
const EXPORT = /^\s*export\b/;
const EXPORT_FUNCTION = /^\s*export\s+(?:async\s+)?function\b/;

// R8: skipped or focused tests (node:test).
const SKIPPED_TEST = [
  /\b(?:test|it|describe|suite)\.(?:skip|only|todo)\s*\(/,
  /\b(?:test|it|describe|suite)\s*\([^)]*\{[^}]*\b(?:skip|only|todo)\s*:/,
  /\bt\.(?:skip|todo)\s*\(/,
];

// R14: npm dependencies.
const DEPENDENCY_KEY =
  /"(?:dependencies|devDependencies|peerDependencies|optionalDependencies|bundleDependencies|bundledDependencies)"\s*:/;
const LOCK_OR_MODULES = /^app\/(?:.*\/)?(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$|^app\/node_modules\//;
// Run on code with string contents blanked, so `from "x"` inside a test name or a
// message is not an import; the specifier is read back from the same position.
// A template literal is a specifier too: import(`x`) loads "x".
const IMPORT_SPECIFIERS = [
  /\bfrom\s*["'`]([^"'`]+)["'`]/dg,
  /\bimport\s*\(?\s*["'`]([^"'`]+)["'`]/dg,
  /\brequire\s*\(\s*["'`]([^"'`]+)["'`]/dg,
];
// import(name) or require(path.join(...)): the specifier is computed, so it cannot be
// checked against the list. `import.meta` and a method named require are not calls.
const COMPUTED_IMPORT = /(?<![\w$.])(?:import|require)\s*\(\s*(?=[^\s"'`)])/;

// R15: credentials and personal data that does not look synthetic. SECRETS is also
// used by check-review-format.mjs on the reviewer's output.
export const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  /\bgithub_pat_\w{20,}/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i, // user:password@host
  /\b(?:api[_-]?key|secret|password|passwd|token)\w*["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i,
];
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const SYNTHETIC_DOMAIN = /(?:^|\.)(?:invalid|test|example|localhost)$|^example\.(?:com|net|org)$/i;
const UA_PHONE = /(?<!\d)\+?380\d{9}(?!\d)/g;
// The same number with its digits grouped: "+380 67 000 00 00", "+38 (067) 000-00-00".
const GROUPED_DIGITS = /\+?\(?\d(?:[\s().-]{0,2}\d)+/g;
const SYNTHETIC_PHONE = /^38000\d{7}$/; // digits only; operator code 00 does not exist

// R18: debugging leftovers.
const LEFTOVER = /\bconsole\.(?:log|debug|trace)\s*\(|^\s*debugger\b/;

// --- diff parsing --------------------------------------------------------------

function newFile(files) {
  const file = { path: null, oldPath: null, hunks: 0, added: [], removed: [], context: [] };
  files.push(file);
  return file;
}

function cleanPath(header) {
  const path = header.split("\t")[0].trim();
  return path === "/dev/null" ? null : path.replace(/^[ab]\//, "");
}

/**
 * Parses a unified diff into files. Each added line keeps its new-side line number
 * and the new-side line right above it: null at the top of a file, undefined when
 * the diff does not show it. Context lines are kept with their new-side numbers.
 */
export function parseDiff(text) {
  const files = [];
  let file = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  let above;

  for (const raw of text.split(/\r?\n/)) {
    if (file && (oldLeft > 0 || newLeft > 0)) {
      const mark = raw[0];
      const body = raw.slice(1);
      if (mark === "+") {
        file.added.push({ line: newNo, text: body, above });
        above = body;
        newNo++;
        newLeft--;
      } else if (mark === "-") {
        file.removed.push({ line: oldNo, text: body });
        oldNo++;
        oldLeft--;
      } else if (mark === " " || raw === "") {
        file.context.push({ line: newNo, text: body });
        above = body;
        oldNo++;
        newNo++;
        oldLeft--;
        newLeft--;
      }
      continue; // "\ No newline at end of file" is not a line
    }

    const git = /^diff --git a\/(\S+) b\/(\S+)$/.exec(raw);
    if (raw.startsWith("diff --git ")) {
      file = newFile(files);
      if (git) [, file.oldPath, file.path] = git;
      continue;
    }
    if (raw.startsWith("--- ")) {
      if (!file || file.hunks > 0) file = newFile(files);
      file.oldPath = cleanPath(raw.slice(4));
      continue;
    }
    if (raw.startsWith("+++ ") && file) {
      file.path = cleanPath(raw.slice(4));
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk && file) {
      file.hunks++;
      oldNo = Number(hunk[1]);
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newNo = Number(hunk[3]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
      above = newNo <= 1 ? null : undefined;
    }
  }
  return files;
}

/**
 * Removes comments from one line of JavaScript. A line-by-line heuristic; `state`
 * carries what is still open at the end of a line (a block comment, a template
 * literal) to the next one, and whether a line of code has been read yet.
 */
export function codeOf(line, state = { inBlock: false }) {
  let start = 0;
  let out = "";
  let quote = null;
  if (state.inBlock) {
    const end = line.indexOf("*/");
    if (end === -1) return "";
    state.inBlock = false;
    start = end + 2;
  } else if (state.inTemplate) {
    out = quote = "`"; // the template literal opened on a line above
  } else if (!state.seenCode && /^\s*\*/.test(line)) {
    // No line above shows where the hunk starts: read a leading "*" as the inside of
    // a /** ... */ block that opened above the hunk. After a line of code it is code.
    return "";
  }
  state.seenCode = true;
  state.inTemplate = false;
  for (let i = start; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      out += c;
      if (c === "\\") out += line[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    // Outside a string a backslash belongs to a regex literal: /https?:\/\// holds no comment.
    if (c === "\\") {
      out += c + (line[++i] ?? "");
      continue;
    }
    if (c === "/" && line[i + 1] === "/") break;
    if (c === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) {
        state.inBlock = true;
        break;
      }
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c;
  }
  if (quote === "`") {
    state.inTemplate = true;
    out += "`"; // closed here, so blankStrings sees the line's part of it as a string
  }
  return out;
}

/**
 * The code of every added and context line of a file, by new-side line number, so a
 * block comment or a template literal opened on any line of a hunk is followed to
 * its end, and a call can be read across lines.
 */
function hunkCode(file) {
  const lines = [...file.context, ...file.added].sort((a, b) => a.line - b.line);
  const code = new Map();
  let state = { inBlock: false };
  let previous = null;
  for (const { line, text } of lines) {
    if (previous === null || line !== previous + 1) state = { inBlock: false }; // a new hunk
    code.set(line, codeOf(text, state));
    previous = line;
  }
  return code;
}

/** The code of `line` and of the lines right after it in the same hunk, joined. */
function codeFrom(codes, line, count = 10) {
  const parts = [];
  for (let n = line; n < line + count && codes.has(n); n++) parts.push(codes.get(n));
  return parts.join(" ");
}

/** Blanks what is inside string literals, so a test name cannot end a pattern early. */
function blankStrings(code) {
  return code.replace(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g, (_, q, body) => q + " ".repeat(body.length) + q);
}

function importsOf(code) {
  const blanked = blankStrings(code); // same length as code
  return IMPORT_SPECIFIERS.flatMap((re) => [...blanked.matchAll(re)].map((m) => code.slice(...m.indices[1])));
}

/**
 * True when a `new Date(...)` that starts before `limit` gets more than one argument:
 * new Date(y, m, d) is local time. `code` may run on past the line, so a call split
 * across lines is read to its end. Commas inside nested calls (Math.max(a, b),
 * Date.UTC(y, m, d)) and inside strings do not count.
 */
function localDateConstructor(code, limit = code.length) {
  for (const m of code.matchAll(NEW_DATE)) {
    if (m.index >= limit) break;
    let depth = 1;
    let quote = null;
    for (let i = m.index + m[0].length; i < code.length && depth > 0; i++) {
      const c = code[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 1) return true;
    }
  }
  return false;
}

function personalData(text) {
  const found = [];
  for (const m of text.matchAll(EMAIL)) if (!SYNTHETIC_DOMAIN.test(m[1])) found.push("an email");
  const phones = new Set(); // by digits, so a number both patterns match is reported once
  for (const re of [UA_PHONE, GROUPED_DIGITS]) {
    for (const m of text.matchAll(re)) {
      const digits = m[0].replace(/\D/g, "");
      if (/^380\d{9}$/.test(digits) && !SYNTHETIC_PHONE.test(digits)) phones.add(digits);
    }
  }
  phones.forEach(() => found.push("a phone number"));
  return found;
}

// --- checks --------------------------------------------------------------------

/** Runs every check over a unified diff and returns the findings, blocking first. */
export function check(diffText) {
  const files = parseDiff(diffText);
  const findings = [];
  const add = (rule, level, file, line, message, text = null) =>
    findings.push({ rule, level, file, line, message, text });
  const changelogUpdated = files.some((f) => f.path === CHANGELOG && f.added.length > 0);

  for (const f of files) {
    const name = f.path ?? f.oldPath;
    if (!name) continue;

    if (LOCK_OR_MODULES.test(name) && f.added.length > 0) {
      add("R14", "blocking", name, f.added[0].line, "lock file or node_modules added under app/");
    }

    const codes = APP_CODE.test(name) ? hunkCode(f) : null;

    for (const { line, text, above } of f.added) {
      const code = codes ? codes.get(line) : text;

      if (SRC.test(name)) {
        if (MONEY_FORMAT.test(code)) {
          add("R4", "blocking", name, line, "money formatting or currency label in src/; the client formats", text);
        }
        if (LOCAL_TIME.some((re) => re.test(code)) || localDateConstructor(codeFrom(codes, line), code.length)) {
          add("R5", "blocking", name, line, "local-time date handling; dates are computed in UTC", text);
        }
        if (EXPORT_FUNCTION.test(code) && above !== undefined && !(above ?? "").trim().endsWith("*/")) {
          add("R17", "minor", name, line, "exported function without a /** ... */ doc comment right above it", text);
        }
        if (LEFTOVER.test(code)) {
          add("R18", "minor", name, line, "debugging leftover", text);
        }
      }

      if (TEST.test(name) && SKIPPED_TEST.some((re) => re.test(blankStrings(code)))) {
        add("R8", "blocking", name, line, "skipped, focused or todo test", text);
      }

      if (APP_CODE.test(name)) {
        // Directives live in comments, so the raw line is searched.
        if (TOOL_DIRECTIVE.test(text)) {
          add("R11", "blocking", name, line, "tool directive; no such tool runs here, so it can only switch a check off", text);
        }
        for (const spec of importsOf(code)) {
          if (!/^(?:node:|\.\.?\/)/.test(spec)) {
            add("R14", "blocking", name, line, `import of "${spec}"; only node: built-ins and local files`, text);
          }
        }
        if (COMPUTED_IMPORT.test(blankStrings(code))) {
          add("R14", "blocking", name, line, "import() or require() with a computed specifier; only node: built-ins and local files", text);
        }
      }
      if (name === "app/package.json" && DEPENDENCY_KEY.test(text)) {
        add("R14", "blocking", name, line, "dependency section in app/package.json", text);
      }

      // The matched line is not printed: the log must not repeat a secret.
      if (APP.test(name)) {
        if (SECRETS.some((re) => re.test(text))) {
          add("R15", "blocking", name, line, "looks like a credential (line not shown)");
        }
        for (const kind of personalData(text)) {
          add("R15", "blocking", name, line, `${kind} outside the synthetic ranges (line not shown)`);
        }
      }
    }

    if (SRC.test(name) && !changelogUpdated) {
      const exports = [
        ...f.added.filter((a) => EXPORT.test(codes.get(a.line))).map((a) => ({ ...a, where: a.line })),
        ...f.removed.filter((r) => EXPORT.test(codeOf(r.text))).map((r) => ({ ...r, where: `${r.line} (removed)` })),
      ];
      if (exports.length > 0) {
        add(
          "R6",
          "blocking",
          name,
          exports[0].where,
          `${exports.length} export line(s) changed, but ${CHANGELOG} has no added line`,
          exports[0].text,
        );
      }
    }
  }

  return findings.sort((a, b) => (a.level === b.level ? 0 : a.level === "blocking" ? -1 : 1));
}

// --- output --------------------------------------------------------------------

// Everything taken from the diff (lines, file paths, import names) is untrusted: drop
// control and bidi characters, and never start a log line with it (GitHub Actions
// treats a line starting with "::" as a command).
function shown(text) {
  const clean = text
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "?")
    .trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean;
}

/** Formats findings as plain text, one finding per line plus the offending line. */
export function format(findings) {
  if (findings.length === 0) return "Deterministic checks: no findings.";
  const blocking = findings.filter((f) => f.level === "blocking").length;
  const lines = [`Deterministic checks: ${blocking} blocking, ${findings.length - blocking} minor.`];
  for (const f of findings) {
    lines.push(`  ${f.level === "blocking" ? "BLOCK" : "minor"}  ${f.rule}  ${shown(f.file)}:${f.line}  ${shown(f.message)}`);
    if (f.text !== null) lines.push(`         + ${shown(f.text)}`);
  }
  return lines.join("\n");
}

// A pipe from `git diff` may not have data yet, so stdin is read as a stream.
async function readInput(path) {
  if (path) return readFileSync(path, "utf8");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(args) {
  const [path] = args;
  if (!path && process.stdin.isTTY) {
    console.error("usage: node pipeline/deterministic-checks.mjs <diff-file>   (or pipe a diff on stdin)");
    return 2;
  }
  let text;
  try {
    text = await readInput(path);
  } catch (error) {
    console.error(`cannot read ${path ?? "stdin"}: ${error.message}`);
    return 2;
  }
  if (text.trim() === "") {
    console.error("empty input: expected a unified diff");
    return 2;
  }
  if (parseDiff(text).length === 0) {
    console.error("input is not a unified diff");
    return 2;
  }
  const findings = check(text);
  console.log(format(findings));
  return findings.some((f) => f.level === "blocking") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
