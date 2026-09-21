# Runbook

Commands run from the repository root. `W` stands for `node node_modules/wrangler/bin/wrangler.js`. Always pass `--env staging` or `--env production`; the top level of each config is local only.

Everything lives in the Cloudflare account `Tech@maneman.in's Account` (`a2e185075b1b8eef3bee24b72f45ace3`), which holds the `maneman.in` zone.

To run SQL against an environment's database: `W d1 execute maneman-<env> --env <env> --remote --command "<sql>"`, where `maneman-<env>` is `maneman-staging` or `maneman-prod`.

---

## Provisioning an environment

`<env>` is `staging` or `production`; `<t>` is `staging` or `prod`.

### State on 21 September 2026

| Step                                        | staging                               | production                                      |
| ------------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| 1. D1 database, queues                      | done                                  | done                                            |
| 1. R2 buckets, 30-day expiry                | done                                  | done                                            |
| 2. DNS record                               | done                                  | exists (the apex record)                        |
| 3. Access application and service token     | done                                  | not applicable                                  |
| 4. Migrations and identity mark             | done                                  | done                                            |
| 5. Bootstrap deploy of both Workers         | done                                  | done                                            |
| 6. CI tokens and GitHub secrets, checked    | done                                  | done                                            |
| 7. Worker secrets: Turnstile, IP salt       | done                                  | done                                            |
| 7. Worker secrets: alert webhook            | done (Google Chat)                    | done (the same Google Chat space)               |
| 7. Worker secrets: AILabTools, link signing | done                                  | done (staging's AILabTools key, for now)        |
| 7. Worker secrets: Evolution, allowlist     | done (poker-settle's bridge, for now) | Evolution done (the same bridge; messaging off) |
| 7. Worker secrets: erasure                  | done                                  | done                                            |
| 8. Zoho org, fields, secrets                | done: Developer Edition               | done: staging's org, for now (ADR 0020)         |
| 9. Triggers (cron and all three consumers)  | done                                  | done                                            |
| 10. Access bypass for result links          | done                                  | not applicable                                  |

### 1. Resources

```sh
W d1 create maneman-<env> --location apac      # put the ID in wrangler.jsonc, env.<env>
W queues create mm-render-<t>
W queues create mm-crm-sync-<t>
W queues create mm-messaging-<t>
npm run check:config -- --require-provisioned  # must pass before anything deploys
```

R2 must be enabled on the account first (dashboard → Storage & databases → R2; it needs a payment method). Try-on photos and results must not outlive 30 days, so each bucket gets an expiry rule:

```sh
for bucket in mm-<t>-tryon-uploads mm-<t>-tryon-results; do
  W r2 bucket create $bucket --location apac
  W r2 bucket lifecycle add $bucket expire-after-30-days --expire-days 30 --abort-multipart-days 1 --force
done
```

### 2. DNS

The hostname needs a proxied DNS record for visitors to reach it. There is no origin behind it; the Workers answer.

- Staging: in the `maneman.in` zone, DNS → Add record: type `AAAA`, name `staging`, IPv6 address `100::`, **Proxied**.
- Production: the apex already has proxied records (the old GoDaddy parking addresses). The Workers' routes answer before any origin is contacted, so nothing reaches GoDaddy. Replacing them with `AAAA @ 100::` is tidier but not required.

### 3. Access (staging only)

In Cloudflare Zero Trust:

1. Access → Applications → Add → Self-hosted. Domain `staging.maneman.in`, path empty (covers `/api/*` too). Policy: Allow, emails of the founders.
2. Access → Service credentials → Service tokens → Create `mm-ci-staging`. Copy the client ID and secret; the secret is shown once.
3. On the same application, add a second policy: action **Service Auth**, include the service token `mm-ci-staging`.
4. Store the token in GitHub as the `staging` environment secrets `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (step 6).

### 4. Database

```sh
W d1 migrations apply maneman-<env> --env <env> --remote
node scripts/mark-database.ts <env>    # writes the identity row once; fails if it names another database
```

### 5. Bootstrap both Workers

The first deploy is `wrangler deploy`, which also attaches the routes. Every later deploy goes through the workflows.

```sh
W deploy --env <env> --tag bootstrap
W deploy --config site/wrangler.jsonc --env <env> --tag bootstrap
npm run smoke -- --base https://<host> --environment <env>
```

### 6. CI token and GitHub secrets

Cloudflare dashboard → Manage Account → Account API Tokens → Create Token → Custom token, one per environment:

- Name `mm-ci-<env>`.
- Workers: role **Editor**, scope **Specified Workers**: `mm-api-<env>` and `mm-site-<env>`.
- Account → **D1 → Edit**. This is account-wide, so the staging token can also reach production's database; that is accepted in `docs/decisions/0008-owner-decisions-on-platform-constraints.md`.
- No zone permissions.

Put each environment's secrets in a file at the repository root. Git ignores `.env.*` files.

`.env.ci-staging`:

```sh
CLOUDFLARE_API_TOKEN=<the mm-ci-staging token>
CF_ACCESS_CLIENT_ID=<the Access service token's client ID>
CF_ACCESS_CLIENT_SECRET=<the Access service token's client secret>
```

`.env.ci-production`:

```sh
CLOUDFLARE_API_TOKEN=<the mm-ci-production token>
```

Check that each token reaches exactly what it should. The script prints results, never the values:

```sh
node --env-file=.env.ci-staging scripts/verify-ci-token.ts staging
node --env-file=.env.ci-production scripts/verify-ci-token.ts production
```

Then load the files into the GitHub environments and delete them:

```sh
gh secret set -f .env.ci-staging --env staging
gh secret set -f .env.ci-production --env production
rm .env.ci-staging .env.ci-production
```

Rotating a token later is the same: new token in a file, check it, load it, delete the file.

When the GitHub plan allows (0008): require every job in `.github/workflows/ci.yml` on `main`, and add required reviewers to the `production` environment.

### 7. Worker secrets

Set these on the Worker, not in GitHub. `wrangler secret put` prompts for the value. Set them **before** deploying code that needs them: the Worker refuses to start without them (`docs/decisions/0011-lead-api.md`).

| Secret                                                                      | Value                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TURNSTILE_SECRET`                                                          | The secret of the environment's Turnstile widget (Cloudflare dashboard → Turnstile).                                                                                                                                                                                                                                                |
| `IP_HASH_SALT`                                                              | 32 or more random characters: `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`. Changing it resets the rate-limit counters.                                                                                                                                                                                    |
| `ALERT_WEBHOOK_URL`                                                         | An incoming-webhook URL for Slack, Google Chat or Discord. Alerts carry IDs, never names or numbers.                                                                                                                                                                                                                                |
| `LEAD_WEBHOOK_URL`                                                          | Optional. Where the one-line notice for each new lead is posted, if not the alert space (`docs/decisions/0018-one-look-pro-only-lead-notices.md`). Notices carry city, window and date, never a name or number.                                                                                                                     |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_LAR_ID` | Step 8.                                                                                                                                                                                                                                                                                                                             |
| `ZOHO_ACCOUNTS_HOST`, `ZOHO_API_HOST`                                       | India data centre: `accounts.zoho.in`, and for the API `www.zohoapis.in` (production org) or `developer.zohoapis.in` (Developer Edition org, staging).                                                                                                                                                                              |
| `AILAB_API_KEY`                                                             | The environment's AILabTools API key, a separate key per environment where the dashboard allows.                                                                                                                                                                                                                                    |
| `RESULT_SIGNING_KEY`                                                        | 32 or more random characters, generated like `IP_HASH_SALT`. Signs upload and result links; changing it invalidates links already handed out.                                                                                                                                                                                       |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`         | The Evolution API bridge (`docs/decisions/0016-whatsapp-through-evolution.md`). The URL must be public `https://`, reachable from Cloudflare, and include the port if it is not 443: staging's ends in `ts.net:8443`, because port 443 on that host serves another app. `GET /` there should answer "Welcome to the Evolution API". |
| `ERASURE_SECRET`                                                            | 32 or more random characters, generated like `IP_HASH_SALT`. Authorises `POST /api/erasure`. Keep one copy, in the git-ignored `.env.erasure-<env>` file that ops use for erasures ("Erasure within the day").                                                                                                                      |
| `MESSAGING_ALLOWLIST`                                                       | Staging: the founders' mobile numbers, comma-separated. Only these receive messages. A secret, so the numbers stay out of git.                                                                                                                                                                                                      |

To set several at once without typing them into a terminal, put them in a git-ignored file at the repository root, such as `.env.worker-staging`, with one `NAME="value"` per line. Then:

```sh
W secret bulk .env.worker-staging --env staging
rm .env.worker-staging
W secret list --env staging      # names only, to check
```

A single secret: `W secret put ALERT_WEBHOOK_URL --env <env>` prompts for the value.

**A Google Chat webhook for `ALERT_WEBHOOK_URL`.** The Workspace admin must allow incoming webhooks (Admin console → Apps → Google Workspace → Google Chat).

1. In Google Chat, create a space, for example "Mane Man alerts", and add whoever should see alerts.
2. Click the arrow next to the space name → **Apps & integrations** → **Add webhooks**.
3. Name it `mm-api`, then **Save**.
4. In the webhook's **More** menu, choose **Copy link**. The URL starts `https://chat.googleapis.com/v1/spaces/`; its `token` part is secret.

One space can serve both environments: every alert starts `[mm-api staging]` or `[mm-api production]`.

The Turnstile widgets are `mm-staging` (hostname `staging.maneman.in`) and `mm-production` (`maneman.in`, `www.maneman.in`). The front-end needs their site keys, which are public: `docs/turnstile.md`.

### 8. Zoho

Staging uses a Zoho CRM **Developer Edition** org, production the real org. Do this once per org. For now production shares staging's org; `docs/decisions/0020-production-on-the-zoho-test-org.md` says how to move it to its own.

1. **Fields.** Setup → Customization → Modules and Fields → Leads → Standard layout. Add these fields; their API names must match exactly:

   | Field                                                    | Type        | Values                                                             |
   | -------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
   | First Choice Window (`First_Choice_Window`)              | Pick list   | Weekday morning, Weekday evening, Weekend morning, Weekend evening |
   | Loss Extent (`Loss_Extent`)                              | Pick list   | Crown thinning, Receding front, Advanced                           |
   | Proposed Visit Date (`Proposed_Visit_Date`)              | Date        |                                                                    |
   | Contact Consent (`Contact_Consent`)                      | Checkbox    |                                                                    |
   | Try On (`Try_On`)                                        | Checkbox    |                                                                    |
   | D1 Lead ID (`D1_Lead_ID`)                                | Single line |                                                                    |
   | D1 Person ID (`D1_Person_ID`)                            | Single line | tick "Do not allow duplicate values"                               |
   | UTM Source (`UTM_Source`), UTM Campaign (`UTM_Campaign`) | Single line |                                                                    |

2. **Pick-list values.** Lead Status: add `New`, `Waitlist` and `Try-on — delivery only` (with the em dash). Lead Source: add `Booking form`, `Waitlist` and `Try-on`.
3. **Assignment rule.** Setup → Automation → Assignment Rules → Leads: create the rule that assigns new bookings to technicians. Its ID becomes `ZOHO_LAR_ID`; `scripts/check-zoho-setup.ts` (step 6) lists it.
4. **Workflows.** Setup → Automation → Workflow Rules → Leads:
   - on create, when Lead Status is New: notify the assigned technician and ops;
   - on edit, when Contact Consent becomes true: assign an owner. This covers a try-on customer who later books; Zoho has no assignment rule on update.
   - Nothing may fire for Lead Status "Try-on — delivery only". The sync also sends those with workflows switched off.
5. **API client.** The data centre is in the address you log in at: `crm.zoho.in` is India, `crm.zoho.com` the US, and so on. Use the matching API console, for example `https://api-console.zoho.in`. A Developer Edition org answers on `developer.zohoapis.<dc>`, not `www.zohoapis.<dc>`, even though the token reply names `www` (ADR 0012).
   1. **Add Client** → **Self Client** → **Create Now** → **OK**. The **Client Secret** tab shows the client ID and secret.
   2. **Generate Code** tab. Scope, exactly:

      ```
      ZohoCRM.modules.leads.ALL,ZohoCRM.modules.notes.CREATE,ZohoSearch.securesearch.READ,ZohoCRM.settings.fields.READ,ZohoCRM.settings.assignment_rules.READ
      ```

      The first three are what the sync uses. The two `settings…READ` scopes let `scripts/check-zoho-setup.ts` read the fields and assignment rules; they cannot change anything. Choose the longest time duration, add a description, then **Create** and pick the org.

   3. Before the code expires, exchange it for a refresh token. Use your data centre's accounts host:

      ```sh
      curl -X POST "https://accounts.zoho.in/oauth/v2/token?grant_type=authorization_code&client_id=<id>&client_secret=<secret>&code=<code>"
      ```

      Keep the `refresh_token` from the answer. It does not expire; revoke it in the API console if it leaks.

6. **Check, then store.** Put the Zoho values (and `ALERT_WEBHOOK_URL`) in `.env.worker-<env>` (step 7). Leave `ZOHO_LAR_ID` empty if you don't know it yet. Then:

   ```sh
   node --env-file=.env.worker-staging scripts/check-zoho-setup.ts
   ```

   It confirms every field, type and pick-list value the sync writes, and lists the Leads assignment rules with their IDs. Fill in `ZOHO_LAR_ID`, run it again until it passes, then `W secret bulk` the file and delete it. The next lead proves the setup end to end: it should reach Zoho within a minute, assigned and with its proposed date.

### 9. Triggers

CI deploys code but cannot attach cron schedules, queue consumers or routes (`docs/decisions/0010-applying-triggers.md`). After the code that handles them is live:

```sh
npm run apply-triggers -- --env <env>
```

`deploy-staging` prints a warning when a merge changed the staging triggers.

### 10. Result links through Access (staging only)

A WhatsApp copy carries a link to `/api/result/…`, which the Evolution bridge fetches. On staging, Cloudflare Access would stop it. Each link is signed and expires, so the path can bypass Access:

1. Zero Trust → Access → Applications → Add → Self-hosted. Domain `staging.maneman.in`, path `api/result/`.
2. Policy: action **Bypass**, include **Everyone**.

Access applies the most specific path, so the rest of staging stays behind the founders' login.

---

## Staying on the free tier

The rules are in `docs/decisions/0009-stay-inside-cloudflare-free-tier.md`. The account is on Workers Free, where everything except R2 stops at its limit instead of billing.

Once, in the Cloudflare dashboard:

1. Billing → Budget alerts: create an alert at the lowest amount offered. Any usage-based charge then emails the billing address.
2. Notifications → Add → Usage-based billing: one notification each for R2 storage (5 GB), R2 Class A operations (500,000) and R2 Class B operations (5,000,000). That is half of each monthly allowance.
3. Billing → Subscriptions should list only free plans. Never upgrade Workers to Paid without a new ADR.

If an R2 alert fires: set `UPLOAD_DAILY_CEILING`, `RENDER_DAILY_CEILING` and `RESULT_READ_DAILY_CEILING` to `"0"` in `wrangler.jsonc` and deploy. New uploads, renders and result reads then answer `busy`. Find the cause before raising them again. `test/node/free-tier-budget.test.ts` refuses any ceiling that could take R2 or Queues past 80% of the free allowance (`docs/decisions/0015-render-pipeline.md`).

---

## Leads and Zoho

### Checking the lead path on staging

Actions → **staging-lead** → Run workflow, with a city and window. It books a test lead through the real API. The name is "Staging test" and the mobile number is random. Within a minute the lead should be in the Zoho Developer Edition org: assigned, with its proposed date, or as Waitlist for Mumbai and Bengaluru. In D1:

```sql
SELECT id, sync_state, sync_attempts, last_sync_error, created_at, synced_at FROM leads ORDER BY created_at DESC LIMIT 5;
```

If it stays `pending` with no attempts, the `crm-sync` consumer is not attached: run `npm run apply-triggers -- --env staging`.

A booking is saved in D1 before Zoho hears of it, so a customer never sees a Zoho problem. Where each lead stands:

```sql
SELECT sync_state, COUNT(*) AS leads, MAX(sync_attempts) AS most_attempts FROM leads GROUP BY sync_state;
SELECT id, sync_attempts, last_sync_error, created_at FROM leads WHERE sync_state = 'failed' ORDER BY created_at;
```

`last_sync_error` holds Zoho's status and code, such as `Zoho 401 invalid_code: …`, and never the lead's details. A timeout names the step that was slow: `Zoho 0 TIMEOUT: token got no answer within 20 s`.

### Syncs are slow

Workers Logs (dashboard → Workers → the `mm-api` Worker → Logs) has one `zoho_call` line per request to Zoho, with the `step` (token, search, insert, update or note), `status`, `duration_ms` and `lead_id`. `crm_synced` and `crm_sync_failed` carry the whole sync's `duration_ms`. The time not spent in `zoho_call` lines went to D1.

### Zoho is down

Nothing to do at first. A lead's first failure is retried by the queue 30 seconds later, then the sweeper retries it every five minutes. After 10 attempts (about 40 minutes) it stops and an alert names it. Once Zoho is back, replay the leads that gave up (below).

### The Zoho token was revoked or expired

Symptoms: every sync fails with `invalid_code` or `INVALID_TOKEN`.

1. Make a new refresh token (Zoho, step 5 of "Provisioning an environment").
2. `W secret put ZOHO_REFRESH_TOKEN --env <env>`
3. Drop the cached access token: `DELETE FROM zoho_token;`
4. The sweeper delivers the waiting leads within five minutes. Replay any that already gave up.

### Replaying failed leads

```sql
UPDATE leads SET sync_attempts = 0 WHERE sync_state = 'failed';
```

The sweeper picks them up within five minutes. A replay never duplicates a Zoho record: the sync looks the person up by `D1_Person_ID` first, and Zoho refuses a second record with the same `D1_Person_ID`.

---

## Try-on and WhatsApp

The render consumer is the only caller of AILabTools and the messaging consumer the only caller of WhatsApp (`docs/decisions/0015-render-pipeline.md`). D1 records where every job and message stands:

```sql
SELECT state, failure_code, COUNT(*) AS jobs FROM tryon_jobs GROUP BY state, failure_code;
SELECT id, state, endpoint, latency_ms, provider_error_detail FROM tryon_jobs ORDER BY created_at DESC LIMIT 10;
SELECT state, COUNT(*) AS messages FROM outbound_messages GROUP BY state;
SELECT id, attempts, last_error FROM outbound_messages WHERE state = 'failed' ORDER BY created_at DESC LIMIT 10;
```

`provider_error_detail` holds AILabTools' status and message, with the key scrubbed out. `last_error` holds the WhatsApp provider's status and code, never the number.

### AILabTools is down, or refuses the key

Symptoms: jobs fail as `render_failed`. A refused key (401 or 403), a retired endpoint (404) or an empty balance also raise an alert naming the job.

- **Down (5xx, timeouts).** Nothing to do. Each submit is tried three times, and failed calls bill nothing. Customers see "failed" and can try again later.
- **Refused key.** Put a working key in place with `W secret put AILAB_API_KEY --env <env>`. New jobs use it at once.

### Credits are low

The sweeper reads the balance once an hour and alerts below `AILAB_CREDIT_FLOOR`. Top up in the AILabTools dashboard. At zero, every render fails.

### A ceiling was reached

The alert names the ceiling (`upload`, `render` or `result_read`). Try-ons answer `503 busy` until midnight IST, and the alert fires at most once a day per ceiling.

- If the traffic is real, raise the ceiling in `wrangler.jsonc` and deploy. The free-tier budget test refuses any value that could take the account past 80% of a free allowance.
- If the traffic is abuse, leave the ceiling: it is doing its job.

### A billed image was lost

Alert: "its result was billed but never downloaded, and its URL has expired". The download was retried for 24 hours. The customer's job is `failed`, and nothing can recover the image. Check whether the result host (`ailab-outputs.oss-accelerate.aliyuncs.com`) is reachable at all.

### WhatsApp (Evolution) is down

Symptoms: messages fail with `HTTP 5xx`, `unreachable` or `Connection Closed`, and an alert names each after four attempts. A message that failed with `delivery unconfirmed` is different: the bridge did not answer within 60 s, and the message may have arrived. It is never retried automatically.

1. Check the bridge. `GET {EVOLUTION_API_URL}/instance/connectionState/{instance}` with the `apikey` header should say `"state": "open"`.
2. If the WhatsApp session dropped, reconnect it in the bridge (scan the QR code again).
3. Replay the messages that failed (below).

To turn WhatsApp copies off, set `MESSAGING_ENABLED` to `"false"` and deploy. The gate then stops promising a copy, and queued messages are skipped.

### Replaying a failed message

```sql
UPDATE outbound_messages SET state = 'queued', attempts = 0, queued_at = '2000-01-01T00:00:00Z'
WHERE state = 'failed' AND created_at > '<since, e.g. 2026-09-21>'
  AND last_error NOT LIKE '%delivery unconfirmed%';
```

The sweeper sends them within five minutes. Every attempt mints a fresh link, so an old failure is not a problem, as long as the result has not been deleted. Replay a `delivery unconfirmed` message only once you know it did not arrive; otherwise the person gets it twice.

### Stuck jobs

The sweeper re-enqueues renders whose queue message was lost, and fails a submit that died part-way after 10 minutes, because submitting again could bill twice. Nothing to do by hand.

---

## Erasure within the day

The photo notice promises that a person's data is deleted the same day they ask. Whoever takes the request erases it before the end of that day. What is erased, and what is not, is in `docs/decisions/0019-erasure.md`.

1. **Check the request comes from the number's owner.** Reply to that number on WhatsApp, or call it.
2. **Erase.** With the environment's secret in a git-ignored file, `.env.erasure-production`, holding `ERASURE_SECRET="…"` (for staging, also `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`):

   ```sh
   node --env-file=.env.erasure-production scripts/erase-person.ts --environment production
   ```

   The script asks for the number and for a confirmation, then prints the person's ID and what it deleted: photos, results, and messages not yet sent. It keeps the number out of shell history. Without the script, the call is `POST /api/erasure` with `Authorization: Bearer <ERASURE_SECRET>` and the body `{ "mobile": "98100 00000" }`.

3. **Check Zoho within a few minutes.** The crm-sync queue blanks the record: the last name becomes "Erased", mobile and e-mail are emptied, and Contact Consent is unticked.

   ```sql
   SELECT erased_at, crm_erased_at, crm_erasure_attempts, crm_erasure_error FROM people WHERE id = '<person_id>';
   ```

   If `crm_erased_at` stays empty, `crm_erasure_error` says why. The sweeper tries 10 times, then alerts. To finish it by hand, find the record in Zoho by `D1_Person_ID` and blank those fields. Then run `UPDATE people SET crm_erased_at = '<now, ISO>' WHERE id = '<person_id>';`.

4. **Delete the chat** with the number in the Mane Man WhatsApp account, if there is one.
5. **Tell the person** it is done.

`404` means no one has that number, or the person was erased already; check the number for typos. Someone who used the try-on but never passed the gate never gave a number, and their photo is deleted within the hour anyway.

**Zoho's history.** Blanking the fields may leave the old values in the record's timeline. If the person or legal asks for full removal, delete the record in Zoho, then delete it from the recycle bin as well. D1's lead history is unaffected.

---

## Cities and visit days

Opening a city is a data change, not a deploy. The booking form reads `GET /api/cities`, which may be cached for five minutes.

```sql
-- Open a waitlisted city: new leads get a proposed visit day and go to the technicians.
UPDATE cities SET served = 1 WHERE name = 'Mumbai';
-- Add a city to the list, waitlisted, after Bengaluru.
INSERT INTO cities (name, served, active, sort) VALUES ('Pune', 0, 1, 80);
-- Take a city off the form. Existing leads keep it.
UPDATE cities SET active = 0 WHERE name = 'Pune';
```

People already on a city's waitlist are not told automatically when it opens; that is out of Phase 1's scope. Find them with `SELECT l.id, l.created_at FROM leads l WHERE l.source = 'waitlist' AND l.city = 'Mumbai';` and work from Zoho.

Blackout dates are days ops will not offer as the proposed visit:

```sql
INSERT INTO visit_blackouts (date, reason) VALUES ('2026-10-20', 'Diwali');
DELETE FROM visit_blackouts WHERE date = '2026-10-20';
```

A blackout changes only proposals made after it is added.

---

## Restoring D1 to a point in time

D1 Time Travel restores a database to any minute in the last 7 days (the Workers Free plan's window; 30 on Paid). **It rolls back everything written since**, including leads that are already in Zoho. Prefer fixing rows by hand when you can.

```sh
W d1 time-travel info maneman-<env> --env <env> --timestamp 2026-09-21T10:00:00Z   # the bookmark for that moment
W d1 time-travel restore maneman-<env> --env <env> --timestamp 2026-09-21T10:00:00Z
```

The restore prints a bookmark for the state it replaced, so the restore itself can be undone. Afterwards:

- run `node scripts/mark-database.ts <env>`; the identity row is older than any restore point, so it should still match;
- run the smoke suite;
- replay any leads that were in flight;
- **repeat any erasure made after the restore point.** A restore brings erased people back. Before restoring, list them: `SELECT id FROM people WHERE erased_at >= '<restore timestamp>';`. After it, look up each one's number (`SELECT mobile_e164 FROM people WHERE id = '<id>';`) and erase it again.

---

## Rolling back a Worker version

A production release rolls itself back when a smoke check fails. To roll back by hand:

```sh
node scripts/release.ts current --worker mm-api --env production    # what is serving now
W versions list --env production                                     # versions, with tags (git SHAs)
node scripts/release.ts deploy --worker mm-api --env production --split <good-version-id>@100 --message "rollback: <reason>"
npm run smoke -- --base https://maneman.in --environment production --version-id <good-version-id>
```

Use `--worker mm-site` for the site. Rolling back code never rolls back D1: every migration works with the previous code (`docs/decisions/0006-deployment-pipeline.md`), so the previous version runs on the migrated schema.

If a release stopped halfway through a rollout, `release.ts current` refuses to answer and prints the split. Deploy the good version at 100% as above.
