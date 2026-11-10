// The review gate (.claude/hooks/review-gate.mjs; .claude/rules/review-before-push.md): the key a change's reviews are
// recorded against, git's pre-push hook holding the agent's push until all three have passed, and the tool-call guard
// that stops a command stepping around that hook. Each repository here is a throwaway one in the system's temp folder.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const GATE = resolve(".claude/hooks/review-gate.mjs");
const made: string[] = [];

afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true });
});

/** A person's shell: no CLAUDECODE, so nothing here is held by the gate the repository itself runs under. */
const PERSON = { ...process.env, CLAUDECODE: "" };
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: PERSON }).trim();
const gate = (cwd: string, ...args: string[]) =>
  execFileSync(process.execPath, [GATE, ...args], { cwd, encoding: "utf8", env: PERSON }).trim();

const TWELVE = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n";

/** A repository whose main holds twelve lines, on a branch from it, with origin/main where main is. */
function repository(): string {
  const folder = mkdtempSync(join(tmpdir(), "review-gate-"));
  made.push(folder);
  git(folder, "init", "-q", "-b", "main");
  git(folder, "config", "user.email", "gate@example.com");
  git(folder, "config", "user.name", "Gate");
  git(folder, "config", "core.autocrlf", "false");
  writeFileSync(join(folder, "f.txt"), TWELVE);
  git(folder, "add", ".");
  git(folder, "commit", "-qm", "base");
  git(folder, "update-ref", "refs/remotes/origin/main", "main");
  git(folder, "switch", "-qc", "feat");
  return folder;
}

const commitFile = (folder: string, path: string, contents: string | Uint8Array) => {
  writeFileSync(join(folder, path), contents);
  git(folder, "add", ".");
  git(folder, "commit", "-qm", "change");
};

describe("a change's key", () => {
  it("changes with any edit to the change, a space or a single byte included", () => {
    const folder = repository();
    commitFile(folder, "f.txt", TWELVE.replace("c\n", "C\n"));
    const reviewed = gate(folder, "key");
    commitFile(folder, "f.txt", TWELVE.replace("c\n", "C \n"));
    const spaced = gate(folder, "key");
    expect(spaced).not.toBe(reviewed);
    commitFile(folder, "f.txt", TWELVE.replace("c\n", "C \n").replace("l\n", "l  \n"));
    expect(gate(folder, "key")).not.toBe(spaced);
    commitFile(folder, "bytes.txt", new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    const latin = gate(folder, "key");
    commitFile(folder, "bytes.txt", new Uint8Array([0x63, 0x61, 0x66, 0xe8, 0x0a]));
    expect(gate(folder, "key")).not.toBe(latin);
  });

  it("stays the same when main, merged in, changed lines away from the branch's", () => {
    const folder = repository();
    commitFile(folder, "f.txt", TWELVE.replace("c\n", "C\n"));
    const reviewed = gate(folder, "key");
    git(folder, "switch", "-q", "main");
    commitFile(folder, "f.txt", TWELVE.replace("k\n", "K\n"));
    git(folder, "update-ref", "refs/remotes/origin/main", "main");
    git(folder, "switch", "-q", "feat");
    git(folder, "merge", "-q", "--no-edit", "main");
    expect(gate(folder, "key")).toBe(reviewed);
  });

  it("does not depend on the user's own diff settings", () => {
    const folder = repository();
    commitFile(folder, "f.txt", TWELVE.replace("c\n", "C\n"));
    const reviewed = gate(folder, "key");
    git(folder, "config", "diff.context", "0");
    git(folder, "config", "diff.noprefix", "true");
    expect(gate(folder, "key")).toBe(reviewed);
  });
});

describe("git's pre-push hook", () => {
  /** A repository with a bare remote holding its main, and the gate installed. */
  function wired(): string {
    const folder = repository();
    const remote = mkdtempSync(join(tmpdir(), "review-gate-remote-"));
    made.push(remote);
    git(remote, "init", "-q", "--bare");
    git(folder, "remote", "add", "origin", remote);
    git(folder, "push", "-q", "origin", "main");
    git(folder, "fetch", "-q", "origin");
    gate(folder, "install");
    commitFile(folder, "f.txt", TWELVE.replace("c\n", "C\n"));
    return folder;
  }

  /** A push of the branch, from the agent's shell or a person's: git's own exit code. */
  const push = (folder: string, agent: boolean, ref = "feat") =>
    spawnSync("git", ["push", "-q", "origin", ref], { cwd: folder, env: { ...PERSON, CLAUDECODE: agent ? "1" : "" } })
      .status;

  it("holds the agent's push of a change not yet reviewed, and lets a person's through", () => {
    const folder = wired();
    expect(push(folder, true)).not.toBe(0);
    expect(push(folder, false)).toBe(0);
  });

  it("lets the agent's push through once all three reviews have passed, and holds it again after an edit", () => {
    const folder = wired();
    gate(folder, "record", "ui", "PASS");
    gate(folder, "record", "security", "PASS");
    expect(push(folder, true)).not.toBe(0);
    gate(folder, "record", "logic", "PASS");
    expect(push(folder, true)).toBe(0);
    commitFile(folder, "f.txt", TWELVE.replace("c\n", "C\n").replace("l\n", "l \n"));
    expect(push(folder, true)).not.toBe(0);
  });

  it("holds a tag on a commit main does not hold", () => {
    const folder = wired();
    git(folder, "tag", "unreviewed");
    expect(push(folder, true, "refs/tags/unreviewed")).not.toBe(0);
  });
});

describe("the tool-call guard", () => {
  const guard = (input: Record<string, unknown>) =>
    spawnSync(process.execPath, [GATE], { input: JSON.stringify({ ...input, cwd: process.cwd() }) }).status;

  it.each([
    "ls",
    'git commit -m "x"',
    "git config --get core.hooksPath",
    "git config --get core.hooksPath 2>/dev/null",
    "grep -n hookspath .claude/hooks/review-gate.mjs",
    "cat .git/claude-gate/pre-push",
    "node .claude/hooks/review-gate.mjs install",
    "node .claude/hooks/review-gate.mjs record ui PASS",
    "git checkout HEAD -- test/node/apps/tech/a.ts && node .git/claude-gate/review-gate.mjs key",
  ])("lets %s run", (command) => {
    expect(guard({ tool_input: { command } })).toBe(0);
  });

  it.each([
    "git push --no-verify",
    "git push --no-veri",
    'git push --no-v""erify',
    "git commit --no-verify -m x",
    "CLAUDECODE= git push",
    "env -u CLAUDECODE git push",
    "NODE_OPTIONS=--import=x git push",
    "git -c core.hooksPath=/dev/null push",
    "git config core.hooksPath /tmp/elsewhere",
    "git config --global core.hooksPath x",
    "git config --unset core.hooksPath",
    "git config unset core.hooksPath",
    'git config alias.ship "!git push"',
    "git send-pack origin main",
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/x git push",
    "rm .git/claude-gate/pre-push",
    "cp nothing .git/claude-gate/pre-push",
    "echo {} > .claude/settings.local.json",
    "sed -i s/hooks/x/ .git/config",
    "wsl git push",
  ])("refuses %s", (command) => {
    expect(guard({ tool_input: { command } })).toBe(2);
  });

  it.each([".claude/settings.local.json", ".git/claude-gate/review-gate.mjs", ".git/config"])(
    "refuses a file tool's write to %s",
    (path) => {
      expect(guard({ tool_input: { file_path: path, content: "" } })).toBe(2);
    },
  );
});
