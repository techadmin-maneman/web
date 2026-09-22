#!/usr/bin/env bash
# Registers the runner with the repository the first time, with a registration
# token (docs/runbook.md, "The CI runner"), then runs it. The registration is
# kept in the container's volume, so a restart needs no new token.
set -euo pipefail
cd /home/runner/actions-runner
if [ ! -f .runner ]; then
  : "${RUNNER_TOKEN:?RUNNER_TOKEN is needed the first time: see docs/runbook.md, The CI runner}"
  ./config.sh --unattended --replace --url "https://github.com/${REPOSITORY:?}" --token "$RUNNER_TOKEN"     --name "${RUNNER_NAME:-maneman-pc}" --labels maneman --work _work
fi
exec ./run.sh
