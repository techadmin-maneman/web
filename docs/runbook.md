# Runbook

Commands run from the repository root. `W` stands for `node node_modules/wrangler/bin/wrangler.js`. Always pass `--env staging` or `--env production`; the top level of each config is local only.

Everything lives in the Cloudflare account `Tech@maneman.in's Account` (`a2e185075b1b8eef3bee24b72f45ace3`), which holds the `maneman.in` zone.

Sections still to come, one milestone at a time: Zoho, AILabTools or the BSP down (M2, M3); ceiling tripped (M3); token revoked (M2); replaying a failed lead or message (M2, M3); D1 point-in-time restore (M2); erasure within the day (M4); opening a city (M2); adding a blackout date (M2).

---

## Provisioning an environment

`<env>` is `staging` or `production`; `<t>` is `staging` or `prod`.

### State on 21 September 2026

| Step                                    | staging   | production               |
| --------------------------------------- | --------- | ------------------------ |
| 1. D1 database, queues                  | done      | done                     |
| 1. R2 buckets, 30-day expiry            | done      | done                     |
| 2. DNS record                           | done      | exists (the apex record) |
| 3. Access application and service token | done      | not applicable           |
| 4. Migrations and identity mark         | done      | done                     |
| 5. Bootstrap deploy of both Workers     | done      | done                     |
| 6. CI token created                     | done      | done                     |
| 6. Token checked, GitHub secrets set    | **to do** | **to do**                |

### 1. Resources

```sh
W d1 create maneman-<env> --location apac      # put the ID in wrangler.jsonc, env.<env>
W queues create mm-render-<t>
W queues create mm-crm-sync-<t>
W queues create mm-messaging-<t>
npm run check:config -- --require-provisioned  # must pass before anything deploys
```

R2 must be enabled on the account first (dashboard → Storage & databases → R2; it needs a payment method). Try-on photos and results must not outlive 30 days, so each bucket gets an expiry rule:

```sh
for bucket in mm-<t>-tryon-uploads mm-<t>-tryon-results; do
  W r2 bucket create $bucket --location apac
  W r2 bucket lifecycle add $bucket expire-after-30-days --expire-days 30 --abort-multipart-days 1 --force
done
```

### 2. DNS

The hostname needs a proxied DNS record for visitors to reach it. There is no origin behind it; the Workers answer.

- Staging: in the `maneman.in` zone, DNS → Add record: type `AAAA`, name `staging`, IPv6 address `100::`, **Proxied**.
- Production: the apex already has proxied records (the old GoDaddy parking addresses). The Workers' routes answer before any origin is contacted, so nothing reaches GoDaddy. Replacing them with `AAAA @ 100::` is tidier but not required.

### 3. Access (staging only)

In Cloudflare Zero Trust:

1. Access → Applications → Add → Self-hosted. Domain `staging.maneman.in`, path empty (covers `/api/*` too). Policy: Allow, emails of the founders.
2. Access → Service credentials → Service tokens → Create `mm-ci-staging`. Copy the client ID and secret; the secret is shown once.
3. On the same application, add a second policy: action **Service Auth**, include the service token `mm-ci-staging`.
4. Store the token in GitHub as the `staging` environment secrets `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (step 6).

### 4. Database

```sh
W d1 migrations apply maneman-<env> --env <env> --remote
node scripts/mark-database.ts <env>    # writes the identity row once; fails if it names another database
```

### 5. Bootstrap both Workers

The first deploy is `wrangler deploy`, which also attaches the routes. Every later deploy goes through the workflows.

```sh
W deploy --env <env> --tag bootstrap
W deploy --config site/wrangler.jsonc --env <env> --tag bootstrap
npm run smoke -- --base https://<host> --environment <env>
```

### 6. CI token and GitHub secrets

Cloudflare dashboard → Manage Account → Account API Tokens → Create Token → Custom token, one per environment:

- Name `mm-ci-<env>`.
- Workers: role **Editor**, scope **Specified Workers**: `mm-api-<env>` and `mm-site-<env>`.
- Account → **D1 → Edit**. This is account-wide, so the staging token can also reach production's database; that is accepted in `docs/decisions/0008-owner-decisions-on-platform-constraints.md`.
- No zone permissions.

Put each environment's secrets in a file at the repository root. Git ignores `.env.*` files.

`.env.ci-staging`:

```sh
CLOUDFLARE_API_TOKEN=<the mm-ci-staging token>
CF_ACCESS_CLIENT_ID=<the Access service token's client ID>
CF_ACCESS_CLIENT_SECRET=<the Access service token's client secret>
```

`.env.ci-production`:

```sh
CLOUDFLARE_API_TOKEN=<the mm-ci-production token>
```

Check that each token reaches exactly what it should. The script prints results, never the values:

```sh
node --env-file=.env.ci-staging scripts/verify-ci-token.ts staging
node --env-file=.env.ci-production scripts/verify-ci-token.ts production
```

Then load the files into the GitHub environments and delete them:

```sh
gh secret set -f .env.ci-staging --env staging
gh secret set -f .env.ci-production --env production
rm .env.ci-staging .env.ci-production
```

Rotating a token later is the same: new token in a file, check it, load it, delete the file.

When the GitHub plan allows (0008): require every job in `.github/workflows/ci.yml` on `main`, and add required reviewers to the `production` environment.

---

## Staying on the free tier

The rules are in `docs/decisions/0009-stay-inside-cloudflare-free-tier.md`. The account is on Workers Free, where everything except R2 stops at its limit instead of billing.

Once, in the Cloudflare dashboard:

1. Billing → Budget alerts: create an alert at the lowest amount offered. Any usage-based charge then emails the billing address.
2. Notifications → Add → Usage-based billing: one notification each for R2 storage (5 GB), R2 Class A operations (500,000) and R2 Class B operations (5,000,000). That is half of each monthly allowance.
3. Billing → Subscriptions should list only free plans. Never upgrade Workers to Paid without a new ADR.

If an R2 alert fires: set the render ceiling to 0 (M3 adds the variable) and redeploy, which stops new uploads and renders. Then find the cause before raising it again.

---

## Rolling back a Worker version

A production release rolls itself back when a smoke check fails. To roll back by hand:

```sh
node scripts/release.ts current --worker mm-api --env production    # what is serving now
W versions list --env production                                     # versions, with tags (git SHAs)
node scripts/release.ts deploy --worker mm-api --env production --split <good-version-id>@100 --message "rollback: <reason>"
npm run smoke -- --base https://maneman.in --environment production --version-id <good-version-id>
```

Use `--worker mm-site` for the site. Rolling back code never rolls back D1: every migration works with the previous code (`docs/decisions/0006-deployment-pipeline.md`), so the previous version runs on the migrated schema.

If a release stopped halfway through a rollout, `release.ts current` refuses to answer and prints the split. Deploy the good version at 100% as above.
