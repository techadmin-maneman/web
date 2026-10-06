# 0008. Owner decisions on the platform constraints

- Status: accepted
- Date: 2026-09-21
- Topic: Platform
- Resolves: 0007

## Decisions

**1. Zone.** `maneman.in` is now an active zone on Cloudflare's Free plan, in the account `Tech@maneman.in's Account` (`a2e185075b1b8eef3bee24b72f45ace3`). Its nameservers are `georgia` and `ned.ns.cloudflare.com`, and the Google Workspace MX records came across intact. Staging and production both live in this account; both wrangler configs name it.

**2. GitHub gates.** Deferred until the paid GitHub plan. Until then:

- Checks run on every pull request, but `main` cannot require them.
- The `staging` and `production` GitHub Environments exist, and environment secrets work on the current plan (checked through the API).
- Required reviewers on `production` are refused ("Please ensure the billing plan supports the required reviewers protection rule"). A production release is still manual (`workflow_dispatch`), and the workflow still refuses a commit that is not on `main` or has not passed staging. Nobody has to approve it.

When the plan changes: require every `ci.yml` job on `main`, and add reviewers to `production`.

**3. Token isolation.** Option (b) from 0007: one account.

- Each environment's CI token gets Workers Editor on that environment's two Workers only, plus D1 Edit.
- D1 Edit is account-wide, so the staging token can reach `maneman-prod`. This is an accepted deviation from the prompt.
- The mitigations are the config check (0005), the database identity guard (0003), and staging CI naming only `maneman-staging` in its commands.
- No CI token gets zone permissions; routes are set at bootstrap (0004).

## Found while provisioning

**R2 is not enabled on the account** ("Please enable R2 through the Cloudflare Dashboard", code 10042). Enabling it needs a payment method, so it is the owner's step. The `UPLOADS` and `RESULTS` bindings are left out of `wrangler.jsonc` until then. Nothing reads them before M3, and a deploy that names missing buckets would fail. M3 adds them back, and the config check then requires them in every environment again.

**Staging answers before its DNS record exists.** The routes are attached, and Cloudflare's edge serves `staging.maneman.in` to any client that sends that hostname to a Cloudflare IP. Public DNS does not resolve it yet, but staging is not behind Access until the owner creates the Access application. Until then it serves only the placeholder page and `/api/health`.

## Consequences

- The runbook lists the owner's remaining steps: staging DNS record, Access application and service token, CI tokens, GitHub secrets, enabling R2.
- `www.maneman.in` still points at GoDaddy's parked page through its old proxied record. Routing or redirecting it is a launch decision for the front-end task.

## Update, 21 September 2026 (later the same day)

- The owner enabled R2. The four try-on buckets exist, each with a rule that expires objects after 30 days and aborts unfinished multipart uploads after one day. `UPLOADS` and `RESULTS` are back in `wrangler.jsonc` in every environment, and the config check requires them again.
- The staging DNS record and the Access application are in place. Every staging path now redirects to Cloudflare Access; production stays public.
- **Bot Fight Mode is off.** It answered every request from GitHub's runners with a challenge (`cf-mitigated: challenge`), before Access and the Workers, which broke the smoke tests. On the Free plan it cannot be exempted per path. It would also challenge real visitors on data-centre or VPN addresses, whose form submissions (`fetch` calls) cannot solve a challenge. Abuse control is Turnstile on the forms plus the per-IP and per-mobile rate limits (M2).
- The Access service token is on the `staging` environment only.

## Update, 27 September 2026

- **Each CI token reaches its environment's five Workers**, not two: Phase 2 added `mm-app`, `mm-ops` and `mm-tech` beside `mm-api` and `mm-site` (`scripts/lib/workers.ts`). `scripts/release/verify-ci-token.ts` checks each one, and D1 Edit is still account-wide, as decision 3 accepts.
- **Production has its own Access service token** since 22 September 2026, for the smoke suite behind Access on production's app, ops and technician hosts (`docs/open-points.md`, "Settled").
- **The GitHub gates are still deferred** (decision 2): `main` requires no checks and `production` has no reviewers.
