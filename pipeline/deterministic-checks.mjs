#!/usr/bin/env node
// Deterministic checks from docs/review-standard.md, run over a unified diff.
//
//   node pipeline/deterministic-checks.mjs review-queue/pr-3/change.diff
//   git diff --text origin/main...HEAD | node pipeline/deterministic-checks.mjs
//
// Only lines the diff adds (and, for R6 and R8, removes) are checked, so code already
// in app/ never fails a pull request. Comments are stripped before the code patterns
// run (a block comment or a template literal is followed across the lines of a
// hunk); tool directives, secrets and personal data are searched in comments too.
// Exit code: 0 = no blocking finding, 1 = a blocking rule failed, 2 = empty or bad
// input, so a `git diff` that fails upstream of the pipe cannot pass as a clean diff.
// Input the checks cannot read exits 2 as well: a file path that cannot be parsed, or
// a file under app/ shown as binary (a .gitattributes line can make `git diff` print
// "Binary files ... differ" in place of the lines; --text prevents it).
// Code is read wherever Node can run it: .ts, .mts and .cts files too (Node 22 strips
// the types), and every file under app/src/ whatever its extension (require() runs a
// file of any extension as JavaScript). Code in app/ may load only files in app/.
// Findings under minor rules are printed and never fail the run.

import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = /^app\/src\/./;
const TEST = /^app\/test\/.+\.[cm]?[jt]s$/;
const APP_CODE = /^app\/(?:src\/.+|.+\.[cm]?[jt]s)$/;
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
// R8: `npm test` runs the "test" script of app/package.json, so a changed script can
// keep the tests from running. Each side of the diff is read in order to tell which
// lines sit inside "scripts"; a hunk that starts inside the object is caught by the
// key of the test scripts.
const SCRIPTS_KEY = /^\s*"scripts"\s*:/;
const TEST_SCRIPT_KEY = /^\s*"(?:pre|post)?test"\s*:/;

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

// Git writes a path with unusual characters (non-ASCII, a quote, a backslash, a control
// character) in C style: "b/app/src/f\303\251e.js", the octal escapes being UTF-8 bytes.
const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/** The path inside a C-style quoted string, the text itself when it is not quoted, null when it cannot be read. */
function unquote(text) {
  if (!text.startsWith('"')) return text;
  const bytes = [];
  for (let i = 1; i < text.length; i++) {
    const c = text[i];
    if (c === '"') return i === text.length - 1 ? Buffer.from(bytes).toString("utf8") : null;
    if (c !== "\\") {
      bytes.push(...Buffer.from(c, "utf8"));
      continue;
    }
    const octal = /^[0-3][0-7]{2}/.exec(text.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else if (C_ESCAPES[text[i + 1]] !== undefined) {
      bytes.push(C_ESCAPES[text[++i]]);
    } else {
      return null;
    }
  }
  return null; // no closing quote
}

/** The path in a ---/+++ line or a header field: null for /dev/null, undefined when it cannot be read. */
function cleanPath(field) {
  const path = unquote(field.split("\t")[0].trim());
  if (path === null) return undefined;
  return path === "/dev/null" ? null : path.replace(/^[ab]\//, "");
}

/**
 * The two paths of a `diff --git` line. Each is quoted or has no spaces; a path with
 * spaces is not quoted, and git then writes the same path twice (a rename has its own
 * "rename from" and "rename to" lines).
 */
function headerPaths(rest) {
  const pair = /^("(?:\\.|[^"\\])*"|\S+) ("(?:\\.|[^"\\])*"|\S+)$/.exec(rest);
  if (pair) return [cleanPath(pair[1]), cleanPath(pair[2])];
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === " " && rest.slice(2, half) === rest.slice(half + 3)) {
    return [cleanPath(rest.slice(0, half)), cleanPath(rest.slice(half + 1))];
  }
  return [undefined, undefined];
}

/**
 * Parses a unified diff into files. Each added line keeps its new-side line number
 * and the new-side line right above it: null at the top of a file, undefined when
 * the diff does not show it. Context lines are kept with their new-side numbers and,
 * as `old`, their old-side numbers. A file whose path cannot be read is marked
 * `unreadable`; one shown as binary, `binary`.
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
        file.context.push({ line: newNo, old: oldNo, text: body });
        above = body;
        oldNo++;
        newNo++;
        oldLeft--;
        newLeft--;
      }
      continue; // "\ No newline at end of file" is not a line
    }

    if (raw.startsWith("diff --git ")) {
      file = newFile(files);
      [file.oldPath, file.path] = headerPaths(raw.slice("diff --git ".length));
      continue;
    }
    if (raw.startsWith("--- ")) {
      if (!file || file.hunks > 0) file = newFile(files);
      file.oldPath = cleanPath(raw.slice(4));
      if (file.oldPath === undefined) file.unreadable = true;
      continue;
    }
    if (raw.startsWith("+++ ") && file) {
      file.path = cleanPath(raw.slice(4));
      if (file.path === undefined) file.unreadable = true;
      continue;
    }
    const renamed = /^rename (from|to) (.+)$/.exec(raw);
    if (renamed && file) {
      const path = unquote(renamed[2]);
      if (path === null) file.unreadable = true;
      file[renamed[1] === "from" ? "oldPath" : "path"] = path ?? undefined;
      file.renamed = true;
      continue;
    }
    if (raw.startsWith("deleted file mode ") && file) {
      file.deleted = true;
      continue;
    }
    // Mode 120000 is a symbolic link: its one "line" is the path it points to.
    if (/^new (?:file )?mode 120000$/.test(raw) && file) {
      file.symlink = true;
      continue;
    }
    if ((/^Binary files .* differ$/.test(raw) || raw === "GIT binary patch") && file) {
      file.binary = true;
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

/** The number of `{` minus the number of `}` in a line of JSON, outside strings. */
function braces(text) {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  return depth;
}

/**
 * The lines of `changed` that sit inside the "scripts" object of a package.json. One
 * side of the diff is read: its changed lines with its context lines, in line order.
 */
function insideScripts(changed, context) {
  const lines = [
    ...context.map((l) => ({ ...l, changed: false })),
    ...changed.map((l) => ({ ...l, changed: true })),
  ].sort((a, b) => a.line - b.line);
  const found = [];
  let depth = 0;
  let scripts = null; // the depth the "scripts" object opened at
  let previous = null;
  for (const line of lines) {
    if (previous === null || line.line !== previous + 1) [depth, scripts] = [0, null]; // a new hunk
    previous = line.line;
    const opens = SCRIPTS_KEY.test(line.text);
    if (line.changed && (scripts !== null || opens || TEST_SCRIPT_KEY.test(line.text))) found.push(line);
    if (opens) scripts = depth;
    depth += braces(line.text);
    if (scripts !== null && depth <= scripts) scripts = null;
  }
  return found;
}

/**
 * Files the checks cannot read: a path that cannot be parsed, or a file under app/
 * shown as binary, so its lines are not in the diff.
 */
export function unreadable(files) {
  return files.flatMap((f) => {
    const name = f.path ?? f.oldPath;
    if (f.unreadable || !name) return ["a file in the diff has a path that cannot be read"];
    if (f.binary && APP.test(name)) return [`${shown(name)}: shown as binary, its lines cannot be checked (run git diff with --text)`];
    return [];
  });
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

    if (TEST.test(f.oldPath ?? "") && (f.deleted || f.path === null || (f.renamed && !TEST.test(f.path ?? "")))) {
      add("R8", "blocking", f.oldPath, 1, "test file deleted or moved out of app/test/");
    }

    if (f.symlink && APP.test(f.path ?? "")) {
      add("R14", "blocking", f.path, 1, "symbolic link under app/; a link can load code from outside app/");
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
          } else if (spec.startsWith(".") && !APP.test(posix.join(posix.dirname(name), spec))) {
            add("R14", "blocking", name, line, `import of "${spec}" leaves app/; only files in app/`, text);
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

    if (name === "app/package.json") {
      const scripts = [
        ...insideScripts(f.added, f.context).map((a) => ({ ...a, where: a.line })),
        ...insideScripts(f.removed, f.context.map((c) => ({ line: c.old, text: c.text }))).map((r) => ({
          ...r,
          where: `${r.line} (removed)`,
        })),
      ];
      if (scripts.length > 0) {
        add(
          "R8",
          "blocking",
          name,
          scripts[0].where,
          `${scripts.length} line(s) of "scripts" changed; npm test must keep running every test`,
          scripts[0].text,
        );
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
  const files = parseDiff(text);
  if (files.length === 0) {
    console.error("input is not a unified diff");
    return 2;
  }
  const unread = unreadable(files);
  if (unread.length > 0) {
    console.error(["input the checks cannot read:", ...unread.map((m) => `  - ${m}`)].join("\n"));
    return 2;
  }
  const findings = check(text);
  console.log(format(findings));
  return findings.some((f) => f.level === "blocking") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
