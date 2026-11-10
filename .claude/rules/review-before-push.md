# Review before every push

The owner, 10 November 2026: every PR is reviewed for UI, security and logic before it is pushed. The reviewers are
this repository's own agents (`.claude/agents/`), each in a fresh context, read-only and without a worktree, so they
are the one exception to working without agents.

1. Commit the change. Screenshot every screen it touches at 360 and 390 px, and the technician app's with text at 130%,
   and note the files' paths.
2. Spawn the three reviewers in parallel, in one message:
   - `ui-guard`, given the screenshots' paths and the design file the screens follow
   - `security-reviewer`
   - `reviewer`, given the brief and the plan the change answers to
3. Fix what they return as CHANGES REQUIRED or FAIL, and commit. A finding is left unfixed only where its reviewer
   agrees, on its next look, that it can wait and still gives PASS; the PR's note says which, and why. A secret found
   in a commit is not fixed by a later commit, since the push sends every commit: rebuild the unpushed branch without
   it (a fresh branch from origin/main, the commits picked onto it), and have the secret rotated. A fix is a new
   change, so each reviewer looks again, told the commit it last reviewed and what it found:
   - `reviewer` reviews every fix in full: a fix is always a change of logic.
   - `ui-guard` and `security-reviewer`, where their last verdict was PASS, review the change again only where the fix
     touches their part (what is drawn: `apps/`, `packages/ui`, `packages/brand`, `site/`, `design/`; what runs or
     ships: code, migrations, scripts, hooks, CI, dependencies, configuration); otherwise they confirm that nothing in
     it changed since their PASS, and that confirmation is their PASS for the change as it now stands.
   - Where their last verdict was not PASS, they first check each of their findings is resolved, then review the
     change as it now stands.
4. Record each verdict as the reviewer gave it, with the key it gave (each reviewer runs
   `node .claude/hooks/review-gate.mjs key` before it reads, and ends its report with that key):
   `node .claude/hooks/review-gate.mjs record <ui|security|logic> <PASS|FAIL> <key> "<one line>"`.
   It refuses a key that is not the change now checked out, so an edit made after a review cannot take its verdict.
   Never record a PASS a reviewer did not give, and never carry one over from an earlier version of the change.
5. `git fetch origin`, then push. Git's pre-push hook holds every branch or tag the push sends, but one main already
   holds, until all three are PASS for its change, however the push is started in Git Bash or PowerShell and from
   whichever worktree; it also holds a push while origin/main is behind the remote's main. Merging main into the
   branch keeps the reviews unless the merge changes the branch's own lines or the lines beside them; any other edit,
   a space included, needs them again. WSL's git does not run the hook, so a push through WSL is refused.

## The gate

Install it in each checkout the agent works in, and again whenever `.claude/hooks/review-gate.mjs` changes:
`node .claude/hooks/review-gate.mjs install`. It copies the gate into the repository's own git folder
(`.git/claude-gate`), where switching branches cannot remove it, points git's hooks there, and adds its tool-call
guard to the checkout's `.claude/settings.local.json`, which no branch carries. Until it is installed as it stands, a
push is refused. The guard also refuses any command that would step around the hook: `--no-verify`, another hooks
path, clearing `CLAUDECODE`, setting a git alias, or writing to the gate's files. Its cases are in
`test/node/tooling/review-gate.test.ts`.

The gate holds the coding agent, whose shells Claude Code marks with `CLAUDECODE=1`, to this rule in ordinary work.
It cannot stop an agent set on defeating it, and it does not hold a person's own pushes.
