# 0050. The CRM moves to the real Zoho org

- Status: accepted
- Date: 2026-09-22

## Context

ADR 0020 put production's leads in the Developer Edition org, because the real org was not set up. Phase 2 then put FSM and Books in the real org (ADR 0025, item 26), so a client's field work, invoices and payments lived in one org while their lead lived in another. FSM's contact and the CRM lead are the same person; keeping them apart makes ops read two orgs and blocks any later link between them.

The owner asked on 22 September 2026 to move the CRM across as well, and issued a Self Client for the real org with `ZohoCRM.settings.fields.ALL`, so the Leads fields could be made through the API rather than by hand.

## Decision

Both environments' CRM secrets point at the real org, on `www.zohoapis.in`.

- `scripts/setup-crm.ts` creates the nine custom fields on Leads and adds the pick-list values the sync writes, from the same constants the sync uses. It creates only what is missing, so it is safe to run again, and `scripts/check-zoho-setup.ts` proves the result.
- **`ZOHO_LAR_ID` is optional.** An org with no Leads assignment rule is a working org: Zoho leaves the record with the API user. It was required before, and an empty value stopped the Worker from starting at all.
- Staging's `people.zoho_lead_id` values were cleared: they pointed into the Developer Edition org, and a sync updates a stored ID without searching first, so every returning person's sync would have failed. (Since 25 September 2026 a write to an ID the CRM no longer has falls back to the search, then a new record, so a stale ID no longer blocks a person: [ADR 0070](0070-vendor-correctness.md).) Production's database was empty, so it needed nothing.

Proved on staging the same day: a lead through the real API reached the real org within a minute, with its status, source, window, extent, proposed date, consent and both D1 IDs, assigned by the org's rule.

## Consequences

- **One org holds the client.** The CRM lead, the FSM contact and the Books customer are in the same org, and ops read one place.
- **Test and real leads share the org,** as they did before. Staging's are named "Staging test" or "Load test", and each environment's `D1_Person_ID` values differ, so records never collide.
- **The Developer Edition org keeps its old records.** Nothing was migrated: staging's records there are test data, and production never had any. An erasure reaches only the org the secrets point to, so anything left there is now out of reach — it holds no real person's data.
- **One refresh token for both environments,** as before: about two access tokens an hour in total, inside Zoho's limit of ten per ten minutes.
- ADR 0020 is superseded.

## What is still done by hand

Zoho has no API for either, so the runbook keeps them (step 8):

- the **Leads assignment rule** — the owner created one on 22 September 2026;
- the **workflow rules** that notify on create and on a consent change.
