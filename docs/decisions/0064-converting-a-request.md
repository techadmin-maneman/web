# 0064. Converting a Request by API

- Status: accepted
- Date: 2026-09-24

## Context

The P2-M2 staging proof of 23 September found that the Request blueprint
transition **"Convert to Work Order" answers `SUCCESS` and creates no work
order**: the Request moves to "Work In Progress", its `Work_Orders` stays empty,
and nothing is behind it. REQ4, `8229000000304279`, is still in that state in the
owner's org, and is left there as the evidence.

The proof concluded "FSM's own screen opens a form there that the API does not",
and open point 33 has stood since as a capability FSM lacks. PR #92 taught us to
distrust that shape: `POST /fsm/v1/Invoices` answered a bare `500` for months of
reasoning about scopes and field names, and the answer was that **we** were not
sending the line items and `$finance_data` (ADR 0055).

It is the same shape again.

## Why the transition reports success and does nothing

`GET /fsm/v1/Requests/{id}/actions/blueprint/transitions` on a Request at "New"
declares the transition itself:

```json
{
  "action_type": "RECORDACTION",
  "next_field_value": "Work In Progress",
  "name": "Convert to Work Order",
  "id": "8229000000073256",
  "type": "primary",
  "enabled": true
}
```

Beside it, `Cancel` and `Terminate` declare a `fields` array with their mandatory
`Notes`. **`Convert to Work Order` declares no fields at all.** There is nothing
for a caller to supply, and nothing FSM builds from what is supplied: the
transition is a write of one field, `Status`. FSM says so in its own answer —
`"message": "record updated"`, not "converted".

Reproduced on 24 September against the org, on two Requests of our own, both
deleted afterwards: the bare `PUT .../actions/blueprint` with the transition ID,
and the same call carrying `Type`, `Due_Date`, `Territory` and
`Service_Line_Items` in its `data`. Both answered `200 SUCCESS`, both moved the
Request to "Work In Progress", and the org held the same work orders before and
after. Enriching the body changes nothing, because the transition was never the
thing that creates the work order.

**FSM's own screen does two things where we did one.** It opens the New Work
Order form beside the transition, and the work order it creates is what carries
the link. The conversion is the work order, not the transition.

## What actually converts a Request

`POST /fsm/v1/Work_Orders` takes a **`Request`** field. Tried on our own
"Staging test" contact on 24 September:

```
POST /fsm/v1/Work_Orders  { data: [{ Summary, Type: "Service", Contact,
    Territory, Service_Address, Billing_Address, Request: "<request id>",
    Service_Line_Items: [{ Service, Quantity: 1, Sequence: 1 }] }] }
-> 201
```

The work order came back carrying `Request: { name: "REQ8", id: ... }`, and the
Request itself, read afterwards, was **"Work In Progress" with that work order in
its `Work_Orders`** — without any blueprint call at all. The status follows the
link; the link does not follow the status.

Every record made for this — one contact, three Requests, two work orders with
their service lines, and one appointment — was labelled "Staging test" and
deleted the same session. REQ4 was read and not touched.

## Decision

**Record that FSM can convert a Request by API, and that the blueprint transition
must never be used for it.** No code here converts one yet, because nothing in
the product asks to: a booked lead becomes a Request for ops to schedule, and ops
schedule it in FSM (ADR 0032). What was wrong was the belief that the API could
not, which would have shaped that answer for us.

The one call is written down above so that whoever builds it does not reach for
the transition again, and `src/providers/fsm-zoho.ts` gains nothing speculative.

## Consequences

- Open point 33 stops being "FSM cannot" and becomes a business question: whether
  ops always convert in FSM's screen, or whether a booked lead should be turned
  into a work order by us. That is the owner's, and it is unchanged by this.
- A Request converted by the transition alone is still stranded. Nothing of ours
  makes that call, and nothing should; REQ4 stays as it is.
- The general rule, now twice proved: an FSM call that answers success and does
  nothing is a call we are making wrongly until the transitions list, the
  mandatory fields or the module's own answer says otherwise. `"record updated"`
  means a field was written, and names which one if you ask for the transitions
  first.
