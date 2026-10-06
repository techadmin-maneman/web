# Rolling back a Worker version

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

A production release rolls itself back when a smoke check or the soak fails once traffic has started to move: every Worker goes back to the version it served before the release, whichever step failed. Staging has no automatic rollback. By hand, for any of the five Workers, in either environment:

1. **Find the version to go back to.** Each Worker's config is in `scripts/lib/workers.ts`: `wrangler.jsonc` for mm-api, `site/wrangler.jsonc` for mm-site, and `apps/app/wrangler.jsonc`, `apps/ops/wrangler.jsonc` and `apps/tech/wrangler.jsonc` for the apps.

   ```sh
   node scripts/release/release.ts current --worker <worker> --env <env>     # the version serving now
   W deployments list --config <config> --env <env>                  # the last ten deployments, each with its versions
   W versions list --config <config> --env <env>                     # every version, tagged with the commit it was built from
   ```

   The deployment before the bad one names the version to go back to.

2. **Put it back.** One Worker or several in one command; a Worker already serving the version named is left alone, and every one is tried before the command fails:

   ```sh
   node scripts/release/release.ts restore --env <env> --message "rollback: <reason>" --to mm-api=<version id> --to mm-app=<version id>
   ```

3. **Smoke it.** The public host, and each switched-on Phase 2 host, which must serve mm-api and its own app:

   ```sh
   npm run smoke -- --base https://maneman.in --environment production --version-id <mm-api's version id>
   npm run smoke -- --environment production --surfaces
   ```

   On staging the base is `https://staging.maneman.in`, and every host is behind Access: put an Access service token (provisioning, step 3) in `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` first.

What a rollback does not undo:

- **The database.** Every migration works with the code of the release before it (ADR 0006), so mm-api's previous version runs on the migrated schema. Going back further than one release is not promised: a contract step (`docs/migrations.md`) drops what older code still reads. Data a bad release wrote wrongly is [Restoring D1](restoring-d1.md).
- **Triggers.** Cron schedules, queue consumers and routes are not part of a version. If the release was followed by `apply-triggers`, the older code runs with the newer triggers; attach the older ones by checking out the older commit and running `npm run apply-triggers -- --env <env>` from it.
- **Staging's next merge.** A merge to `main` deploys every Worker again, so a rollback on staging lasts until then.

An app's phones and browsers take the rolled-back version the next time they open it, when its service worker sees the change. If a release stopped halfway through a rollout, `release.ts current` refuses to answer and prints the split: put the good version back at 100% with `node scripts/release/release.ts deploy --worker <worker> --env <env> --split <version id>@100 --message "rollback: <reason>"`.
