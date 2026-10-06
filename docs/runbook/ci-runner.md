# The CI runner

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

**Every job runs on GitHub's own runners**, `runs-on: ubuntu-latest` in each job of every workflow; since 4 October 2026 no variable can move them (`test/node/tooling/ci-workflow.test.ts` holds every workflow to it). The repository is public, so the minutes are free and the jobs run side by side, each on a runner of four cores: the unit tests take four workers, the browser tests three (`vitest.config.ts`, `playwright.config.ts`). Every push to a pull request runs the full suite: the static checks, the unit and contract tests with coverage, the build, every browser-test project and Lighthouse, the deployed code on new migrations and the local smoke. A check that already passed on the same files is not run again (docs/decisions/0006-deployment-pipeline.md, "Checks are not repeated"), and adding a label starts no run. The last two jobs, "full suite" and "checks", pass only when every job they wait on passed or was skipped (`scripts/ci/ci-gate.ts`).

**The owner's machine is retired.** Its runner, `maneman-runner` (`maneman-pc`, built from `ops/runner/`), was shut down on 2 October 2026, and must not come back while the repository is public: a fork's pull request would run its own code on that machine. On a private repository only, it could: the machine on, with Docker Desktop running, the image built and registered once with a token (it lasts an hour), and started again without it, so the token is not left in the container's settings:

```sh
docker build -t maneman-runner:2.337.0 ops/runner
token=$(gh api -X POST repos/techadmin-maneman/web/actions/runners/registration-token -q .token)
docker run -d --name maneman-runner --restart unless-stopped --shm-size=2g \
  -v maneman-runner:/home/runner/actions-runner -e REPOSITORY=techadmin-maneman/web -e RUNNER_TOKEN="$token" \
  maneman-runner:2.337.0
docker rm -f maneman-runner   # once the logs say "Listening for Jobs"
docker run -d --name maneman-runner --restart unless-stopped --shm-size=2g \
  -v maneman-runner:/home/runner/actions-runner -e REPOSITORY=techadmin-maneman/web maneman-runner:2.337.0
```

Then each job's `runs-on` names its label, `[self-hosted, maneman]`, in place of `ubuntu-latest`, and the test above changes with them. A second runner takes its own name and volume (`-e RUNNER_NAME=maneman-pc-2`, `-v maneman-runner-2:…`): without a name the entrypoint registers `maneman-pc`, and `--replace` would take the first one's place.

## Flaky browser tests

A pull request's run retries a failed browser test once, and passes when the retry does. Every night at 3 am in India, `nightly-browser.yml` runs every browser-test project on `main` with `--fail-on-flaky-tests`, so a test that passed only on its retry fails that run, and GitHub e-mails whoever watches the repository. The run's `playwright-traces` artifact holds the failed attempt. Fix the test, or the race it found, before the next one; the run can be started by hand from the Actions tab.
