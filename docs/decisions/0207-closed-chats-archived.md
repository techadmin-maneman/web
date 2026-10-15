# 0207. Closed Care threads are archived out of D1

- Status: accepted
- Date: 2026-10-15
- Topic: Platform
- Amends [0129](0129-the-care-inbox.md) on where a thread's messages are kept

## Context

Each environment's database may hold 10 GB (ADR 0112). Past that, every write fails, and the console, bookings and payments stop together. The storage meter warns at 50%, 80% and 95%. Until now, though, the runbook's ways of freeing space were plans to build only once a warning came (`docs/runbook/cloudflare-plan.md`, "D1 growing").

Two plans were named: archive closed rows to R2, starting with `job_events` and `chat_messages`, or move the append-only tables to a second database.

`job_events` cannot be archived as things stand:

- A visit's outcome, its start time and its checklist are read from those rows wherever an old visit is shown: `src/domain/visits/visit-begun.ts`, check-ins, and the client app's visit history.
- Moving the rows out would change what those old visits show.
- Each visit would first have to carry what is read from them.

The audit log is the largest table, but it is held to two years by the retention job, and a trigger refuses to let a younger row go. The other tables that grow are a client's record, kept as long as the client is.

Chat messages are read in few places: the thread's page in the inbox, the client's data export, and an erasure. Every other reader looks at open threads, or at threads opened in a recent window.

## Decision

- **A client's Care thread, closed and quiet for a year** (`CHAT_ARCHIVE_MONTHS`, `src/policy/retention.ts`), has its messages moved to one file for the thread: `archive/chats/<thread>.json` in the backups bucket (`src/domain/care/chat-archive.ts`). The hourly `chat_archive` cron job moves up to 20 threads a run, the oldest first.
  - The thread stays, with where its file is, how many messages it holds, and its last message when the file was written (migration 0179).
  - A partial index holds only the threads still to archive, so the job reads only the work it has to do.
  - The file is written before the rows go. The rows go only if the thread is as it was read. A run cut short, or a message arriving meanwhile, loses nothing: the next run writes the file again, with the messages merged by their IDs.
  - A thread the client writes to again keeps its new messages in D1 until it is quiet a year more. Then the file is written again, holding both.
- **Strangers' threads are not archived.** The retention job deletes them after a year. Nor are technicians' threads, which are few.
- **What reads it:**
  - The thread's page in the inbox reads the file with the rows, so an old thread shows as it did.
  - The client's data export includes the archived messages, still without staff's notes.
  - An erasure deletes the files of every thread of the client's, under the key each has whether or not the thread names it.
  - A client erased while a run was writing their thread has the file written again without words.
  - The inbox's list shows no last line for an archived thread, since none is left in D1.
- **The file is not encrypted** beyond R2's own encryption at rest. Like the photographs, it is the platform's own and never leaves the account. The weekly backups are encrypted because they are for the owner to take away.
  - The weekly backups' pruning deletes only folders named for a date, so it leaves `archive/` alone.
  - A restored database still names the files, which stay in R2.
- **`job_events` and `outbound_messages` stay in D1.** If they lead at a size warning, the second database is still the plan for them (`docs/runbook/cloudflare-plan.md`).

## Consequences

- Messages more than a year quiet are not in the weekly backups, which copy D1. They are in R2 alone, which keeps them as it keeps the photographs.
- Reading an old thread costs one R2 read.
