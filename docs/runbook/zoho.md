# Leads and Zoho

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

## Checking the booking path on staging

Actions → **staging-lead** → Run workflow, with a pincode staging serves and a window. It books a test consultation through the site's form, `POST /api/consultation` (`scripts/staging/staging-lead.ts`), on the last day the form offers. The name is "Staging test", the mobile number is random, and the address is made up. Within a minute the lead should be in the real Zoho org (ADR 0050), with the day booked, and the consultation on the console's Tasks board as a consultation asked for: staging shares the owner's org, and its records are the owner's to clear before go-live (`docs/open-points.md`, item 19). A `409` means the window has gone: run it again with another. In D1:

```sql
SELECT id, sync_state, sync_attempts, last_sync_error, created_at, synced_at FROM leads ORDER BY created_at DESC LIMIT 5;
```

If it stays `pending` with no attempts, the `crm-sync` consumer is not attached: run `npm run apply-triggers -- --env staging`.

A booking is saved in D1 before Zoho hears of it, so a customer never sees a Zoho problem. Where each lead stands:

```sql
SELECT sync_state, COUNT(*) AS leads, MAX(sync_attempts) AS most_attempts FROM leads GROUP BY sync_state;
SELECT id, sync_attempts, last_sync_error, created_at FROM leads WHERE sync_state = 'failed' ORDER BY created_at;
```

`last_sync_error` holds Zoho's status and code, such as `Zoho 401 invalid_code: …`, and never the lead's details. A timeout names the step that was slow: `Zoho CRM 0 TIMEOUT: token got no answer within 20 s`.

## Syncs are slow

Workers Logs (dashboard → Workers → the `mm-api` Worker → Logs) has one `vendor_call` line per request to a vendor, with the `vendor` (`zoho-crm` here), the `step` (token, search, insert, update or note), `status`, `duration_ms` and `lead_id`; a failed answer adds the vendor's `code`, and one that never came has `status` 0 and a `reason`. Every other vendor's calls are logged the same way, so filtering on `vendor` (`evolution`, `google`, `razorpay`, `ailabtools`, `zoho-books`, …) shows each call to it. `crm_synced` and `crm_sync_failed` carry the whole sync's `duration_ms`. The time not spent in `vendor_call` lines went to D1.

## Zoho is down

Nothing to do at first. A lead's first failure is retried by the queue 30 seconds later, then the sweeper retries it every fifteen minutes. After 10 attempts (about two and a half hours) it stops and an alert names it. Once Zoho is back, replay the leads that gave up (below).

## The Zoho token was revoked or expired

Symptoms: every sync fails with `invalid_code` or `INVALID_TOKEN`.

1. Make a new refresh token (Zoho, step 5 of "Provisioning an environment").
2. `W secret put ZOHO_REFRESH_TOKEN --env <env>` (`ZOHO_BOOKS_REFRESH_TOKEN` for Books).
3. Drop the cached access token: `DELETE FROM zoho_access_tokens WHERE client = 'crm';` (`'books'` for Books).
4. The sweeper delivers the waiting leads within five minutes. Replay any that already gave up.

## Zoho refused a new token ("Access Denied")

Symptoms: calls fail with `Zoho 400 Access Denied: could not refresh the access token`, then with `TOKEN_COOLING_DOWN`. One refresh token mints at most 10 access tokens in 10 minutes, and each environment has its own (provisioning, step 8.5). After Zoho refuses one, nothing asks for another for ten minutes (`zoho_access_tokens.cool_down_until`), and every Zoho call fails at once meanwhile; the queues and the passes try again afterwards on their own. Find what minted the tokens, usually a script run by hand against the same client, and stop it. Do not clear `cool_down_until` to hurry it: asking again inside the ten minutes extends Zoho's refusal.

## Replaying failed leads

One lead: **Send again** on its alert, under Tasks' Needs a hand. Many, after an outage:

```sql
UPDATE leads SET sync_attempts = 0 WHERE sync_state = 'failed';
```

The sweeper picks them up within fifteen minutes, and each lead's alert closes as it reaches the CRM. A replay never duplicates a Zoho record: the sync looks the person up by `D1_Person_ID` first, and Zoho refuses a second record with the same `D1_Person_ID`.

## Checking Zoho's answers before a release

The adapter tests read answers recorded from the org, so they pass only while Zoho answers as it did. Before every release, run each read the Books and CRM adapters make, through the adapters, against the owner's org. It writes nothing and makes about 15 calls:

```sh
node --env-file=.env.books-scripts --env-file=.env.crm-scripts scripts/release/zoho-contract-probe.ts
```

Each read prints `PASS`, `SKIP` when the org holds nothing for it to read (no invoice yet, say), or `FAIL`. A failure naming `UNEXPECTED_ANSWER` and a field means Zoho now answers in a shape the adapter does not read: change the adapter's schema in `src/providers/books/zoho.ts` or `zoho-crm.ts`, run the probe again with `--record` to write the answers the tests load (`test/fixtures/vendors`, with no one's details), and run those tests. `OAUTH_SCOPE_MISMATCH` means a scripts' token lacks a scope (provisioning, step 8.7). Record the date and the lines in `docs/verification.md`.

---
