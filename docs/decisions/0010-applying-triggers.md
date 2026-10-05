# 0010. Applying triggers

- Status: accepted. Amended 25 September 2026: "Checking what is live".
- Date: 2026-09-21
- Settles the open item in 0006

## Context

M2 adds the first cron trigger (the sweeper, every five minutes) and the first queue consumer (`crm-sync`). Cloudflare attaches these to a Worker separately from its code:

- `wrangler versions upload` and `versions deploy`, which CI uses, change code only.
- `wrangler triggers deploy` applies all three kinds of trigger. Routes need Workers Routes permission on the zone; queue consumers need Queues permission on the account.

The CI tokens have neither permission, by design (0004, 0008). A staging token with them could move production's routes or consumers.

## Decision

Trigger changes are applied by an operator with their own wrangler login, not by CI:

```sh
npm run apply-triggers -- --env staging
npm run apply-triggers -- --env production
```

Order matters. **Deploy the code first, then attach the trigger.** A consumer or cron attached to a version without the matching handler fails every delivery until the handler arrives. Messages wait in the queue meanwhile; the free plan keeps them 24 hours.

After every deploy, both workflows compare the triggers that are live with every Worker's config and warn on a difference, naming the command (below, "Checking what is live").

## Consequences

- Triggers change rarely: M2 adds a cron and a consumer, and M3 adds the `render` and `messaging` consumers. Each is one command per environment.
- Until an operator runs it, the new consumer does not run. The smoke suite does not cover queue consumers. The M2 staging proof does, since a lead only reaches Zoho through the consumer.
- 4 October 2026: the cron moved from every five minutes to every minute (ADR 0009, "the cron's CPU time"). Until the new trigger is attached the old one fires, and the code runs every job on it, as it did before; the deploy's trigger check names the difference.

## Checking what is live (25 September 2026)

The reminder compared the root `wrangler.jsonc` alone, in staging alone, and only between the commit deployed and the one before it. A deploy run that was superseded, which the concurrency group does to a queued run, never had its changes compared: on 24 September 2026 the range 1352674..7383388 was never checked. And `apply-triggers` ran `wrangler triggers deploy` for mm-api only.

- **What is live, not what changed.** `scripts/release/check-triggers.ts` reads the cron schedules and queue consumers Cloudflare has attached and compares them with the config of every Worker in the registry, for the commit now serving. Both deploy workflows run it after deploying. It only reads, and a difference is a warning: the code is already live, and an operator attaches the triggers.
- **It says what it could not read.** CI's tokens reach their own Workers' schedules but, by design, not the account's queues (0008), so in CI the consumers read "not compared", with the command that checks them. An operator runs it with a token that can read Workers and Queues: `node --env-file=<file> scripts/release/check-triggers.ts <env> --strict`.
- **Routes are not compared.** CI's tokens have no zone permission (0004), and the smoke suite already proves each host reaches its Workers.
- **`npm run apply-triggers -- --env <env>` attaches every Worker's triggers** (`scripts/release/apply-triggers.ts`), passing over an app not deployed there yet, whose bootstrap attaches its route. Given a token that can read them, it then checks that what is live matches.
