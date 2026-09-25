# 0019. Erasure

- Status: accepted. The order below, R2 before D1, is superseded by ADR 0065: D1 goes first, and R2 after.
- Date: 2026-09-21

## Context

The photo notice promises "Message us and it is deleted the same day". The prompt specifies `POST /api/erasure`, for operators only:

- it deletes the try-on objects;
- it sets `erased_at`;
- it appends a withdrawal consent;
- it cancels unsent messages;
- it queues a CRM update.

The runbook makes "the same day" an ops target. The prompt leaves open how the person is found, how the endpoint is protected, what happens to each table, and what happens to a render still running.

## Decisions

### Found by mobile number, behind a bearer secret

The request reaches ops by phone or WhatsApp, so the number is what they have.

- The body is `{ "mobile": "98100 00000" }`, in any format the booking form accepts.
- The header is `Authorization: Bearer <ERASURE_SECRET>`, compared in constant time.
- A missing, malformed or wrong header gets `401 unauthorized` and a log line `erasure_unauthorized`.
- A number nobody has, or one already erased, gets `404`.

`ERASURE_SECRET` is required in every environment and must be at least 32 characters; the Worker refuses to start without it.

Staging also sits behind Cloudflare Access, so a call there needs the service-token headers as well. Production's `/api/*` is public, so there the secret is the only gate. At 32 random characters or more it can't be guessed.

### What is erased

| Where               | What happens                                                                                                                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2 `UPLOADS`        | Every photo not already deleted.                                                                                                                                                                                                                                                                                 |
| R2 `RESULTS`        | Every result, and after the D1 batch, both possible result keys of any job that was still running (below).                                                                                                                                                                                                       |
| `people`            | Name becomes "Erased". E-mail becomes empty. The number becomes `erased:<id>`. `contactable` becomes 0, and `erased_at` is set. The row stays, so leads, consents and events still join to it.                                                                                                                   |
| `tryon_jobs`        | Each job becomes `expired`, apart from a failed one, which keeps its state for the failure figures. `result_key` is cleared and `upload_deleted_at` set.                                                                                                                                                         |
| `tryon_sessions`    | Deleted, so an open try-on session ends.                                                                                                                                                                                                                                                                         |
| `outbound_messages` | `waiting` and `queued` become `skipped`, "person erased". The messaging consumer also refuses anyone erased.                                                                                                                                                                                                     |
| `consents`          | Append-only, so one withdrawal row per purpose previously granted: `notice_version 'withdrawal'`, `granted 0`. The original rows stay. They are the record that consent was given, and hold no name or number.                                                                                                   |
| `leads`             | Kept. They hold city, window, loss extent, dates and campaign tags, not who the person is. A lead not yet in the CRM is never sent: crm-sync gives it up at once (`failed`, "person erased", attempts at the maximum so the sweeper leaves it). One already on its way is followed by a second blanking (below). |
| `events`            | A `person_erased` event with counts only.                                                                                                                                                                                                                                                                        |
| Zoho                | The record is updated with workflows off: `Last_Name` "Erased", `Mobile` and `Email` empty, `Contact_Consent` false. A note "Personal data erased" is added. The record is found by the stored ID, or by `D1_Person_ID`.                                                                                         |

The Zoho update goes through the crm-sync queue, because Zoho may be down. It is retried like a lead sync: once after 30 seconds, then by the sweeper every five minutes until 10 attempts, then an alert asks for it by hand. Migration 0004 adds `crm_erased_at`, `crm_erasure_attempts` and `crm_erasure_error` to `people` to track it.

### The number is replaced, not kept

`mobile_e164` is unique. Keeping it would leave the number identifying the erased row, and a later booking from it would attach to that row. Replaced, the number can book again as a new person with a new consent.

### Order: R2, then D1, then the CRM

Superseded by ADR 0065. A D1 batch that failed after R2 had gone left a person with no photographs and every other detail, and an erasure that could not be repeated. D1 now goes first, and the cron finishes R2 if it fails.

- R2 goes first. If it fails, nothing in D1 has changed, and the request can be repeated.
- D1 is one batch, so the person is either erased or not.
- The CRM goes last, through the queue.

### Work already in flight

A render can finish after the person is erased. Two changes stop its result surviving:

- The render consumer marks a job `ready` only while it is still `downloading`. If that update matches nothing, the consumer deletes the result it just stored, unless a parallel run already stored that same key.
- Erasure deletes both possible result keys (`.png`, `.jpg`) of every job that was running when it read them. This covers a result stored between erasure's read and its batch.

A render already submitted is still billed. Its result is never fetched.

A lead sync can also be in flight. It read the person before the erasure, and its write to Zoho can land after the erasure's blanking, putting the details back. Queues can run two consumer invocations at once (docs/decisions/0012), so the order is not guaranteed. The staging proof caught one such sync landing 0.2 s before an erasure. So when a sync marks its lead `synced`, it also reads `erased_at`. If the person was erased meanwhile, it blanks the record again after its own write. If that fails, it clears `crm_erased_at`, and the sweeper retries the erasure.

## What erasure does not reach

- **Zoho's history.** Zoho keeps a record's past field values in its timeline, and deleted records in its recycle bin, so blanking the fields may not remove the old values everywhere. If the owner or legal wants them gone, the record is deleted in Zoho by hand and purged from the recycle bin. The runbook says how. **Open for legal.**
- **WhatsApp.** A delivered message stays on the person's phone, in the Mane Man WhatsApp account and in whatever the Evolution bridge stores. The runbook has ops delete the chat by hand.
- **D1 Time Travel.** D1 can be restored to any minute of the last 7 days (the Workers Free plan's window; 30 on Paid). A restore to a moment before an erasure brings the person back, and the runbook says to repeat the erasure after any restore. The history itself ages out after those 7 days.
- **Logs.** Workers Logs keep 3 days on the Free plan. They hold no names, numbers or e-mails by design, and the redaction tests check this.
- **Chat notices.** Lead notices never carried personal data, so there is nothing to erase.

## Consequences

- The runbook's "Erasure within the day" is the operator's procedure.
- `ERASURE_SECRET` must be set on production before the release that carries this code.
- Reports can still count an erased person's leads by city and source, but can't say who they were.
