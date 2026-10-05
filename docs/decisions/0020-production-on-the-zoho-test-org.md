# 0020. Production uses the Zoho test org, for now

- Status: superseded by [0050](0050-crm-in-the-real-org.md) on 22 September 2026
- Date: 2026-09-21

## Context

The runbook puts staging on a Zoho CRM Developer Edition org and production on the real org. The real org isn't set up yet. To release M4, the owner decided on 21 September 2026 that production uses the Developer Edition org for now.

## Decision

Production's Zoho secrets are staging's:

- the same API client and refresh token;
- the API host `developer.zohoapis.in`, the only host a Developer Edition org answers on (ADR 0012);
- the same assignment rule, `32619000000175317` ("assigns new bookings to technicians").

`scripts/ops/check-zoho-setup.ts` passed with these values before the release.

## Consequences

- **Real and test leads share one org.** Staging's test people are named "Staging test" or "Load test". Records never collide: each environment has its own D1, so `D1_Person_ID` values differ.
- **Test leads reach the technicians.** The assignment rule and workflows fire for both environments, as they already did for staging.
- **One refresh token for both.** Each environment mints its own access token about once an hour, so about 2 an hour in total. Zoho allows 10 new tokens in 10 minutes per refresh token and 15 active at once. Revoking the refresh token stops both environments' syncs.
- **Developer Edition is Zoho's edition for building and testing.** Its limits now apply to production's traffic as well as staging's.

## Moving production to its own org

1. Set up the real org as in the runbook's step 8, and check it with `scripts/ops/check-zoho-setup.ts`.
2. Put its `ZOHO_*` secrets on production, with `ZOHO_API_HOST` set to `www.zohoapis.in`.
3. In production's D1, run `UPDATE people SET zoho_lead_id = NULL;`. The stored IDs point into the test org, and a sync updates a stored ID directly, without searching. Left in place, every returning person's sync would fail.
4. Send production's leads again, so each person gets a record in the new org: `UPDATE leads SET sync_state = 'pending', sync_attempts = 0 WHERE sync_state = 'synced';`. The sweeper sends them within five minutes, and each posts its chat notice again.
5. Then delete production's records from the test org. Until they're gone, an erasure doesn't reach them: it blanks only the org the secrets point to.
