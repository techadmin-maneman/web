# The technician app

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

A technician signs in on his phone with his number and a WhatsApp code; the session is bound to that phone, which ops can revoke (ADRs 0052 and 0053). The phone keeps today's and tomorrow's jobs, and every step he takes waits in its outbox until it reaches us.

## A technician's lost phone

1. **Revoke it.** In the ops console, Technicians, under Phones: each phone he has signed in on, and when it was last used. Revoke the lost one; its session ends at once. A technician who installed the app on an iPhone has two rows for one handset, the browser's copy and the installed app's (ADR 0053): revoke both.
2. **What it still holds.** The phone keeps its jobs until it next reaches us: each client's name, number, address and gate code, and any photographs and steps not yet sent. At its next contact it wipes all of it, and `technician_devices.wiped_at` records that it has. A phone that never comes back online keeps it, and that is personal data on a lost device: follow [A personal data breach](data-breach.md) to judge it.
3. **What was only on the phone** is lost with it. What did reach us is in `job_events` ("Work stuck on a technician's phone", below). A visit he finished whose close never reached us is closed by hand in the console: on the client's Visits tab or the visit's drawer on the dispatch board, **Close by hand**, with how it went, when the work began and ended, and how you know.
4. **A new phone.** He signs in on it with his number, and it enrols itself. If the number went with the phone, change it first in the console's Technicians: the code goes only to the number on his record.

```sql
SELECT d.device_id, d.label, d.last_seen_at, d.revoked_at, d.wiped_at
FROM technician_devices d JOIN technicians t ON t.id = d.technician_id
WHERE t.name LIKE '%<name>%' ORDER BY d.last_seen_at DESC;
```

## Work stuck on a technician's phone

The app sends the outbox one step at a time, oldest first, whenever it has signal and whenever it comes to the front. Its "Waiting to reach us" screen (`/waiting`) lists, for each job, the photo sets and steps still on the phone, since when, and what stopped the job's queue.

- **No signal.** Nothing is wrong. Get to signal and open the app. The app warns when the phone has not promised to keep its store: an iPhone keeps it only with the app on its home screen (ADR 0053), so a technician on an iPhone should not leave work waiting for days.
- **A job stopped because it changed** ("This job changed while the phone was offline", "Ops moved this job to 9 am tomorrow" or, before the phone has read the card again, "to another time", "Ops moved this job to Sameer at 10:40 am", "This job is someone else's now", "This job was cancelled…"): ops changed the job, and what is left of it cannot reach us from this phone. Agree with the technician what he did; ops close the visit by hand in the console; then he taps "Delete this job's work", which asks first and deletes that job's queue from the phone.
- **A step refused** ("The piece's label was not accepted", and the like): "Correct it" takes him back to the step, filled in as he sent it. The Ref under it finds the refusal in the logs ([Someone says a screen failed](screen-failed.md)).
- **A photograph refused** ("The photographs would not upload"): "Retake photos" opens the camera for that set with only the refused angles to take again; the photographs that reached us stay, and the rest of the job follows once the set lands.
- **Photographs waiting**: "Retry".
- **Never sign out or delete the app while work is waiting**: signing out wipes the phone. The app asks first, and offers "Send first".

What reached us for a visit:

```sql
SELECT kind, occurred_at, received_at FROM job_events
WHERE appointment_id = '<visit id>' ORDER BY received_at;
```

---

## A technician at the door who cannot check in

His phone says how far it puts him from the address, and refuses beyond the check-in radius (Settings · Rules). Where he is at the door and still refused, the address's pin is usually the building's or the society's gate. Open the visit on the dispatch board, press **Let him check in**, and say why: his next tap lands, for that visit only. The distance is still recorded, and a no-show's evidence shows that ops let him in, and why. Correct the address's pin on the client's page for next time.
