# 0256. The fit guarantee's days as a setting, and a claim as a Tasks row

- Status: accepted
- Date: 2026-11-12
- Topic: Booking and visits

## Context

The terms promise a refit or a full refund for 14 days from the first fit, in the client's own judgment, with the
technician retrieving the hair system. The 14 lived only in the terms' words, and a claim was a plain Care chat (sync
audit G6). The owner ruled on 12 November 2026 (ruling 7) that the days are a setting and a claim opens a Tasks row.

## Decision

1. **`guarantee_days`** (default 14) in Settings · Rules, edited in the console, read by the terms page, `/api/me`, the
   sign-off's words (ADR 0254) and the visit screen. A first fit's visit carries `guarantee_until`.
2. **A claim.** A "The fit isn't right" report on a first fit inside the window opens a Tasks row, "Fit guarantee claim",
   due by `task_sla_hours`, carrying the sign-off and the photos. Outside the window the report is an ordinary issue
   (the issue log, W6).
3. **The terms** state the guarantee in the setting's days. Signing off does not end it.
