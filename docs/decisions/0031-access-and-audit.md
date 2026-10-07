# 0031. Access on the ops surface, and the audit log

- Status: accepted. Amended 25 September 2026: an audited action writes its entry in the same batch as its change. Amended 26 September 2026: one opening of a client's photographs is one entry, naming the client, and serves that opening's images for thirty minutes (ADR 0072). Amended 2 October 2026: an ops call's entry names the client or visit it opened and the path called, IDs only; the health check and a path no route answers write none; a GET repeated within ten minutes writes one; and the database's size is watched. Amended 7 October 2026: a signed-in client's and technician's calls are written too, so the log holds every action and who made it (below).
- Date: 2026-09-22
- Topic: The ops console

## Context

The ops console (`ops.maneman.in`) is for staff only. It will show clients' records and photographs, and let staff dispatch visits, adjust credits and rule on fraud. The Phase 2 backend prompt asks for two things:

- The console sits behind Cloudflare Access, and every ops call records the Access identity in the audit log.
- The audit log is append-only. It records photo views, consent and number changes, deletions, credit adjustments and fraud decisions. A locked photograph view writes its entry before it returns any URL.

Access already refuses anyone without a login at the edge. But a Worker that trusts every request it receives would also answer a request that reached it some other way, such as a route or host set up by mistake. And it could not say who made the call.

## Decision

**The Worker verifies the Access token.** On the ops surface, `requireAccess` (`src/http/access.ts`) checks the `Cf-Access-Jwt-Assertion` header on every `/api/*` call. The token must pass all of these checks:

- it is signed with RS256 by a key the team publishes at `https://<team>/cdn-cgi/access/certs`;
- it was issued by the team (`iss`);
- it is for the ops application (`aud` contains `ACCESS_OPS_AUD`);
- it has not expired (`exp`), and is already valid (`nbf`);
- it names a person by `email`, or a service token by `common_name`.

A refused call gets `403 access_required`, and the reason is logged; the token never is. If the keys cannot be fetched, the call gets `503 unavailable`, since that is not the caller's fault.

**The keys are cached per isolate.** They are fetched once, and again after an hour. A token naming an unknown key can trigger a refetch at most once a minute, so forged key IDs cannot turn every request into a subrequest. Access rotates its keys with weeks of overlap.

**`ACCESS_PROVIDER` is `cloudflare` or `stub`.**

- **The stub** calls everyone `ops@localhost`. It is for local development only: the guard refuses it in staging as well as production, unlike the other stubs, because staging's hosts are behind Access and there is nothing to lose by checking.
- **`ACCESS_TEAM_DOMAIN`** is `summer-math-0275.cloudflareaccess.com`, the team that already guards staging (`docs/verification.md`).
- **`ACCESS_OPS_AUD`**, the ops application's audience tag, is required once the ops surface is switched on in that environment. It is optional until then, since the owner has not created the application yet (provisioning, step 11).

**Every ops call is audited before it runs.** `auditCall` (`src/domain/ops/audit.ts`) follows `requireAccess`. It writes an `ops.call` entry naming the identity, the method and the route pattern (never the path, which can hold a token). If the write fails, the call is refused with `503`. The same rule, write first or refuse, will apply to each audited action as later milestones add them.

**Amended 25 September 2026: an action's entry is written with it.** Written first, an entry claimed actions that then failed: a deletion that never happened was recorded twice. Written after, as several routes had drifted into doing, an action whose entry failed happened unrecorded. So an audited action (a decision, a revoke, leave, a launch, an answer, a request) now writes its entry in the same D1 batch as its change, and both happen or neither: `auditStatement` gives the statement, and `auditStatementIfWritten` one for an insert that may write nothing. What only reads, an export or a photograph viewed, still writes its entry first and refuses when it cannot. `test/worker/ops/audit-with-action.test.ts` makes each route's entry fail and checks that nothing changed.

- **One exception: `/api/health` on a database not yet proven to be this environment's.** It is the only route that passes that check, and it writes nothing there. It answers 503 and reads no data.

**Amended 2 October 2026: whose record, and no noise.** The entry named the route pattern only, so the log could not say which clients a member of staff had opened, which a DPDP access request or a breach review needs. Nine rows in ten were GETs, many of them the health check, a path no route answers, or a board polling. Now (`src/http/audit.ts`):

- a call to `/api/clients/:id…` names the client as its subject (`person`), and one to `/api/visits/:id…` the visit (`appointment`);
- `detail` holds the method, the route pattern and the path called, with each parameter that is an ID filled in and any other left as the pattern names it, so a mobile number typed into a path is never kept;
- `/api/health` writes nothing, since it reads no client's data, and nor does a path no route answers;
- a GET of the same path by the same person within ten minutes of their last writes no second entry. Any other method writes one every time. The Staff list's `staff_access_would_refuse` line (ADR 0109) for such a repeat has no entry under its own request ID; the first look's entry names the person.

A consent switch that changes nothing writes no `consent.switch` entry either, as it writes no ledger row.

**`audit_log` is append-only in the database itself** (`migrations/0005_audit.sql`). Triggers refuse every `UPDATE` and `DELETE`, so no code path, bug or console query can rewrite history. Each entry records:

- when it happened, and on which surface;
- the actor: a member of staff by e-mail, a service token by client ID, or a client, technician or scheduled job by our own opaque ID;
- the action;
- the subject, by kind and opaque ID;
- the request ID;
- a JSON `detail` holding IDs, counts and codes only.

Actions are listed in code (`AUDIT_ACTIONS`), not in a CHECK constraint, so that adding one needs no table rebuild.

## Consequences

- **No personal details in the log.** A client appears only as an opaque ID. Erasing a client (ADR 0019) blanks their details elsewhere, and their entries here still record what was done without saying who they were. The log keeps staff e-mails, which is the point of it.
- **The log grows by about one row per ops call.** At a few thousand calls a day this is inside D1's free limits: 100,000 writes a day, and 500 MB a database (5 GB is the account's total across its databases; ADR 0009). ADR 0039's budget accounts for it. The hourly `storage_meter` cron job reads the database's size and tells ops at 50%, 80% and 95% of 500 MB (`src/policy/database-size.ts`), and Settings shows it beside R2's: past the limit every write fails, this log's first.
- **The log is kept.** Nothing deletes from it yet. The owner chose two years on 2 October 2026, for counsel to confirm; once confirmed, a migration lets the delete trigger pass rows older than that, and the sweeper deletes them in batches.
- **Switching on the ops surface** now needs `ACCESS_OPS_AUD` as well as its DNS record, Access application and route (provisioning, step 11).
- **The contract** gains the `access_required` error code. `docs/openapi.json`, `docs/api.md` and the site's types are regenerated.
- **Tests** (`test/worker/ops/access.test.ts`), using keys generated in the test, so no real token or key is involved:
  - a valid person's token and a valid service token are accepted;
  - a token is refused when it has the wrong audience or issuer, has expired, is not valid yet, names nobody, is missing or malformed, is signed by an unknown key, has a forged signature, has claims changed after signing, or uses another algorithm;
  - the key cache fetches once, fetches again after an hour, and throttles refetches for unknown keys;
  - unreachable keys give 503;
  - the ops surface audits a call before it runs and refuses it when the audit cannot be written;
  - no other surface asks for Access;
  - the log refuses `UPDATE`, `DELETE` and malformed rows.

  `test/worker/platform/guard.test.ts` covers the new settings.

## Amended 7 October 2026: the client's and the technician's calls

The owner asked whether the app keeps a log of every action and who made it. It did for ops; for the client and the technician, only some actions (consents, number changes, deletions) reached the log, and the rest were in their own tables. So each surface's calls are now written as ops calls are, by `auditSessionCall` (`src/http/audit.ts`), which every session route runs after its session's guard (`src/http/session-routes.ts`):

- **`client.call`**: every change a signed-in client makes, under the client's ID: a booking, a hold let go, a move, a cancellation, a consent, an address, a referral card. Their looks at their own record are not written: Home is asked for all day, and the client is the only one it shows.
- **`tech.call`**: every step a technician sends, and each job they open, which shows them the client's address and number, under the technician's ID, with the phone (`technician_devices.id`) in the detail. A job opened again within ten minutes writes one entry, as an ops look does. The day's list and who is signed in are not written.
- **Not written:** a photograph's bytes going up (the step that records it is), and an address being typed for suggestions.
- **Written first, as an ops call is:** before the handler runs, so an attempt that is then refused is written too, and a call whose entry cannot be written is refused with 503. The entry names the visit or hold the path names, and the path, IDs only.
- **Size:** about one row per client change and about twenty per job, within the database's watched size (`storage_meter`).
