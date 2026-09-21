# Runbook

Commands run from the repository root. `W` stands for `node node_modules/wrangler/bin/wrangler.js`. Always pass `--env staging` or `--env production`; the top level of each config is local only.

Sections still to come, one milestone at a time: Zoho, AILabTools or the BSP down (M2, M3); ceiling tripped (M3); token revoked (M2); replaying a failed lead or message (M2, M3); D1 point-in-time restore (M2); erasure within the day (M4); opening a city (M2); adding a blackout date (M2).

---

## Provisioning an environment

Once per environment. `<env>` is `staging` or `production`; `<t>` is `staging` or `prod`.

**Prerequisites**, each an owner decision (`docs/decisions/0007-platform-constraints.md`):

1. `maneman.in` is an active zone in the Cloudflare account, with mail records checked.
2. GitHub can enforce the gates: required checks on `main`, the `staging` and `production` Environments, and required reviewers on `production`.
3. A Cloudflare API token per environment, scoped to that environment's Workers (per-Worker Editor on `mm-api-<env>` and `mm-site-<env>`) plus D1 Edit. Create the tokens after the bootstrap in step 5: per-Worker roles cannot name a Worker that does not exist yet.

**1. Resources**

```sh
W d1 create maneman-<env>                       # paste the ID into wrangler.jsonc, env.<env>
W r2 bucket create mm-<t>-tryon-uploads
W r2 bucket create mm-<t>-tryon-results
W queues create mm-render-<t>
W queues create mm-crm-sync-<t>
W queues create mm-messaging-<t>
npm run check:config -- --require-provisioned   # must pass before anything deploys
```

**2. DNS.** In the `maneman.in` zone, add a proxied `AAAA` record pointing at `100::`, for `staging` (staging) or `@` (production). There is no origin; the Workers answer.

**3. Access (staging only).**

- Create an Access application for `staging.maneman.in/*` that admits the founders.
- Create a service token for CI, and a Service Auth policy that admits it.
- Store the token as `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` in the GitHub Environment `staging`.

**4. Database**

```sh
W d1 migrations apply maneman-<env> --env <env> --remote
node scripts/mark-database.ts <env>             # writes the identity row once; fails on a mismatch
```

**5. Bootstrap both Workers.** The first deploy is `wrangler deploy`, which also applies the routes. Every later deploy goes through the workflows.

```sh
W deploy --env <env> --tag bootstrap
W deploy --config site/wrangler.jsonc --env <env> --tag bootstrap
npm run smoke -- --base https://<host> --environment <env>
```

**6. GitHub.** Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the GitHub Environment `<env>`. For `production`, add the required reviewers. For `main`, require every check in `.github/workflows/ci.yml`.

---

## Rolling back a Worker version

A production release rolls itself back when a smoke check fails. To roll back by hand:

```sh
node scripts/release.ts current --worker mm-api --env production     # what is serving now
W deployments list --env production                                   # recent deployments and their versions
W versions list --env production                                      # versions, with tags (git SHAs)
node scripts/release.ts deploy --worker mm-api --env production --split <good-version-id>@100 --message "rollback: <reason>"
npm run smoke -- --base https://maneman.in --environment production --version-id <good-version-id>
```

Use `--worker mm-site` for the site. Rolling back code never rolls back D1: migrations are backward-compatible with the previous version by rule (`docs/decisions/0006-deployment-pipeline.md`), so the previous version runs on the migrated schema.

If a release stopped mid-rollout, `release.ts current` refuses to answer and prints the split. Deploy the good version at 100% as above.
