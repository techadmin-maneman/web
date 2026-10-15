# Reporting, as it works now

How the business's figures reach Zoho Analytics. D1 stays the record; reporting reads a copy, never the live database.

## The nightly copy

Once a night, from 3 am in India, a Workflow writes D1's visits, payments and the tables they are grouped by to the analytics schema in Supabase, which Zoho Analytics reads (`src/domain/analytics/nightly.ts`, `src/workflows/analytics-copy.ts`). The night is worked in parts: each stages its tables beside the copy, and the last swaps them all in in one transaction, an unchanged row keeping its stamp so Zoho fetches only what changed. The totals are checked against what was sent, and ops are told if they differ or the copy nears Supabase's 500 MB.

The copy is switched off in staging and production today (`ANALYTICS_PROVIDER` is `none`, [settings](../settings.md)); in production it stays off until counsel rules on its pseudonymous rows.

## What it holds

No row names a client. Each is known by a key made from our ID with a secret only the API holds, the same every night, so a client can be followed over time and never named (`src/domain/analytics/client-key.ts`). Records marked as tests are left out.

- **Visits and payments**, with the shared tables of dates, cities, technicians, services and clients (`src/domain/analytics/rows.ts`).
- **Leads**, with their channel and campaign by the channel rule (`src/domain/analytics/leads.ts`).
- **Clients by month**: where each stood at each month's end, active, lapsed or lost (`src/domain/analytics/client-months.ts`, `src/policy/client-standing.ts`, `lost_after_days` in Settings · Rules).
- **Capacity**: each technician's open and taken half-slots, read from the dispatch board so utilisation is the board's (`src/domain/analytics/capacity.ts`).
- **Care cases**: each grievance and each task the Tasks board has held, with when it opened and closed (`src/domain/analytics/care-cases.ts`).
- **Stock, pieces and credits**: the ledger and its movements, each piece fitted, and the credit ledger valued by day (`src/domain/analytics/stock.ts`, `src/domain/analytics/pieces.ts`, `src/domain/analytics/credits.ts`).
- **Spend and targets**: the offline spend typed on the Spend page, partner payouts, and each month's targets by city (`src/domain/analytics/spend.ts`, `src/domain/analytics/targets.ts`).
- **Messages** sent, by day and kind (`src/domain/analytics/message-days.ts`).

## Who may read it

Each member of staff's grants, as the Staff list holds them, are copied too, so Zoho Analytics can share each dashboard to them (`src/domain/analytics/access.ts`).

## Decisions still worth reading

- [0146, the nightly copy](../decisions/0146-the-nightly-analytics-copy.md).
- [0148, the channel rule](../decisions/0148-the-channel-rule.md) and [0151, the retention figures](../decisions/0151-retention-figures.md).
- [0154, targets and reporting access](../decisions/0154-targets-and-reporting-access.md).
