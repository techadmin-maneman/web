// The review gate: the coding agent pushes nothing until the change has been reviewed for UI, security and logic
// (.claude/rules/review-before-push.md). It holds the agent to the rule in ordinary work; it cannot stop an agent set
// on defeating it, and it does not try to stop a person. Its uses:
//
//   node .claude/hooks/review-gate.mjs install
//     copies the gate into the repository's own git folder (<git common dir>/claude-gate), where switching branches
//     cannot remove it; points git's hooks there; and adds the tool-call guard to .claude/settings.local.json. Run it
//     once per clone, and again whenever this file changes (the guard says so).
//
//   node .claude/hooks/review-gate.mjs record <ui|security|logic> <PASS|FAIL> <key> [note]
//     records one review's verdict for the checked-out branch's change as it stands.
//
//   node .claude/hooks/review-gate.mjs key [commit]
//     prints a change's key (test/node/tooling/review-gate.test.ts).
//
//   pre-push, from the installed hook: git hands it every ref a push sends, however the push was started; each must
//     have passed all three reviews. Claude Code marks its shells with CLAUDECODE=1; a person's own pushes, from a
//     terminal without it, are not held.
//
//   As a PreToolUse hook: refuses a command that would step around the pre-push hook, and a push before the gate is
//     installed as it stands.
//
// A change is the diff from its merge base with origin/main to the commit pushed: its lines exactly (git's patch id,
// whitespace kept, three lines of context), and its binary files by their contents. Merging main into the branch keeps
// the key unless the merge changes the branch's own lines or the lines beside them; any other edit needs the reviews
// again.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KINDS = ["ui", "security", "logic"];
const HERE = fileURLToPath(import.meta.url);
const NOTHING = /^0+$/;
const ONE_GIGABYTE = 1024 * 1024 * 1024;
const GATE_FOLDER = "claude-gate";
const SHELL_TOOLS = [
  "Bash",
  "PowerShell",
  "mcp__plugin_desktop-commander_desktop-commander__start_process",
  "mcp__plugin_desktop-commander_desktop-commander__interact_with_process",
];
const FILE_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

/** git's output as bytes, untouched, with no setting of the user's changing what a diff says. */
const gitBytes = (cwd, args, input) =>
  execFileSync("git", args, { cwd, input, maxBuffer: ONE_GIGABYTE, stdio: ["pipe", "pipe", "pipe"] });
const git = (cwd, args) => gitBytes(cwd, args).toString("utf8").trim();
const DIFF = [
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.relative=false",
  "diff",
  "-U3",
  "--diff-algorithm=myers",
  "--no-renames",
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

/** A change's key: the commit's diff from where it left main, as exactly as the reviews read it. */
export function changeKey(cwd, commit = "HEAD") {
  const base = git(cwd, ["merge-base", "origin/main", commit]);
  const range = `${base}..${commit}`;
  const diff = gitBytes(cwd, [...DIFF, range]);
  if (diff.length === 0) return "nothing-changed";
  // The text's lines, binaries left out of the diff patch-id reads: a binary's encoding could pass for a patch's head.
  const ids = gitBytes(cwd, ["patch-id", "--verbatim"], diff).toString("utf8").trim().split("\n").filter(Boolean);
  if (ids.length > 1) throw new Error("the diff reads as more than one patch");
  const binaries = git(cwd, ["diff", "--numstat", "--no-renames", "--no-ext-diff", "-z", range])
    .split("\0")
    .filter((record) => record.startsWith("-\t-\t"))
    .map((record) => record.slice(4))
    .sort()
    .map((path) => `${path}:${blobAt(cwd, commit, path)}`);
  return createHash("sha256")
    .update([ids[0]?.split(" ")[0] ?? "", ...binaries].join("\n"))
    .digest("hex")
    .slice(0, 40);
}

function blobAt(cwd, commit, path) {
  try {
    return git(cwd, ["rev-parse", `${commit}:${path}`]);
  } catch {
    return "deleted";
  }
}

/** The repository's shared git folder, the same from every worktree; null outside a repository. */
function commonDir(cwd) {
  try {
    return resolve(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  } catch {
    return null;
  }
}

/** The repository this copy of the gate belongs to, by its shared git folder: installed, or in a checkout. */
const OWN = dirname(HERE).toLowerCase().endsWith(GATE_FOLDER)
  ? dirname(dirname(HERE))
  : commonDir(resolve(dirname(HERE), "../.."));
const same = (one, other) => one !== null && other !== null && one.toLowerCase() === other.toLowerCase();

const stampPath = (cwd, key) => join(commonDir(cwd) ?? join(cwd, ".git"), "claude-reviews", `${key}.json`);

function readStamp(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * A verdict, recorded against the key the reviewer read (`key`, which each reviewer gives with its verdict), and only
 * while that is still the change checked out: an edit made after the review cannot take its verdict with it.
 */
function record([kind, verdict, reviewed, ...note]) {
  if (
    !KINDS.includes(kind) ||
    !["PASS", "FAIL"].includes(verdict) ||
    !/^([0-9a-f]{40}|nothing-changed)$/.test(reviewed ?? "")
  ) {
    console.error(
      "usage: node .claude/hooks/review-gate.mjs record <ui|security|logic> <PASS|FAIL> <the key the reviewer gave> [note]",
    );
    process.exit(1);
  }
  const cwd = process.cwd();
  const key = changeKey(cwd);
  if (reviewed !== key) {
    console.error(`The change has moved since it was reviewed (reviewed ${reviewed}, now ${key}): review it again.`);
    process.exit(1);
  }
  const path = stampPath(cwd, key);
  mkdirSync(dirname(path), { recursive: true });
  const stamp = readStamp(path);
  stamp[kind] = { verdict, note: note.join(" "), head: git(cwd, ["rev-parse", "HEAD"]), at: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(`review ${kind}: ${verdict} for change ${key}`);
}

// ---- Installing --------------------------------------------------------------------------------------------------------

/** The hook git runs before a push: the installed gate, with nothing of the caller's loaded into node first. */
const PRE_PUSH = `#!/bin/sh
# Installed by .claude/hooks/review-gate.mjs install; holds the coding agent's push until its change has passed its three
# reviews (.claude/rules/review-before-push.md). A person's own pushes, without CLAUDECODE=1, are not held.
[ "$CLAUDECODE" = "1" ] || exit 0
unset NODE_OPTIONS NODE_PATH
exec node "$(dirname "$0")/review-gate.mjs" pre-push "$@"
`;

const installedDir = (cwd) => {
  const common = commonDir(cwd);
  return common === null ? null : join(common, GATE_FOLDER);
};

/** This checkout's own settings, which no branch carries, and the guard command they hold. */
const localSettingsPath = (cwd) => join(git(cwd, ["rev-parse", "--show-toplevel"]), ".claude", "settings.local.json");
const guardCommand = (dir) => `node "${join(dir, "review-gate.mjs").replace(/\\/g, "/")}" || exit 2`;

/** A settings file's JSON, a byte-order mark (as PowerShell writes one) taken off; empty where there is none. */
function readSettings(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) : {};
}

/** Whether the gate is installed for this repository and checkout as this copy of it stands. */
function installed(cwd) {
  const dir = installedDir(cwd);
  if (dir === null || !existsSync(join(dir, "pre-push")) || !existsSync(join(dir, "review-gate.mjs"))) return false;
  try {
    if (!same(resolve(cwd, git(cwd, ["config", "--get", "core.hooksPath"])), dir)) return false;
    if (
      !JSON.stringify(readSettings(localSettingsPath(cwd))).includes(JSON.stringify(guardCommand(dir)).slice(1, -1))
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return readFileSync(join(dir, "review-gate.mjs"), "utf8") === readFileSync(HERE, "utf8");
}

function install() {
  const cwd = process.cwd();
  const dir = installedDir(cwd);
  if (dir === null) throw new Error("not in a git repository");
  // The settings are read first, so one that cannot be read stops the install before anything is changed.
  const settingsPath = localSettingsPath(cwd);
  const settings = readSettings(settingsPath);
  mkdirSync(dir, { recursive: true });
  copyFileSync(HERE, join(dir, "review-gate.mjs"));
  writeFileSync(join(dir, "pre-push"), PRE_PUSH, { mode: 0o755 });
  git(cwd, ["config", "core.hooksPath", dir.replace(/\\/g, "/")]);
  // The tool-call guard, in this checkout's own settings: a switch of branch leaves it.
  settings.hooks ??= {};
  const kept = (settings.hooks.PreToolUse ?? []).filter((entry) => !JSON.stringify(entry).includes(GATE_FOLDER));
  settings.hooks.PreToolUse = [
    ...kept,
    {
      matcher: [...SHELL_TOOLS, ...FILE_TOOLS].join("|"),
      hooks: [{ type: "command", command: guardCommand(dir), timeout: 60 }],
    },
  ];
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`review gate installed in ${dir}`);
}

// ---- Before a push -----------------------------------------------------------------------------------------------------

/** Each commit the push sends that has not passed all three reviews, said as why. */
function unreviewed(cwd, updates) {
  const refused = [];
  const lines = updates.split("\n").filter((line) => line.trim() !== "");
  if (lines.length > 0) {
    // A stale origin/main would move the merge base, and with it what the key takes in.
    const local = git(cwd, ["rev-parse", "origin/main"]);
    const remote = git(cwd, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0];
    if (remote !== undefined && remote !== "" && remote !== local) {
      refused.push("origin/main is behind the remote's main: git fetch origin, then push");
      return refused;
    }
  }
  for (const line of lines) {
    const [localRef, localSha, remoteRef] = line.trim().split(/\s+/);
    if (localSha === undefined || remoteRef === undefined) continue;
    // A deletion sends no change, and a branch or a tag on what main already holds sends nothing new.
    if (NOTHING.test(localSha) || isOnMain(cwd, localSha)) continue;
    const key = changeKey(cwd, localSha);
    const stamp = readStamp(stampPath(cwd, key));
    const missing = KINDS.filter((kind) => stamp[kind]?.verdict !== "PASS");
    if (missing.length > 0) refused.push(`${localRef} -> ${remoteRef} (change ${key}): ${missing.join(", ")}`);
  }
  return refused;
}

function isOnMain(cwd, sha) {
  try {
    gitBytes(cwd, ["merge-base", "--is-ancestor", git(cwd, ["rev-parse", `${sha}^{commit}`]), "origin/main"]);
    return true;
  } catch {
    return false;
  }
}

async function prePush() {
  if (process.env.CLAUDECODE !== "1") return;
  let updates = "";
  for await (const chunk of process.stdin) updates += chunk;
  let refused;
  try {
    refused = unreviewed(process.cwd(), updates);
  } catch (error) {
    refused = [`the push could not be checked: ${String(error?.message ?? error).split("\n")[0]}`];
  }
  if (refused.length === 0) return;
  console.error(
    [
      "Push held until the change has passed its three reviews. Missing or failed:",
      ...refused.map((reason) => `  ${reason}`),
      "Run the reviews in .claude/rules/review-before-push.md, fix what they find, then record each verdict:",
      "  node .claude/hooks/review-gate.mjs record <ui|security|logic> PASS <the key the reviewer gave>",
    ].join("\n"),
  );
  process.exit(1);
}

// ---- The tool-call guard -----------------------------------------------------------------------------------------------

/** The word push as a command uses it: not in pre-push, a path, or Push-Location. */
const PUSH = /(?<![\w./-])push\b(?!-)/;
/** What the gate lives in, or keeps its settings in, by name. */
const GATE_FILES = /claude-gate|claude-reviews|settings\.local\.json|\.git[\\/]+config\b|\.git[\\/]+hooks\b/i;
/** A command that writes, as a word of its own: `node` runs Node, where `test/node/` or `--chmod` is not one. */
const WRITES =
  /(?<![\w./\\-])(rm|del|erase|mv|move|ren|rename|rmdir|cp|copy|xcopy|robocopy|install|ln|touch|tee|truncate|sed|perl|python3?|ruby|node|deno|bun|chmod|attrib|icacls|Remove-Item|Move-Item|Rename-Item|Copy-Item|Set-Content|Add-Content|Out-File|New-Item|Clear-Content)(?![\w./\\-])|>/i;

/** Why a command may not run, or null: it would step around the pre-push hook, or push before the gate is installed. */
export function refusal(command, cwd) {
  // Quotes, backticks and backslashes taken out, so neither `--no-v""erify` nor `git pu\sh` hides what it says.
  const plain = command.replace(/["'`\\^]/g, "");
  // A redirection's target is not a value being set: `git config --get core.hooksPath 2>/dev/null` only reads.
  const unredirected = plain.replace(/\d*>>?(&\d+|\s*[^\s;&|]+)?/g, " ");
  const stepsAround =
    /--no-v(e(r(i(fy?)?)?)?)?\b/.test(plain) ||
    // The hook unsets what node would load first, so only the agent's own mark is the guard's to keep.
    /\bCLAUDECODE\b/.test(plain) ||
    /GIT_CONFIG_|GIT_DIR\b|GIT_COMMON_DIR\b/.test(plain) ||
    /-c\s*core\.hooks/i.test(plain) ||
    // A config command that names the hooks path and gives it a value or changes it; one that only reads it is fine.
    unredirected
      .split(/[;&|\n]/)
      .some(
        (part) =>
          /\bconfig\b/.test(part) &&
          /core\.hookspath/i.test(part) &&
          (/core\.hookspath\s*(=|\s+[^\s-])/i.test(part) ||
            /(--|\b)(unset|unset-all|replace-all|add|remove-section|rename-section|set|edit)\b/i.test(part)),
      ) ||
    (/\bconfig\b[^;&|\n]*\balias\./i.test(plain) &&
      !/\bconfig\s+(--\S+\s+)*(--get|--get-all|--list|-l|get|list)\b/i.test(plain)) ||
    /\b(send-pack|remote-https?|receive-pack)\b/.test(plain) ||
    (GATE_FILES.test(plain) &&
      WRITES.test(unredirected.replace(/\bnode\s+\S*review-gate\.mjs\s+(record|key|install)\b/g, ""))) ||
    />>?\s*\S*(claude-gate|settings\.local\.json|\.git[\\/]+config|\.git[\\/]+hooks)/i.test(plain);
  if (stepsAround) return "This command would step around the pre-push hook that holds unreviewed pushes.";
  if (/\bwsl(\.exe)?\b/i.test(plain) && PUSH.test(plain)) {
    return "WSL's git does not run this repository's pre-push hook: push from Git Bash or PowerShell.";
  }
  if (PUSH.test(plain) && same(commonDir(cwd), OWN) && !installed(cwd)) {
    return "The review gate is not installed as it stands: run node .claude/hooks/review-gate.mjs install";
  }
  return null;
}

/** Why a file tool may not write this file, or null: the gate's own files are not edited by hand. */
export function fileRefusal(path) {
  return GATE_FILES.test(path) ? "The review gate's files are changed by its install, not by hand." : null;
}

async function toolCall() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let call;
  try {
    call = JSON.parse(input || "{}");
  } catch {
    return;
  }
  const cwd = call.cwd ?? process.cwd();
  const path = call.tool_input?.file_path ?? call.tool_input?.notebook_path;
  const command = call.tool_input?.command ?? call.tool_input?.input;
  let why = null;
  if (typeof path === "string") why = fileRefusal(path);
  else if (typeof command === "string") why = refusal(command, cwd);
  if (why === null) return;
  console.error(`${why} (.claude/rules/review-before-push.md)`);
  process.exit(2);
}

/** Whether this file was run as a script rather than imported: by its real path, through a junction or not. */
function runAsScript() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]).toLowerCase() === realpathSync(HERE).toLowerCase();
  } catch {
    return false;
  }
}

if (import.meta.main ?? runAsScript()) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "record") record(rest);
  else if (mode === "key") console.log(changeKey(process.cwd(), rest[0]));
  else if (mode === "install") install();
  else if (mode === "pre-push") await prePush();
  else await toolCall();
}
