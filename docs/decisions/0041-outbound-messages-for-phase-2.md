# 0041. Outbound messages for Phase 2, and delivery receipts

- Status: accepted
- Date: 2026-09-22
- Contract step for `migrations/0006_outbound_messages_v2.sql`

## Context

Phase 1 sends one kind of WhatsApp message, the try-on result, and `outbound_messages` allowed only that kind: `CHECK (kind IN ('tryon_result'))`. Phase 2 sends many more (`docs/prompts/phase2-backend.md`, "Providers and integrations"):

- consultation confirmations and day-before reminders;
- waitlist confirmations;
- payment receipts, and reschedule and cancel confirmations;
- "your friend was fitted";
- launch alerts.

Its dispatch and no-show rules add two more: the message telling a client that ops moved their visit, and the arrival message on the day. These messages are about appointments, referrals, waitlist entries, payments and pincodes, not try-on jobs.

Phase 2 also needs to know that a message **reached the phone**. The no-show evidence includes "the delivery receipt of the day-before or arrival WhatsApp to the client". The owner kept WhatsApp on Evolution for Phase 2 (22 September 2026). Evolution reports receipts through its `MESSAGES_UPDATE` webhook.

SQLite cannot change a CHECK constraint in place, so the table has to be rebuilt.

## Decision

**Rebuild `outbound_messages` once** (migration 0006):

- **No CHECK on `kind`.** The kinds are listed in code (`MESSAGE_KINDS`, `src/config/message-kinds.ts`), as the audit log's actions are (ADR 0031). A new kind then needs no second rebuild, which would be the second contract step for one table.
- **`subject_kind`** says which table `subject_id` points into (`MESSAGE_SUBJECTS`). It defaults to `tryon_job`, the one subject Phase 1 has.
- **`delivered_at` and `read_at`**, filled from receipts. The first report of each wins.
- **An index on `provider_message_id`**, the ID a receipt uses to name the message.
- **Nothing else changes:** `state` keeps its CHECK, and every other column is as it was.

**The rebuild is safe for the code already deployed.** The staging and production deploys migrate before they upload the new code. The Phase 1 code names none of the new columns, and its inserts get the right `subject_kind` by default. Every row is copied across unchanged, which `test/node/database/migration-0006.test.ts` proves. That test applies the real migration files to SQLite, before and after.

**The send port takes one message:** `send({ to, template, params, mediaUrl? })` replaces `sendTemplate(to, template, params, mediaUrl)`. Phase 2's templates take different parameters, and named fields read better at every call site. Behaviour is unchanged.

**Receipts arrive at `POST /api/hooks/evolution/:token`**, on the public host (ADR 0026):

- **The token.** The path must carry `EVOLUTION_WEBHOOK_TOKEN`, compared in constant time; a wrong token gets `401`. The token is optional, and without it the route answers `404`, so deploys do not wait for the owner to configure Evolution.
- **Only `messages.update` counts.** Every other event is answered `204` and ignored. So is anything unreadable, so Evolution does not keep retrying it.
- **Which receipts move a message on.** `DELIVERY_ACK` marks our message delivered, and `READ` or `PLAYED` marks it read (and delivered). `SERVER_ACK` and `PENDING` say nothing new, and receipts for messages someone sent us are ignored.
- **The message is found by the provider's ID.** A receipt for a message we did not send changes nothing.
- **Limits.** At most 50 receipts are read per request, to stay inside the free plan's limits.
- **Nothing identifying is logged.** Evolution's body names the recipient's chat, our own number, and the instance's API key. The body is never logged. The logger now also redacts `remote_jid`, `participant`, `sender`, `number`, `destination` (which echoes the webhook URL) and `webhook_token`. The request log records the route's pattern, never its path, so the token stays out of it too.

## Consequences

- **The owner sets up the receipts** (provisioning, step 12):
  - a secret `EVOLUTION_WEBHOOK_TOKEN` on each Worker;
  - Evolution's webhook pointed at the route, sending `MESSAGES_UPDATE` only;
  - on staging, an Access bypass for `/api/hooks/`.

  Until then no receipts arrive, and `delivered_at` stays empty.

- **Receipts cost requests.** Each message sent brings up to three receipts (sent, delivered, read), and each is one request against the free plan's 100,000 a day. At Phase 2's volumes this is a small share. The Phase 2 budget (ADR 0039) accounts for it.
- **Bot Fight Mode** can challenge webhook deliveries (ADR 0023, and the conflicts register, ADR 0025). If it stays on, receipts may not arrive.
- **The contract** gains one route. `docs/openapi.json`, `docs/api.md` and the site's types are regenerated.
