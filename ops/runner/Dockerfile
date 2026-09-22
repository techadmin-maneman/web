# The CI runner on the owner's machine (docs/decisions/0006-deployment-pipeline.md,
# "The runner"). Ubuntu, as GitHub's own runners are; GitHub's runner agent and
# actionlint, pinned and checked. Jobs run as an unprivileged user with sudo,
# which Playwright needs for Chromium's system libraries. Nothing from the
# machine is mounted: a job sees only what it checks out.

FROM ubuntu:24.04

ARG RUNNER_VERSION=2.337.0
ARG RUNNER_SHA256=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613
ARG ACTIONLINT_VERSION=1.7.12
ARG ACTIONLINT_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update   && apt-get install -y --no-install-recommends ca-certificates curl git jq sudo tar unzip xz-utils zstd   && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/actionlint.tgz     "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"   && echo "${ACTIONLINT_SHA256}  /tmp/actionlint.tgz" | sha256sum -c -   && tar -xzf /tmp/actionlint.tgz -C /usr/local/bin actionlint   && rm /tmp/actionlint.tgz

RUN useradd --create-home --shell /bin/bash runner   && echo "runner ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/runner

USER runner
WORKDIR /home/runner/actions-runner
RUN curl -fsSL -o runner.tgz     "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"   && echo "${RUNNER_SHA256}  runner.tgz" | sha256sum -c -   && tar -xzf runner.tgz   && rm runner.tgz   && sudo ./bin/installdependencies.sh

COPY --chown=runner --chmod=755 entrypoint.sh /home/runner/entrypoint.sh
# The runner closes its session with GitHub on Ctrl+C, not on docker stop's default SIGTERM; without it, a
# restarted runner waits for GitHub to drop the old session.
STOPSIGNAL SIGINT
ENTRYPOINT ["/home/runner/entrypoint.sh"]
