# Locked out of the ops console

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

The console is behind Cloudflare Access in both environments, and mm-api checks the Access token again on every call (ADR 0031).

- **Access will not let a person in.** Zero Trust → Access → Applications → the console's application (`ops.maneman.in`, `ops-staging.maneman.in`) → Policies: their e-mail must be in the Allow policy, and the login method they use must be switched on (Settings → Authentication). A change takes effect within a minute. It needs someone who can sign in to the Cloudflare account; if nobody can, that is Cloudflare's account recovery.
- **The console opens, and every call fails with "access required"** (403). mm-api refused the token; Workers Logs say why, as `access_refused` with a reason:
  - `wrong_audience`: the application's audience tag is not `ACCESS_OPS_AUD` in `wrangler.jsonc`. The tag changes when the application is deleted and made again: copy the new one (provisioning, step 11, point 3) and deploy.
  - `wrong_issuer`: `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc` is not the team's domain, the `….cloudflareaccess.com` that Zero Trust's settings show.
  - `missing`: the call reached mm-api without Access, so the host has no Access application: add it (step 11, point 2).
  - `expired`: sign in again.
- **Every call answers 503**, with `access_keys_unavailable` in the logs: mm-api could not fetch Access's signing keys. That is on Cloudflare's side, and each call tries again.
- **The deploys' smoke tests stop getting through** to the Phase 2 hosts: the CI service token has expired or left a policy. Make a new one (provisioning, step 3) and store it (provisioning, step 6).

While ops are locked out, nothing in the console can be done by SQL without losing its audit: every decision in the console is written to `audit_log` under the person who made it. Wait unless a deadline forces it (a deletion request's seven days, a refund); if it does, note what was done, when and to which rows in the alert space.

---
