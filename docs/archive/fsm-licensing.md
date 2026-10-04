# Zoho FSM licensing for our own apps

- Status: **history.** FSM was removed on 4 October 2026 ([0110](../decisions/0110-field-work-without-fsm.md)); this record is kept as it stood. Was: **the owner has ruled that we build our own interface and go on** (23 September 2026). Zoho's written answer is still outstanding, and this record says plainly which is which.
- Referenced by: `docs/prompts/phase2-backend.md` ("Technician app and dispatch — how they relate to FSM", Licensing)

## The question for Zoho

Our technician app (`tech.maneman.in`) and ops console (`ops.maneman.in`) read and write Zoho FSM through its API, as our own interface over FSM. Technicians and dispatchers use our apps instead of FSM's.

1. Is this use within FSM's licence terms?
2. Does each technician and each dispatcher working only through our apps still need an FSM user seat?
3. Do the plan limits (200 users on Professional, 500 on Premium) apply to them?

## What the published pricing says (22 September 2026)

FSM is priced by appointments a month, not by users. Users cost nothing up to 20 on Free, 200 on Standard and Professional, and 500 on Premium (https://help.zoho.com/portal/en/kb/fsm/faqs/pricing-and-subscription). Technicians must still exist as FSM users, since appointments are assigned to users. That settles the cost of questions 2 and 3, but not question 1, whether the use is within the terms. Zoho's written answer is still needed.

## The owner's ruling, 23 September 2026

> We can work on our UI.

P2-M4 goes ahead: the technician app, dispatch, and the ops boards over them. Technicians and dispatchers work in our apps, and FSM stays the system of record underneath, as ADR 0032 has it.

This is the owner's decision to proceed, not Zoho's answer. It rests on what Zoho publishes: FSM is priced by appointments, users cost nothing up to the plan's limit, and each technician exists as an FSM user because appointments are assigned to users. Nothing about how we use the API changes.

## Zoho's answer, still outstanding

_To be recorded: Zoho's reply, word for word, with the date and the name of the person at Zoho who gave it._

It is worth having in writing before production, and `docs/open-points.md` keeps it open. If Zoho ever says the use breaches its terms, what stops is technicians working in our app: the mirror, the client app and the ops console read and write FSM through the same API either way.
