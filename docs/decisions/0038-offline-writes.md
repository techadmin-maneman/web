# 0038. The technician app's offline writes, and what they write to FSM

- Status: accepted
- Date: 2026-09-23

## Context

The prompt: "Offline writes from the technician app are queued on the device with a client-generated ID, and sent in order when the phone is back online. The server makes each write idempotent on that ID before passing it to FSM." And: "If FSM has changed underneath (for example ops reassigned the job while the phone was offline), the write is rejected with `409 superseded`. The technician sees what changed. Nothing is merged silently."

Two facts from the trial (`docs/decisions/fsm-trial.md`) shape the rest:

- **FSM offers no idempotency key anywhere.** Deduplication is ours.
- **The org has no job-sheet template.** `meta/job_sheet_forms` is empty, and the forms are built in FSM's settings, not through the API (`docs/open-points.md`, item 28). There is no job-sheet record to create yet.

## Decision

### Landing a write

Every technician write takes an `X-Client-Event-Id` header and lands in `job_events`, whose key is `(appointment_id, event_id)`. A replay of an ID the job already holds changes nothing and answers with the event that landed first, `replayed: true`. This is the whole of the idempotency: there is no second mechanism, and nothing reaches FSM twice for one event ID.

**The supersede check runs before the write.** The job is superseded when it is no longer this technician's, or FSM has cancelled or terminated it. The event is still recorded, marked `superseded`, so the record says the phone tried, and the response is `409 superseded` naming the fields that changed — never their values.

**The steps run in order.** A check-in before a start, a start before any step, and the design's steps in their own order, the piece step only on a replacement or a first fit. A step sent early is `409 out_of_order` naming the step it must follow; the phone sends its outbox in order, so this is a guard, not a workflow.

### Writing to FSM

**Through the `fsm-sync` queue, not in the request.** The rule for a write to FSM, set here: synchronously where the person waits on the result, through the queue where they do not. (Corrected 27 September 2026: this credited the rule to ADR 0032, which says nothing of it.) The technician does not wait on FSM: he is on a phone, often on a weak line, and a refusal FSM will take a minute later must not lose his work. The route answers `202` with `fsm_write_state: "pending"`, and the consumer retries after 30 s, 1, 2 and 4 minutes; the fifth alerts and leaves the event for ops.

Dispatch is the other way round, and synchronous, because ops **do** wait on the result: a clash or a refusal has to be on the screen before the board shows the job moved.

What each event writes:

| Event                           | FSM                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `check_in`                      | the Dispatch transition, with the arrival in its note                                               |
| `start`                         | `Actual_Start_Date_Time`, and the Start transition where FSM offers it                              |
| `before_photos`, `after_photos` | each photograph not yet attached, uploaded and attached (ADR 0028)                                  |
| `checklist`, `consumables`      | the job sheet so far, rewritten onto the appointment's `Summary`                                    |
| `piece`                         | the asset created, or the failed one's status; then the summary                                     |
| `outcome`                       | `Actual_End_Date_Time`, the summary, and the Complete or Terminate transition with the closing note |

**Transitions are read before they are made.** `GET /{module}/{id}/actions/blueprint/transitions` lists what FSM offers now; a transition it does not offer is not forced, and the event is "nothing to write" rather than an error. That is how a job FSM has already moved past says so, and it needs no list of transition names hard-coded from a version of the blueprint we happened to see.

### The job sheet, until the template exists

The checklist, the consumables, the outcome, the partial reason and the duration are written **on the appointment**: as its `Summary`, and as the mandatory note of the transition that closes it. That is what FSM can hold today.

Our own `job_events` keep the same facts field by field, so the day the owner builds the template (open point 28) they can be replayed into job-sheet records without asking a technician to type anything twice. The summary is rebuilt from the events on every write, so it is the same text whether it is written once or five times.

## Consequences

- A phone can replay its whole outbox after a week offline and land each event once.
- A job reassigned while the phone was offline is refused with what changed, and the technician is told rather than having his work quietly overwritten.
- FSM's record of a job is complete in substance but not yet in shape: the facts are in the summary and the closing note, not in job-sheet fields. Until open point 28 is settled, ops reading FSM's own console read prose, not a form. This is the one place P2-M4 falls short of the prompt, and it falls short because FSM has nowhere to put the data, not because we chose to keep it.
- No FSM idempotency key means a retry after a timeout could write twice in FSM. The writes are chosen to be idempotent in effect: `Summary` and the actual times are overwritten, an asset is created only when the piece code is unknown to us, and a transition FSM has already made is no longer offered.
