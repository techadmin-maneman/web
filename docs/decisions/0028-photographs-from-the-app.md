# 0028. Photographs from the technician app

- Status: accepted; amended 28 September 2026 by [0093](0093-the-storage-meter.md): a photograph is at most 2 MB, it comes with a thumbnail the phone makes, and an erasure deletes every object under the visit's prefix. Amended 4 October 2026 by [0110](0110-field-work-without-fsm.md): a photograph is kept in R2 alone; none is attached to FSM.
- Date: 2026-09-23
- Topic: Field work

## Context

The prompt: photographs are "captured in our app, stored in `mm-{env}-client-photos`", and "also attached to the FSM job sheet, so FSM stays the complete record, if the trial confirmed an attachment API".

The trial confirmed it (`docs/archive/fsm-trial.md`, question 5): a file goes to `POST /fsm/v1/files`, then onto a record's Attachments, and comes back byte for byte.

Until now the only photographs we held came the other way: the mirror exported them out of FSM, where technicians took them in FSM's own app, reading each file's phase and angle from its name (`before-front.jpg`). Both paths must fill one set, or a client's timeline would double up during the two-week parallel run the rollout plans.

## Decision

**Through the API, never straight to R2.** `POST /api/tech/jobs/:id/photos/upload-url` answers a **path on this host**, signed for one job, phase and angle and good for fifteen minutes; the phone `PUT`s the bytes to it. A presigned R2 link could be replayed until it expired, and each replay is a billed write no ceiling of ours could count — the same reasoning as the try-on's upload (ADR 0014).

**The same bucket and the same prefix** as the mirror's own export: `visits/{appointment}/{phase}-{angle}-{uuid}.jpg` in `mm-{env}-client-photos`, and the same `photo_sets` and `photos` rows. The client app reads one set however it was filled.

**FSM is written from the queue, not from the request.** `POST /api/tech/jobs/:id/photos` lands a `before_photos` or `after_photos` event; the `fsm-sync` consumer uploads every photograph of that phase that FSM does not have yet and writes the attachment's ID onto the row. A phone on a weak line is not held waiting for FSM, and a refusal is retried rather than losing the photograph.

**The file's name carries the phase and angle**, exactly as the mirror's export reads them back. The attachment ID on our row is what stops the export importing our own upload as a new photograph.

**Bytes decide the type.** A JPEG or PNG only, read from the header as everywhere else (`src/lib/image-bytes.ts`), at most 12 MB. (Amended 28 September 2026, ADR 0093: at most 2 MB, and a thumbnail of at most 64 KB follows each photograph to the same link's `/small`.)

## Consequences

- A technician's photograph and one taken in FSM's app are the same row, so the two apps can run in parallel against the same FSM records.
- A photograph is never lost to an FSM outage: it is in R2 and in D1 before FSM is called at all.
- The upload link is a bearer token for fifteen minutes, so it is bound to one phase and angle of one job and the request still needs the session cookie.
- Deleting a photograph stays explicit and audited: the bucket has no lifecycle rule, and a replaced angle's object stays under the visit's prefix for an erasure to find. (Corrected 28 September 2026, ADR 0093: the erasure deleted only the keys the rows named, so it never found a replaced one. It now deletes everything under each of the person's visits.)
