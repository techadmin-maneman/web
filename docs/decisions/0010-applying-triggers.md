# 0010. Applying triggers

- Status: accepted
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

When a merge changes `routes`, `triggers` or `queues.consumers`, `deploy-staging` prints a warning naming the command. The runbook's release checklist repeats it.

## Consequences

- Triggers change rarely: M2 adds a cron and a consumer, and M3 adds the `render` and `messaging` consumers. Each is one command per environment.
- Until an operator runs it, the new consumer does not run. The smoke suite does not cover queue consumers. The M2 staging proof does, since a lead only reaches Zoho through the consumer.
