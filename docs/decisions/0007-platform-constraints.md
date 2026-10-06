# 0007. Platform facts that block M1's definition of done

- Status: resolved by 0008
- Date: 2026-09-21
- Topic: Platform

The prompt says to stop and report when it is wrong about a platform fact, not to work around it. Three facts, each checked on 21 September 2026, stop parts of M1. None is worked around in this repository.

## 1. `maneman.in` is not on Cloudflare

**Found:** the nameservers are `ns07/ns08.domaincontrol.com` (GoDaddy). The site is a GoDaddy parked page (`/lander`), and mail is Google Workspace (`aspmx.l.google.com`). The Cloudflare account holds one zone, `repqcproject.com`.

**Why it blocks:** Worker routes, Cloudflare Access on `staging.maneman.in`, and Turnstile hostnames all need `maneman.in` to be an active Cloudflare zone.

**Owner action:**

1. Add `maneman.in` to the Cloudflare account; the Free plan is enough.
2. Before switching, check that the imported DNS records keep Google Workspace mail working (MX, SPF, DKIM, DMARC, and any verification TXT).
3. Change the nameservers at GoDaddy.

I did not do this: it moves live DNS, including mail.

## 2. The GitHub plan cannot enforce the gates on a private repository

**Found:** `techadmin-maneman/web` is private on GitHub Free. Branch protection and rulesets are refused ("Upgrade to GitHub Pro or make this repository public"). GitHub's current documentation also says:

- Environment secrets in private repositories need Pro, Team or Enterprise.
- Required reviewers on an environment in a private repository need **Enterprise**. On Free, Pro and Team they are available for public repositories only.

**Why it blocks:** "All required checks on `main`" needs branch protection. "Behind a GitHub Environment with required reviewer approval" needs required reviewers. The workflows declare both, and GitHub will not enforce either on this plan.

**Options:**

| Option                            | Required checks | Environment secrets | Required reviewers |
| --------------------------------- | --------------- | ------------------- | ------------------ |
| Make the repository public (Free) | yes             | yes                 | yes                |
| GitHub Pro or Team, private       | yes             | yes                 | **no**             |
| GitHub Enterprise Cloud, private  | yes             | yes                 | yes                |

The repository holds no secrets, but a public repository publishes the backend's code and design. I have not built a substitute approval gate, such as an approval-issue action.

## 3. A staging token can reach production D1 in a shared account

**Found:** Cloudflare's API-token permissions for D1, Queues and R2 apply to the whole account. Workers Routes permissions apply per zone. Per-Worker roles for Workers scripts are new (15 September 2026) and cover scripts only; D1 databases cannot be scoped per database.

**Why it blocks:** the rule "the staging token cannot touch production resources" cannot hold inside one account. Staging CI must run D1 migrations, and a token that can migrate `maneman-staging` can also write `maneman-prod`. Both hostnames also sit in the one `maneman.in` zone.

**Options:**

- **(a) Two Cloudflare accounts,** one per environment. This is the only way to meet the rule as written. But a zone lives in exactly one account, and subdomain zones are an Enterprise feature, so staging would move off `staging.maneman.in` to a separate domain.
- **(b) One account, as the config assumes today.**
  - CI tokens get per-Worker Workers roles (each environment's two Workers only), account-wide D1, and no zone permission. Routes are set at bootstrap (0004).
  - The staging token can still reach production D1. That is a written, accepted deviation from the prompt.
  - Mitigations: the config check (0005), the identity guard (0003), and staging CI naming only `maneman-staging` in its commands.

## What is done regardless

All of M1 that does not depend on these three is built and verified locally and in CI; see `docs/verification.md`. Nothing has been provisioned in Cloudflare. The D1 IDs in `wrangler.jsonc` are placeholders, which the deploy-time config check rejects.
