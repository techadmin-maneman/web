# 0060. An invited friend reaches ops and the CRM

- Status: accepted
- Date: 2026-09-24
- Follows [0059](0059-a-clients-history.md), which read the real org and found what the CRM actually holds

## Context

The referral landing at `/r/:code` had two holes in it, both recorded as open points and neither needing the owner.

**A friend left no lead** (`docs/open-points.md`, "An invited friend is not in the CRM"). `leads.loss_extent` is `NOT NULL`, and only the site's own form asks where the hair loss is; the landing does not. `recordLead` therefore returned null for every invited friend. They are the one customer the business has already paid a referral credit for, and they were the one customer marketing could not see.

ADR 0051 recorded the two ways out: ask on the landing too, or make the column optional. The second looked closed. Migration 0025 set out to rebuild the leads table and was withdrawn: `tryon_jobs.lead_id` points at a lead, D1 runs a migration in one transaction, and SQLite counts dropping the parent as a violation that re-creating it does not undo.

### What "not in the CRM" actually meant

ADR 0059 read the owner's real org and found that **every FSM contact already carries a populated `ZCRM_Id`**: FSM's own sync makes a CRM-side record for every contact we create. That narrows this open point, and it is worth stating exactly, because the answer differs by flag:

- **With self-serve booking on**, a friend's booking holds a slot, the fsm-sync queue confirms it, and `confirmBooking` calls `fsmContactOf`, which creates the FSM contact. FSM's sync then gives them a CRM record. So they did reach the CRM — but **never as a Lead**, and the Lead is what carries the source, the invite, the UTM parameters, the proposed date and the contact consent. The gap was the marketing funnel record, not the person's existence.
- **With self-serve booking off**, which is production's setting, the old code answered `409 ops_assisted` before writing anything at all: no person, no hold, therefore no queue message, therefore **no FSM contact and no CRM record of any kind**. The open point's own line, "The friend is in the referral records and in FSM", was only ever true on staging.

So the second hole was the worse one, and the first was narrower than it read.

**The Lead is also the only CRM record we can write.** ADR 0059 found the Worker's CRM token scoped `ZohoCRM.modules.leads.ALL`; `/crm/v8/Contacts` answers `401 OAUTH_SCOPE_MISMATCH`. Whatever the right long-term home for a customer is, a Lead is the only place this code can put a friend's source and attribution today, and the only CRM record `erasePerson` can blank.

**A friend got nothing when self-serve booking was off** (`docs/open-points.md`, "Referral consultations without self-serve"). `bookConsultation` checked `SELF_SERVE_BOOKING` before it did anything else and answered `409 ops_assisted`. The friend filled in the whole form — name, number, pincode, a day, a window, the consent — pressed the button, and was told to start again on WhatsApp. Nothing was written: no person, no consent, no attribution, no lead. Ops learnt nothing, and the invite that brought the friend was lost unless they messaged of their own accord. That is the state production would have launched in, because self-serve is off there.

## Decision

### The column is optional, and the landing is untouched

`leads.loss_extent` is nullable. Every consultation and waitlist entry now leaves a lead, whichever page it came from.

The landing gains no field. It is deliberately short, and a question about hair loss is the kind that loses a friend who arrived through someone else's invite rather than through an advertisement. An invited friend's lead simply carries no extent: `src/providers/zoho.ts` already leaves `Loss_Extent` off a record when it has none, so the CRM shows the field empty rather than wrong.

**Migration 0031 changes the column without rebuilding the table**, which is why it runs where 0025 could not:

```sql
ALTER TABLE leads ADD COLUMN loss_extent_next TEXT CHECK (...);
UPDATE leads SET loss_extent_next = loss_extent;
ALTER TABLE leads DROP COLUMN loss_extent;
ALTER TABLE leads RENAME COLUMN loss_extent_next TO loss_extent;
```

`leads` is never dropped, so nothing that points at it is ever left pointing at nothing, and the try-on job that stopped 0025 is not involved. The rows keep their values, the three answers are still the only ones accepted, and the whole swap is one transaction: no deployed version ever sees the column missing.

### A consultation without self-serve is a request, not a refusal

With `SELF_SERVE_BOOKING` off, the landing and `/book` no longer refuse. They do everything a booking does except hold a slot: the person, the consent under the notice they were shown, the invite's attribution, the lead — and a row in `consultation_requests` carrying the day and window they asked for.

- The answer is `201` with `state: "requested"` instead of `state: "booked"`. The confirmation tells the friend we have their request and will fix the hour on WhatsApp, so they are not sent away to type it all again.
- **No slot is held and FSM is not told.** Two people may ask for the same window; ops decide.
- The credits answer is unchanged, so a friend is told the 3 service visits stand.

### Ops see it as a task

The request is a task in the queue the console already draws (board D2, `src/policy/tasks.ts`), as a sixth group. It follows that section's rule exactly: there is no state column and no decision endpoint, because **the row leaves the queue when the thing is done** — when that person has a consultation appointment that is not cancelled. Ops fix the hour on WhatsApp and put the visit in FSM; the mirror writes the appointment, and the task goes.

`consultation_requests` points at `people` and at `referral_codes`, and deliberately **not** at `leads`: a second table pointing at leads would narrow what a later migration can do to that table, which is the trap this ADR has just climbed out of.

## Consequences

- **Every booking leaves a lead**, from either page, invited or not. ADR 0051's "a booking from an invite does not" no longer holds.
- **An invited friend's CRM lead has no loss extent.** Marketing sees the person, the source, the day and the invite, and not the extent. This is the trade: the landing keeps its length, and the field is empty rather than guessed.
- **An invited friend can now be erased from the CRM.** `erasePerson` blanks the Lead (ADR 0019). A friend who had no Lead had only the record FSM's sync made, which the Worker's token cannot reach (ADR 0059), so there was nothing erasure could touch. Giving them a Lead gives DPDP something to work on.
- **More people now hold both a Lead and the CRM record FSM made for them.** That pairing is not new — it is already true of every client who booked from `/book` — and this makes the referral path consistent with it rather than inventing a case. It does mean the conversion question ADR 0059 defers now covers referred friends too, which is the right scope for it: they were the population being silently left out.
- **The site's own form still asks**, and still requires an answer. Nothing about `/book` changes.
- **`ops_assisted` is no longer answered by either public booking route.** The client app still answers it for its own booking and changes, where a client already has a record and WhatsApp is the right next step.
- **A request that is never acted on stays in the queue** and goes overdue, like every other group. Nothing closes it but the visit.
- The landing has a confirmation the design does not draw, recorded in `docs/fidelity-method.md`.

## What this does not do

- **It does not convert a lead into a CRM Contact,** and it does not write to Contacts at all. ADR 0059 leaves that waiting on a token with `ZohoCRM.modules.contacts.ALL`, the owner's confirmation that FSM's auto-created Contact is the customer record, and counsel on the marketing basis. Nothing here depends on how those are answered: a friend who books a consultation is a prospect by ADR 0059's own rule — a booked first fit is still a prospect until the technician has been — so a Lead is the record they should have at that moment, exactly as a booking from `/book` already leaves one.
- It does not take payment or an address, and it does not ask the friend anything the landing did not ask before.
- It does not give a request its own screen. It is a task, in the section that already lists what ops have to do.
