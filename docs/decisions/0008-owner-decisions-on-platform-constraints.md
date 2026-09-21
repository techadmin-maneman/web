# 0008. Owner decisions on the platform constraints

- Status: accepted
- Date: 2026-09-21
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
