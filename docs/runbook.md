# Runbook

Commands run from the repository root. `W` stands for `node node_modules/wrangler/bin/wrangler.js`. Always pass `--env staging` or `--env production`; the top level of each config is local only. `<env>` is `staging` or `production`, and `<t>` is `staging` or `prod`, as resource names have it.

Everything lives in the Cloudflare account `Tech@maneman.in's Account` (`a2e185075b1b8eef3bee24b72f45ace3`), which holds the `maneman.in` zone.

To run SQL against an environment's database: `W d1 execute maneman-<env> --env <env> --remote --command "<sql>"`, where `maneman-<env>` is `maneman-staging` or `maneman-prod`. The SQL below is written for that command.

Five Workers make up each environment: `mm-api` (every `/api/*` route, the database, the queues and the cron), `mm-site` (the public site, `docs/frontend.md`), and the three apps, `mm-app`, `mm-ops` and `mm-tech` (`docs/front-ends.md`). Staging serves all five. Production serves mm-api and a placeholder page from mm-site until the owner's go-ahead.

## When something is wrong

An alert in the alert space names what went wrong with IDs only; "What each alert means", under "Alerts and the cron", says where each one leads. Otherwise, start from the symptom:

| Symptom                                                     | Section                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Nobody can sign in, or messages stop                        | "WhatsApp (Evolution) is down", and "The WhatsApp number is banned" |
| Visits stop reaching FSM, or FSM's changes stop reaching us | "FSM is down", "FSM's webhook has stopped"                          |
| A paid booking is waiting for FSM, or a refund failed       | "A booking FSM would not take", "A refund that failed"              |
| Clients pay and their bookings never confirm                | "Razorpay's webhook is not arriving"                                |
| An invoice is still a draft, or Books refuses something     | "Invoices and Books"                                                |
| Leads stop reaching the CRM                                 | "Leads and Zoho"                                                    |
| Try-ons fail                                                | "Try-on and WhatsApp"                                               |
| A technician lost a phone, or his work is stuck on it       | "A technician's lost phone", "Work stuck on a technician's phone"   |
| Ops cannot get into the console                             | "Locked out of the ops console"                                     |
| R2 storage is growing, or a usage e-mail came               | "Staying on the free tier"                                          |
| A daily allowance is 70% used                               | "The daily allowances"                                              |
| Every host answers Cloudflare's error 1027                  | "Workers daily limit reached (1027)"                                |
| Data is wrong or gone in D1                                 | "Restoring D1"                                                      |
| The heartbeat or the uptime monitor says mm-api is down     | "The outside watchers", "A cron run cut short"                      |
| A release is misbehaving                                    | "Rolling back a Worker version"                                     |
| Personal data may have leaked                               | "A personal data breach"                                            |

---

## Provisioning an environment

### Where things stand, 27 September 2026

Staging's column is as its deploy of 27 September 2026 found it: all five Workers took commit 16fde86 and passed the smoke tests. Production's is as last recorded: its last release was 268eaa4 on 21 September 2026, which deployed mm-api and mm-site. Nothing here was read from production for this table; "Before the first production release of Phase 2", below the steps, is how to check.

| Step                                           | staging                                                | production                                                                                |
| ---------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1. D1 database                                 | done                                                   | done                                                                                      |
| 1. Queues: render, crm-sync, messaging         | done                                                   | done                                                                                      |
| 1. Queue: fsm-sync                             | done                                                   | not yet (open point 85)                                                                   |
| 1. R2 buckets, 30-day expiry                   | done                                                   | done                                                                                      |
| 1. R2 buckets: photographs, referral cards     | done                                                   | not yet (open point 86)                                                                   |
| 2. DNS record                                  | done                                                   | exists (the apex record)                                                                  |
| 3. Access application and service token        | done                                                   | not applicable                                                                            |
| 4. Migrations and identity mark                | done                                                   | done, to the migrations of 268eaa4                                                        |
| 5. Bootstrap deploy of mm-api and mm-site      | done                                                   | done                                                                                      |
| 6. CI tokens and GitHub secrets, checked       | done                                                   | done                                                                                      |
| 7. Worker secrets: Turnstile, IP salt          | done                                                   | done                                                                                      |
| 7. Worker secrets: alert webhook               | done (Google Chat)                                     | done (the same Google Chat space)                                                         |
| 7. Worker secrets: AILabTools, link signing    | done                                                   | done (staging's AILabTools key, for now)                                                  |
| 7. Worker secrets: Evolution, allowlist        | done (poker-settle's bridge, for now)                  | Evolution done (the same bridge; messaging off)                                           |
| 7. Worker secrets: erasure                     | done                                                   | done                                                                                      |
| 7. Worker secrets: login code pepper           | done (22 September 2026)                               | not yet: with the client surface                                                          |
| 7. Worker secrets: the cron's heartbeat        | not yet ("The outside watchers")                       | not yet ("The outside watchers")                                                          |
| 7. Worker secrets: the analytics token         | not yet ("The daily allowances")                       | not yet: moves here from staging at go-live                                               |
| 8. Zoho org, fields, secrets                   | done: the real org (ADR 0050)                          | done: the real org (ADR 0050)                                                             |
| 9. Triggers: the cron                          | done, and checked by the deploy                        | done                                                                                      |
| 9. Triggers: the queue consumers               | done (all four); CI cannot read them, so check by hand | three; fsm-sync's once its queue exists                                                   |
| 10. Access bypass for result links             | done                                                   | not applicable                                                                            |
| 10b. Access bypass for invite previews         | not yet: the owner's (27 September 2026)               | not applicable                                                                            |
| 11. Phase 2 hosts: DNS, Access                 | done                                                   | done (all three behind Access until go-live)                                              |
| 11. Phase 2 surfaces switched on               | done (22 September 2026)                               | not yet: waits for the production go-ahead                                                |
| 11. The apps' Workers: mm-app, mm-ops, mm-tech | done: each deploys with every merge                    | mm-app recorded as bootstrapped with no route (open point 83); mm-ops and mm-tech not yet |
| 11b. FSM and Books                             | done                                                   | not yet: `FSM_PROVIDER` and `BOOKS_PROVIDER` are `none`                                   |
| 11c. Razorpay                                  | done, test keys                                        | not yet: `PAYMENTS_PROVIDER` is `none`                                                    |
| 12. Evolution receipts: token, bypass          | done                                                   | not yet                                                                                   |
| 12. Evolution receipts: the webhook            | open: the shared instance's webhook                    | not yet                                                                                   |
| 13. The address search (Google)                | `google`, and Google refuses the key (open point 54)   | not yet: `none`                                                                           |
| 14. Cloudflare's edge scripts                  | owed: both reach every host (step 14)                  | owed: the same zone settings (step 14)                                                    |
| 15. The rate-limiting rule                     | owed: the owner's (step 15)                            | the same rule: it is the zone's                                                           |

### 1. Resources

```sh
W d1 create maneman-<env> --location apac      # put the ID in wrangler.jsonc, env.<env>
W queues create mm-render-<t>
W queues create mm-crm-sync-<t>
W queues create mm-messaging-<t>
W queues create mm-fsm-sync-<t>
npm run check:config -- --require-provisioned  # must pass before anything deploys
```

`wrangler.jsonc` binds all four queues and all four buckets below in every environment, so an upload of mm-api fails until each exists. The release uploads before it migrates (ADR 0006), so a missing one stops it with the database untouched.

R2 must be enabled on the account first (dashboard → Storage & databases → R2; it needs a payment method). Try-on photos and results must not outlive 30 days, so each bucket gets an expiry rule:

```sh
for bucket in mm-<t>-tryon-uploads mm-<t>-tryon-results; do
  W r2 bucket create $bucket --location apac
  W r2 bucket lifecycle add $bucket expire-after-30-days --expire-days 30 --abort-multipart-days 1 --force
done
```

Phase 2's two buckets get no rule: a client's photograph is deleted only on purpose, and a referral card when its referrer or a revoke takes it down.

```sh
W r2 bucket create mm-<t>-client-photos --location apac
W r2 bucket create mm-<t>-referral-cards --location apac
```

Then check every bucket the Workers bind: that it exists, that the try-on ones expire everything within 30 days, and that no other expires anything. CI's tokens may not read R2 (step 6), so this takes a token of your own that can (Account → Workers R2 Storage → Read), as `CLOUDFLARE_API_TOKEN` in a git-ignored `.env.cf-read`:

```sh
node --env-file=.env.cf-read scripts/check-buckets.ts <env> --strict
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
5. Phase 2's staging hosts (`app-staging`, `ops-staging`, `tech-staging`) each get the same two policies: the founders, and Service Auth for `mm-ci-staging` (step 11).

In production only the ops console (`ops.maneman.in`) stays behind Access. Its CI token is its own, so a staging credential never opens production:

1. Access → Service credentials → Service tokens → Create `mm-ci-production`. Copy the client ID and secret; the secret is shown once.
2. On the `ops.maneman.in` application, add a **Service Auth** policy that includes `mm-ci-production`, and take `mm-ci-staging` off it.
3. Store it as the `production` environment's secrets:

   ```sh
   gh secret set CF_ACCESS_CLIENT_ID --env production      # prompts for the client ID
   gh secret set CF_ACCESS_CLIENT_SECRET --env production  # prompts for the secret
   ```

`app.maneman.in` and `tech.maneman.in` are behind Access only until go-live. Clients and technicians sign in with their own codes, so at go-live their Access applications are deleted.

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
- Workers: role **Editor**, scope **Specified Workers**: every Worker in `scripts/lib/workers.ts`, for that environment: `mm-api-<env>`, `mm-site-<env>`, `mm-app-<env>`, `mm-ops-<env>` and `mm-tech-<env>`. A token can only name a Worker that exists, so a new Worker is added to its token after its bootstrap (step 11); until then its deploy step skips it, or fails with "No access to the specified service".
- Account → **D1 → Edit**. This is account-wide, so the staging token can also read and write production's database, and production's staging's; that is accepted in `docs/decisions/0008-owner-decisions-on-platform-constraints.md`.
- Optional, production's token: Account → **Account Analytics → Read**. With it, the canary's soak judges the new version on real visitors' errors as well as the smoke's (`docs/decisions/0006-deployment-pipeline.md`); without it the soak says so and the smoke checks stand alone.
- Optional, production's token: Account → **Workers Observability → Edit** (Cloudflare asks for Edit to run a query, which changes nothing). With it, the soak also fails a release whose busy routes read more rows from D1 a request than their ceilings in `scripts/lib/free-tier-budget.ts`; without it the soak says it could not read them.
- Optional, staging's token: the same **Account Analytics → Read**. With it, each staging deploy reports mm-api's CPU time over the last day against the free plan's 10 ms (`scripts/cpu-report.ts`); without it the step says it could not read it.
- No zone permissions, and nothing on R2 or Queues: a token that reads a bucket's settings can read the photographs in it.

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

| Secret                                                                      | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TURNSTILE_SECRET`                                                          | The secret of the environment's Turnstile widget (Cloudflare dashboard → Turnstile).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `IP_HASH_SALT`                                                              | 32 or more random characters: `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`. Changing it resets the rate-limit counters.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ALERT_WEBHOOK_URL`                                                         | An incoming-webhook URL for Slack, Google Chat or Discord. Alerts carry IDs, never names or numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `LEAD_WEBHOOK_URL`                                                          | Optional. Where the one-line notice for each new lead is posted, if not the alert space (`docs/decisions/0018-one-look-pro-only-lead-notices.md`). Notices carry city, window and date, never a name or number.                                                                                                                                                                                                                                                                                                                                                          |
| `HEARTBEAT_URL`                                                             | Optional, and wanted before go-live. The ping URL of the environment's healthchecks.io check, `https://hc-ping.com/<uuid>`, which the cron pings after every run ("The outside watchers").                                                                                                                                                                                                                                                                                                                                                                               |
| `CLOUDFLARE_ANALYTICS_TOKEN`                                                | Optional, and in one environment only. An Account API Token with Account → **Account Analytics → Read** and nothing else, with which the cron reads once an hour what the account has used of its daily allowances ("The daily allowances"). Both environments would read the same account and post to the same space, so it is staging's until go-live, then production's, and deleted from staging.                                                                                                                                                                    |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_LAR_ID` | Step 8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ZOHO_ACCOUNTS_HOST`, `ZOHO_API_HOST`                                       | India data centre: `accounts.zoho.in`, and for the API `www.zohoapis.in`. Both environments use the real org (ADR 0050); a Developer Edition org would answer on `developer.zohoapis.in` instead.                                                                                                                                                                                                                                                                                                                                                                        |
| `AILAB_API_KEY`                                                             | The environment's AILabTools API key, a separate key per environment where the dashboard allows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `RESULT_SIGNING_KEY`                                                        | 32 or more random characters, generated like `IP_HASH_SALT`. Signs upload and result links; changing it invalidates links already handed out.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`         | The Evolution API bridge (`docs/decisions/0016-whatsapp-through-evolution.md`). The URL must be public `https://`, reachable from Cloudflare, and include the port if it is not 443: staging's ends in `ts.net:8443`, because port 443 on that host serves another app. `GET /` there should answer "Welcome to the Evolution API".                                                                                                                                                                                                                                      |
| `ERASURE_SECRET`                                                            | 32 or more random characters, generated like `IP_HASH_SALT`. Authorises `POST /api/erasure`. Keep one copy, in the git-ignored `.env.erasure-<env>` file that ops use for erasures ("Erasure within the day").                                                                                                                                                                                                                                                                                                                                                           |
| `MESSAGING_ALLOWLIST`                                                       | Staging: the founders' mobile numbers, comma-separated. Holds back an automatic message — a reminder, a launch alert, or one to someone other than who acted — and any message about a record one of our own scripts made ("Staging test", "Load test"), whatever its kind; a login code and a message that answers a real person who just acted (their booking, their move, their cancel, the try-on result they claimed) reach any number otherwise (ADR 0097; `isStagingTestRecord`, `src/policy/staging-test-records.ts`). A secret, so the numbers stay out of git. |
| `STAGING_TEST_RECORD_CODE`                                                  | Staging only, optional: six digits that a "Staging test …" record signs in with, so an audit walks the real login screens; such records also skip the per-address limits on codes and the site's forms (`src/policy/staging-test-records.ts`). The guard refuses it anywhere else.                                                                                                                                                                                                                                                                                       |
| `GOOGLE_MAPS_API_KEY`                                                       | The address search, once `GEOCODE_PROVIDER` is `google`. Make and restrict it in section 13 first: an unrestricted key is a key anyone can spend.                                                                                                                                                                                                                                                                                                                                                                                                                        |

**A required secret set to an empty value stops the Worker.** The settings reader counts an empty string as unset, the identity guard then refuses to start, and every request answers Cloudflare's error 1105 until it is set again. A secret change deploys a new version by itself, so the break is immediate; check `/api/health` after any `secret bulk`.

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

The Turnstile widgets are `mm-staging` (hostname `staging.maneman.in`) and `mm-production` (`maneman.in`, `www.maneman.in`, and `app.maneman.in` before the client app goes live there). The front ends need their site keys, which are public: `docs/turnstile.md`.

### 8. Zoho

Both environments use the real org (`docs/decisions/0050-crm-in-the-real-org.md`), which also holds FSM and Books. Do this once per org.

Steps 1 and 2 are what `scripts/setup-crm.ts` does, where the refresh token's scope includes `ZohoCRM.settings.fields.ALL`:

```sh
node --env-file=.env.crm-<env> scripts/setup-crm.ts --check   # read-only
node --env-file=.env.crm-<env> scripts/setup-crm.ts           # creates what is missing
```

Zoho names a new field from its label, so the script reads each one back: the sync writes the API name and nothing else. Steps 3 and 4 have no API and stay by hand.

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
   | Referral Code (`Referral_Code`)                          | Single line |                                                                    |
   | Booked Window (`Booked_Window`)                          | Pick list   | Morning, 9 am to 12 pm; Afternoon, 12 to 4 pm; Evening, 4 to 8 pm  |

2. **Pick-list values.** Lead Status: add `New`, `Waitlist` and `Try-on — delivery only` (with the em dash). Lead Source: add `Booking form`, `Waitlist`, `Try-on` and `Referral`.

   The last two fields and `Referral` came with ADR 0074, for an invited friend and the window a booking asked for. Zoho refuses a lead carrying a pick-list value it does not have, so the sync writes none of the three until `CRM_ORG_HAS_REFERRAL_FIELDS` in `src/config/crm.ts` is turned on: run `scripts/setup-crm.ts`, then `scripts/check-zoho-setup.ts` to prove them, then turn it on in a release. Until then a record the CRM already has gets the invite and the window in its note.

3. **Assignment rule.** Setup → Automation → Assignment Rules → Leads: create the rule that gives each new booking an owner. Its ID becomes `ZOHO_LAR_ID`; `scripts/check-zoho-setup.ts` (step 6) lists it. An org may have none: leave `ZOHO_LAR_ID` unset and Zoho leaves each record with the API user.
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

7. **A refresh token for scripts.** Zoho mints at most ten access tokens in ten minutes from one refresh token, so a script run by hand must never share the Worker's: a proof that did took FSM down with it (`docs/open-points.md`, item 32). Repeat step 5.2 and 5.3 with the same Self Client to get a second refresh token, with only the scopes the scripts need (`ZohoCRM.settings.fields.ALL`, `ZohoCRM.settings.assignment_rules.READ`; for FSM and for Books, the same scopes as the Worker's FSM and Books tokens, step 11b). Keep it in the scripts' own git-ignored file, never in a Worker secret:
   - the CRM's as `ZOHO_SCRIPTS_REFRESH_TOKEN`, beside `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` and the hosts;
   - FSM's as `ZOHO_FSM_SCRIPTS_REFRESH_TOKEN`, beside `ZOHO_FSM_CLIENT_ID`, `ZOHO_FSM_CLIENT_SECRET` and the hosts;
   - Books' as `ZOHO_BOOKS_SCRIPTS_REFRESH_TOKEN`, beside `ZOHO_BOOKS_CLIENT_ID`, `ZOHO_BOOKS_CLIENT_SECRET`, the hosts and `ZOHO_BOOKS_ORG_ID`, in `.env.books-scripts`.

   `scripts/check-zoho-setup.ts`, `scripts/setup-crm.ts` and `scripts/setup-fsm.ts` stop, naming this step, when theirs is missing (`scripts/lib/zoho-script-token.ts`). In an emergency, with the scripts' token lost, `--use-worker-token` runs one on the Worker's token on purpose; every token it mints is one the Worker cannot for ten minutes.

### 9. Triggers

CI deploys code but cannot attach cron schedules, queue consumers or routes (`docs/decisions/0010-applying-triggers.md`). After the code that handles them is live, attach every Worker's:

```sh
npm run apply-triggers -- --env <env>
```

After every deploy, both workflows compare the live cron schedules and queue consumers with every Worker's config, and warn on a difference. CI's token cannot read the queues, so its consumers read "not compared"; check them, and confirm an `apply-triggers`, with a token of your own that can read Workers and Queues:

```sh
node --env-file=.env.cf-read scripts/check-triggers.ts <env> --strict
```

### 10. Result links through Access (staging only)

A WhatsApp copy carries a link to `/api/result/…`, which the Evolution bridge fetches. On staging, Cloudflare Access would stop it. Each link is signed and expires, so the path can bypass Access:

1. Zero Trust → Access → Applications → Add → Self-hosted. Domain `staging.maneman.in`, path `api/result/`.
2. Policy: action **Bypass**, include **Everyone**.

Access applies the most specific path, so the rest of staging stays behind the founders' login.

### 10b. Invite previews through Access (staging only)

Added 27 September 2026. An invite is a link to `https://staging.maneman.in/r/<code>`, and WhatsApp draws its preview from that page's Open Graph tags and the card they name. Its crawler has no Access login, so on staging it met the sign-in instead, and every invite shared from staging arrived with no image. Where the phone can share files the app now sends the card itself as well (ADR 0048, amended 27 September 2026), but the link's preview still needs the crawler to reach the page and the card:

1. Zero Trust → Access → Applications → Add → Self-hosted, with three public hostnames, each domain `staging.maneman.in`: paths `r/`, `images/` and `api/og/`.
2. Policy: action **Bypass**, include **Everyone**.

**What it exposes**, to anyone with a code, and only what production serves anyone with the link:

- the landing's HTML for any code, with the referrer's first name where they agreed to be named;
- the house card, the one file under `images/`;
- a referrer's own card, `api/og/<code>.jpg`, while it is live.

The invite's API (`/api/r/*`), the pincode check (`/api/pincodes`), the page's scripts and styles (`/_astro/*`) and every other path stay behind the founders' login, so a visitor without it gets the page unstyled, and it does nothing. The crawler reads only the HTML.

**Check it** from outside Access, as the crawler is:

```sh
npm run smoke -- --base https://staging.maneman.in --environment staging --link-preview <code>
```

It fetches `/r/<code>`, then the card its `og:image` names, with WhatsApp's user agent and never the Access token, even one in the environment. It passes on the page with an absolute `og:image` and a JPEG under 300 KB. It is not part of the deploys' smoke: it fails until this step is done, and would stop every staging deploy.

Then share an invite on a handset. WhatsApp keeps a link's preview by its address, so a link it has already seen keeps showing none: add a query it has not seen, `https://staging.maneman.in/r/<code>?t=1`, then `?t=2`, and so on. The landing ignores the query.

### 11. Switching on a Phase 2 surface

Each Phase 2 surface is switched on per environment, once its host exists (docs/decisions/0026-hosts-and-surfaces.md):

| Surface        | Staging                   | Production        |
| -------------- | ------------------------- | ----------------- |
| Client app     | `app-staging.maneman.in`  | `app.maneman.in`  |
| Ops console    | `ops-staging.maneman.in`  | `ops.maneman.in`  |
| Technician app | `tech-staging.maneman.in` | `tech.maneman.in` |

To switch one on:

1. **DNS.** Add a record of type `AAAA`, named after the host (e.g. `ops-staging`), with IPv6 address `100::`, **Proxied**.
2. **Access.**
   - The ops console is behind Access in both environments. On staging, the client and technician apps are behind it as well.
   - Add a Self-hosted application for the host, with an Allow policy for the people who should reach it.
   - Add a **Service Auth** policy that includes `mm-ci-<env>`, so the smoke tests get through.
3. **The ops audience tag** (ops console only).
   - Copy the application's **Application Audience (AUD) Tag** from its overview.
   - In `wrangler.jsonc`, set it as `ACCESS_OPS_AUD` in the environment's `vars`, and as `""` in the other blocks so every block names the same vars.
   - The Worker checks every ops token against this tag (docs/decisions/0031-access-and-audit.md). It refuses to start with the ops surface switched on and no tag.
4. **The code**, in one pull request:
   - add the surface to `ENABLED_SURFACES` in `src/config/environments.ts`;
   - add `<host>/api/*` to the environment's `routes` in `wrangler.jsonc`.

   The config check fails if either comes without the other.

5. **The route.** After the merge, attach the new route with `npm run apply-triggers -- --env <env>` (step 9), since CI never changes routes. Never `W deploy --env production` for it: that sends a version of mm-api all production traffic outside the release, with no canary and before its migrations (corrected 27 September 2026). Then run the smoke tests against the new host.
6. **The app's own Worker**, where the surface has one: the client app is `mm-app` (docs/decisions/0043-client-app.md), the ops console is `mm-ops`, and the technician app is `mm-tech` (docs/decisions/0053-the-technician-app-offline.md). Its first deploy is a bootstrap, which also attaches its route; CI deploys it after that. Until then a production release passes over it, as long as its surface is not switched on there. A Worker that must be there and is not — mm-api, mm-site, or an app whose host is live — fails the deploy, and so does any answer from Cloudflare other than "it does not exist".

   ```sh
   npm run build:app -- --env <env>
   W deploy --config apps/app/wrangler.jsonc --env <env> --tag bootstrap

   npm run build:ops -- --env <env>
   W deploy --config apps/ops/wrangler.jsonc --env <env> --tag bootstrap

   npm run build:tech -- --env <env>
   W deploy --config apps/tech/wrangler.jsonc --env <env> --tag bootstrap
   ```

   Then add the new Worker to that environment's CI token (step 6), which can only name a Worker that exists.

### 11a. The client app's login

Before the client surface is switched on in an environment, give its Worker the pepper that login codes are hashed under (docs/decisions/0030-one-time-codes.md): a random value of at least 32 characters, different in each environment.

```sh
openssl rand -hex 32 | W secret put OTP_PEPPER --env <env>
```

Changing it later voids every code in flight; sessions are unaffected. SMS stays off (`SMS_PROVIDER` is `none`) until a DLT-registered provider is set up.

### 11b. Zoho FSM and Books

The client surface reads visits from Zoho FSM and documents from Zoho Books (docs/decisions/0032-fsm-mirror.md). Both are in the real org (ADR 0025, item 26), each on a refresh token of its own.

1. **The refresh tokens.** Zoho allows one Self Client per account, so FSM and Books use the CRM's (step 8.5): the same client ID and secret, and a new code for each. In `https://api-console.zoho.in`, as an administrator of the org, open that Self Client. On **Generate Code**, use FSM's scopes in `docs/phase2-inputs.md`, section 3, and for Books `ZohoBooks.contacts.ALL`, `ZohoBooks.invoices.ALL`, `ZohoBooks.customerpayments.ALL`, `ZohoBooks.creditnotes.ALL`, `ZohoBooks.settings.READ`, `ZohoBooks.settings.CREATE` and `ZohoBooks.settings.UPDATE`. Exchange each code for a refresh token within its 10 minutes:

   ```sh
   curl -X POST "https://accounts.zoho.in/oauth/v2/token?grant_type=authorization_code&client_id=<id>&client_secret=<secret>&code=<code>"
   ```

   FSM's and Books' secrets hold the same client ID and secret, and a refresh token each. Each keeps its own access token.

2. **The files.** Put FSM's values in `.env.fsm-<env>` and Books' in `.env.books-<env>`. Git ignores both.

   ```sh
   ZOHO_FSM_CLIENT_ID=...
   ZOHO_FSM_CLIENT_SECRET=...
   ZOHO_FSM_REFRESH_TOKEN=...
   ZOHO_FSM_ACCOUNTS_HOST=accounts.zoho.in
   ZOHO_FSM_API_HOST=www.zohoapis.in
   ZOHO_BOOKS_ORG_ID=...
   ```

   ```sh
   ZOHO_BOOKS_CLIENT_ID=...
   ZOHO_BOOKS_CLIENT_SECRET=...
   ZOHO_BOOKS_REFRESH_TOKEN=...
   ```

   The Books organisation ID is on Books → Settings → Organisation Profile.

3. **The org.** Check it, then create what is missing: a service item for the consultation, the service visit and the replacement, and the base part. A new visit item takes the price book's own figure of 22 September 2026; from then on the cron's hourly check compares each item with the book (step 8). A first fit has no item of its own: each hair system ops add in the console needs one, named exactly as the console names it, and a first fit is not booked into FSM until it has one.

   ```sh
   node --env-file=.env.fsm-<env> scripts/setup-fsm.ts --check
   node --env-file=.env.fsm-<env> scripts/setup-fsm.ts
   ```

   Books also needs a custom field on Customers and Vendors, **"MM person ID"**: Text, unique values, API name `cf_mm_person_id`. It is what finds a client's customer again. Then prove Books' calls on "Staging test" records the script removes again (about 20 calls; it keeps one item, "Staging test: proof item", which the scripts' scopes cannot delete):

   ```sh
   node --env-file=.env.books-scripts scripts/books-proof.ts
   ```

4. **The Worker.** Set the secrets, then set the hosts (`ZOHO_FSM_*_HOST`, `ZOHO_BOOKS_*_HOST`) and `ZOHO_BOOKS_ORG_ID` in `wrangler.jsonc`, with `FSM_PROVIDER` and `BOOKS_PROVIDER` as `zoho`.

   ```sh
   W secret put ZOHO_FSM_CLIENT_ID --env <env>
   W secret put ZOHO_FSM_CLIENT_SECRET --env <env>
   W secret put ZOHO_FSM_REFRESH_TOKEN --env <env>
   W secret bulk .env.books-<env> --env <env>    # ZOHO_BOOKS_CLIENT_ID, _SECRET and _REFRESH_TOKEN, nothing else
   ```

   Set the secrets before deploying with the providers switched on: the guard refuses a Worker without them. FSM's are needed while `FSM_PROVIDER` is `zoho`, and Books' while `BOOKS_PROVIDER` is. Check `/api/health` after: a secret change deploys by itself, and an empty required secret stops the Worker (step 7).

5. **The buckets and the queue.** `mm-<t>-client-photos`, `mm-<t>-referral-cards` and `mm-fsm-sync-<t>` are step 1's, and must exist before any deploy, since `wrangler.jsonc` binds them whether FSM is on or not. Neither bucket gets a lifecycle rule: a client's photograph is only deleted on purpose. Once the code that consumes the queue is live, attach its consumer (step 9):

   ```sh
   npm run apply-triggers -- --env <env>
   ```

6. **FSM's webhook** keeps the mirror current within seconds. Without it, the mirror waits for the reconciliation.
   - **The token.** Make one with `openssl rand -hex 24`, keep it in the password manager, and set it with `W secret put FSM_WEBHOOK_TOKEN --env <env>`: the webhook's URL below needs the same value, and a secret cannot be read back (corrected 27 September 2026; piping it straight into `secret put` lost it).
   - **The webhook.** In FSM, Setup → Automation → Webhooks → New Webhook:
     - URL: `https://<public host>/api/hooks/fsm/<token>`;
     - method: POST;
     - body: form data, with three parameters from the Service Appointment: `module` (the value `Service_Appointments`), `id` (the appointment's ID), and `modified_time` (its Modified Time).
   - **Photographs.** Until the technician app arrives, technicians attach a visit's photographs to its appointment in FSM, named for their phase and angle: `before-front.jpg`, `before-top.jpg`, `before-left.jpg`, `before-right.jpg`, `before-hair.jpg`, and the same with `after-`. Other attachments are not copied.
   - **The workflow rule.** Setup → Automation → Workflow Rules → Service Appointments → New Rule:
     - when a record is created or edited, and when it is deleted;
     - action: the webhook.
   - **The deletion's own webhook.** A deleted appointment keeps the modified time of its last edit, so its hint reads as a repeat of that edit and is dropped. Make a second webhook like the first, with a fourth parameter `event` of value `delete`, and a second workflow rule that runs it when a record is deleted; take deletion out of the first rule. Until this is done, the reconciliation still finds a deletion: each run reads two upcoming visits afresh, the longest unread first, so an upcoming visit deleted in FSM leaves the mirror within a few hours rather than the next night.
   - **On staging,** the hooks path already has the Access bypass (step 12, point 3).

7. **The refund account.** Payments go to Books by themselves (docs/decisions/0044-payments-mirror.md, "Receipts in Books"). Refunds need the account Books pays them from, which must be a bank account: Books refuses Undeposited Funds.
   - In Books: Banking → Add Bank or Credit Card → Bank, named "Razorpay", in INR.
   - Open it; its ID is the number at the end of the address.
   - Set it as `BOOKS_REFUND_ACCOUNT_ID` in the environment's vars in `wrangler.jsonc`, then deploy. It is not a secret.

8. **FSM's catalogue and the price book.** FSM prices a visit's tax invoice from its catalogue item, so each item must hold the price book's price before GST (docs/decisions/0073-prices-from-the-price-book.md).
   - **The check.** Once an hour the cron's `fsm_catalogue` job reads the catalogue and compares it with the book. An item that differs, or is missing, is an alert `fsm_catalogue:<visit type>` naming the item's ID and both figures, closed when the two agree. Until the push is on, set the item's price in FSM by hand as the alert says (Setup → Service and Parts).
   - **The push** writes each price ops set in the console to the catalogue, and a price from a later day on its day. `FSM_CATALOGUE_PUSH` in `src/config/environments.ts` is off in every environment. **Only the owner switches it on, and only in production,** once production's price book holds the owner's prices and production connects FSM: set its `production` to `true`, and release. Staging's stays off for as long as it shares the owner's real org; a test refuses it on.
   - **After switching it on,** set any price in the console and look for `fsm_catalogue_pushed` in the logs; the next hour's check should raise no `fsm_catalogue` alert. The write, `PUT /fsm/v1/Products/{id}`, has never been tried on the org (`docs/open-points.md`, item 25): if FSM refuses it, `fsm_catalogue_push_failed` is logged with FSM's answer, and the check tells ops an hour later.

9. **Discounts at line-item level.** A discount code on a visit is written onto its draft invoice as the visit line's discount, before tax (docs/decisions/0108-discount-codes.md). In Books: Settings → Preferences → Invoices (or General, "Do you give discounts?"), choose discounts at line-item level, before tax. Until it is set, and until the first discounted visit is invoiced on staging, a draft Books will not discount is held and ops told (`docs/open-points.md`, item 181).

### 11c. Razorpay

Payments and refunds are mirrored from Razorpay's webhook (docs/decisions/0044-payments-mirror.md). Staging uses test keys, which take no real money.

1. **The keys.** Follow `docs/phase2-inputs.md`, section 4. The key ID goes in `wrangler.jsonc` as `RAZORPAY_KEY_ID`, since it is public, with `PAYMENTS_PROVIDER` set to `razorpay`. The key secret is a secret:

   ```sh
   W secret put RAZORPAY_KEY_SECRET --env <env>
   ```

2. **The webhook secret.** Make one, set it on the Worker, and keep it to paste into Razorpay:

   ```sh
   openssl rand -hex 24
   W secret put RAZORPAY_WEBHOOK_SECRET --env <env>
   ```

3. **The webhook,** in Razorpay's dashboard, in the mode that matches the keys: Account & Settings → Webhooks → Add New Webhook.
   - URL: `https://<public host>/api/hooks/razorpay`.
   - Secret: the one from point 2.
   - Events: `order.paid`, `payment.authorized`, `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed`, and `payment_link.paid`, which names the payment link a consultation and fit in one visit was paid by (ADR 0105).
   - Payment links on: the one visit's link is made through the API (`POST /v1/payment_links`), which the account must allow (open point 166).
   - On staging, the hooks path already has its Access bypass (step 12, point 3).

### 12. WhatsApp delivery receipts (Evolution)

Evolution reports each message as delivered and read to `POST /api/hooks/evolution/<token>` (docs/decisions/0041-outbound-messages-for-phase-2.md). The no-show evidence depends on these receipts. Until this is set up, the route answers 404 and no receipts are recorded.

1. **The token.** Make a random value of at least 32 characters, e.g. `openssl rand -hex 24`, and set it on the Worker with `W secret put EVOLUTION_WEBHOOK_TOKEN --env <env>`. Use a different value in each environment.
2. **Evolution's webhook**, on the instance the Worker sends from:
   - URL: `https://<host>/api/hooks/evolution/<token>`;
   - events: **`MESSAGES_UPDATE` only**;
   - "webhook by events": off.

   Every event is a request against the free plan's daily allowance, so send no others.

3. **On staging, an Access bypass** for the hooks, as in step 10:
   - Zero Trust → Access → Applications → Add → Self-hosted;
   - domain `staging.maneman.in`, path `api/hooks/`;
   - policy: **Bypass**, **Everyone**.

   Each hook checks its own secret.

4. **Check it.** Send a try-on result to an allowlisted handset and open the message. Then:

   ```sql
   SELECT state, sent_at, delivered_at, read_at FROM outbound_messages ORDER BY created_at DESC LIMIT 5;
   ```

   `delivered_at` and `read_at` should be filled within seconds. If they stay empty, look in Workers Logs:
   - `evolution_hook_unauthorized`: the token in Evolution's URL is wrong;
   - no `evolution_receipts` line at all: Access or Bot Fight Mode is stopping the webhook.

---

### 13. The address search (Google Maps Platform)

The client app's address form searches for a building and keeps a coordinate for the check-in's geofence (docs/decisions/0054-address-capture.md). Until this is done, `GEOCODE_PROVIDER` stays `none`: the form takes a typed address, saves no coordinate, and nothing calls Google.

**This is the owner's card, so do every step. Google's free allowance does not stop at its limit — it bills. Google's budget alerts are not a spending cap; they tell you after the money is spent. The only thing that stops a charge is the per-API quota in step 4.**

Everything below is at <https://console.cloud.google.com>, signed in as the account that holds the card.

1. **A project of its own.** Top bar → the project picker → **New project**. Name it `mane-man-maps`. A separate project keeps the quotas and the bill readable, and lets the key be deleted without touching anything else.

2. **Switch on exactly two APIs, and no others.** Navigation menu (☰) → **APIs & Services** → **Library**. Search for and **Enable** each:
   - **Places API (New)** — the search box.
   - **Geocoding API** — the coordinate we keep.

   Do not enable Maps JavaScript API, Maps SDK, Static Maps, Routes, Distance Matrix or anything else. Nothing draws a map, so nothing else is called, and an API that is not enabled cannot be billed.

3. **Make the key and restrict it.** **APIs & Services** → **Credentials** → **Create credentials** → **API key**. Then **Edit API key** on the one just made:
   - **Name:** `mm-api address search`.
   - **Application restrictions:** choose **IP addresses**. The key is used only by our Worker, server to server, never by a browser — so add Cloudflare's egress ranges. In practice a Worker's outbound address is not fixed, so if the restriction refuses our calls, set this to **None** and rely on step 4's quota plus the API restriction below. **Never choose "Websites (HTTP referrers)"**: that restriction is for keys in a page, and ours is never in a page.
   - **API restrictions:** choose **Restrict key** and tick **only** Places API (New) and Geocoding API. This is the important one. A key restricted to two APIs cannot be spent on a third even if it leaks.
   - **Save.**

4. **Cap each API's quota, so the card cannot be charged.** This is the step that makes the rest safe. **APIs & Services** → each API in turn → **Quotas & System Limits**. Filter the list for the per-day quotas and set each with the pencil icon → **Edit quota**:

   | API              | Quota to edit                 | Set it to |
   | ---------------- | ----------------------------- | --------- |
   | Geocoding API    | Requests per day              | **300**   |
   | Places API (New) | Autocomplete requests per day | **2000**  |
   | Places API (New) | Autocomplete requests per day | **2000**  |

   These sit just above our own daily ceiling (`GEOCODE_DAILY_CEILING`, 200) so our code refuses first and Google's quota is the backstop. Both are far under the free allowance — Geocoding gets 70,000 free requests a month on the India price list, and 300 a day cannot reach it. A quota change can take a few minutes to apply, and some quotas need a one-line reason.

   If a quota field will not go below its default, lower the one above it in the list; Google applies the smallest that matches.

5. **Set the alarms anyway**, so a surprise is noticed even though a quota should prevent it. Navigation menu → **Billing** → **Budgets & alerts** → **Create budget**: scope it to the `mane-man-maps` project, amount **₹100**, and tick the alert thresholds at 50%, 90% and 100%. This does not stop spending; it only emails. The quota in step 4 is what stops it.

6. **Give the key to the Worker**, on staging only:

   ```sh
   W secret put GOOGLE_MAPS_API_KEY --env staging
   ```

   Paste the key when prompted. It is never printed, never committed, and never sent to the browser: the app calls our API and our API calls Google.

7. **Switch the provider on.** In `wrangler.jsonc`, under `env.staging.vars`, set `"GEOCODE_PROVIDER": "google"`, and deploy. Leave production as `none` until Phase 2 is released.

8. **Check it.** Sign in to the staging client app, open the profile, and start typing a building into "Search for your building". Suggestions should appear within a second, with the words _Google Maps_ under the list. Choose one, fill in the flat, save, and confirm the coordinate landed:

   ```sh
   W d1 execute maneman-staging --env staging --remote --command \
     "SELECT building, flat, place_id, lat, lng, geocode_source FROM addresses WHERE lat IS NOT NULL ORDER BY created_at DESC LIMIT 3"
   ```

   `geocode_source` should read `google_geocoding`. If `lat` is null, the save worked but the geocode did not: look for `address_resolve_failed` in the logs, which names the reason without the key.

#### If the address search misbehaves

- **Suggestions never appear, and the logs say `address_suggest_failed` with `refused`.** The key is wrong, restricted to the wrong APIs, or its quota is spent. The alert space is told once a day while it lasts, with Google's own words: the Places API refuses with a 403 and a message, the Geocoding API with a 200 whose `status` is `REQUEST_DENIED`, `OVER_DAILY_LIMIT` or `OVER_QUERY_LIMIT`. Check step 3's API restrictions first. The form still works: an address can always be typed.
- **"busy" instead of suggestions.** A ceiling is reached. `geocode` is the ceiling's name in the alert. Either a client is hammering the form — the per-client limit is 120 a day — or `GEOCODE_DAILY_CEILING` is too low for real use. Raise it in `wrangler.jsonc` and deploy; the guard refuses anything above 1,800.
- **To stop all spending at once.** Set `"GEOCODE_DAILY_CEILING": "0"` in `wrangler.jsonc` and deploy, or set `"GEOCODE_PROVIDER": "none"`. Either way the form keeps working, typed.
- **A charge appears at all.** Something is wrong, because the quotas in step 4 cannot reach the free allowance. Disable the key in **Credentials**, set `GEOCODE_PROVIDER` to `none`, and find out how before re-enabling it.

### 14. Cloudflare's edge scripts: Web Analytics and JavaScript detections

Cloudflare can add two scripts to a page at its edge, where no local run sees them. The staging deploy's last step opens every staging host's pages in Chromium and fails while any page refuses one (`npm run smoke:csp -- --environment staging`).

- **Web Analytics' beacon,** from `static.cloudflareinsights.com`. The site counts its visits with it, and its privacy notice says so; the site's policy allows the beacon's two hosts (`site/src/lib/static-files.ts`). The client app, the ops console and the technician app keep it out (`docs/open-points.md`, item 144).
- **JavaScript detections,** an inline script that loads `/cdn-cgi/challenge-platform/`. It changes with every request, so no hash can allow it, and no surface's policy does (ADR 0023, section 2). It stays off (item 111).

On 2 October 2026 both reached every staging host: the beacon reached the app, ops and technician hosts as well as the site, through the single rule Web Analytics makes for the whole zone, and the detections script reached every host. Both are the zone's settings, so production has the same.

1. **JavaScript detections off.** Cloudflare dashboard → `maneman.in` → **Security** → **Settings** (on the older dashboard, **Security** → **Bots**): check **Bot Fight Mode** is off, then turn **JavaScript detections** off. Cloudflare's documentation says they cannot be turned off while Bot Fight Mode is on. If the dashboard offers no such switch and the check below still fails, say so in item 111: the remaining choice is ADR 0023's option c, a nonce stamped per request.
2. **The beacon on the site only.** Cloudflare dashboard → **Web Analytics** → the site for `maneman.in` → **Manage site** → **Advanced options** → **Add rule**. Add one rule for each of `app-staging.maneman.in`, `ops-staging.maneman.in`, `tech-staging.maneman.in`, `app.maneman.in`, `ops.maneman.in` and `tech.maneman.in`: action **Disable**, path `*`. Then **Update**. The zone's own rule keeps the beacon on `maneman.in` and `staging.maneman.in`.
3. **Check.** Re-run the latest `deploy-staging` run, or run `npm run smoke:csp -- --environment staging` from a checkout with `.env.staging-access` beside it (step 3). Every page passes. Then rerun Lighthouse on staging's site home, `/book`, the app's Home and the technician's Today: best practices should be back at or above the 95 budget. Write the date in the table above.

If the site's pages carry no beacon once the rules are in, the automatic setup is not reaching the pages the Worker serves. The manual snippet, a `<script defer>` from `static.cloudflareinsights.com` with the site's token, then goes in `site/src/layouts/Site.astro`; the policy already allows its host.

### 15. The rate-limiting rule

The free plan gives the zone one rate-limiting rule. It keeps one address from spending the account's 100,000 Workers requests a day in minutes (ADR 0009, "Update, 4 October 2026: a flood"). A request it blocks is refused at the edge and never reaches a Worker, so it costs nothing. It covers every host in the zone, staging's and production's alike.

1. Cloudflare dashboard → `maneman.in` → **Security** → **Security rules** (on the older dashboard, **Security** → **WAF** → **Rate limiting rules**) → **Create rule** → **Rate limiting rules**.
2. **Rule name:** `API, per address`.
3. **If incoming requests match:** choose **Edit expression** and paste:

   ```
   (starts_with(http.request.uri.path, "/api/") and not starts_with(http.request.uri.path, "/api/hooks/"))
   ```

   The webhooks (`/api/hooks/razorpay`, `/api/hooks/evolution/…`) stay out, so a burst of payments is never refused. If the editor will not take the expression, build it instead: **URI Path** _starts with_ `/api/`, **And** **URI Path** _does not start with_ `/api/hooks/`.

4. **With the same characteristics:** IP, the only one the free plan offers.
5. **When rate exceeds:** **Requests** `50`, **Period** 10 seconds.
6. **Then take action:** **Block**, **Duration** 10 seconds. Then **Deploy**.
7. **Check.** From a terminal, `for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code} " https://maneman.in/api/health; done`: the first 50 or so answer `200`, then `429`, and ten seconds later `200` again. **Security** → **Analytics** → **Events** shows the blocks under the rule's name. Write the date in the table above.

Anything that sends more than 50 API requests in 10 seconds from one address is blocked too. The load test (`scripts/load-test-leads.ts`) sends 50 at once: run it with `--people 20`, or switch the rule off for its run and on again after. If ops working from one office are shown Cloudflare's block page, raise **Requests** rather than delete the rule.

### Before the first production release of Phase 2

Production runs 268eaa4, of 21 September 2026. The next release carries every migration since, and a Worker that binds what production has never had. Before starting `deploy-production.yml`:

1. **What mm-api binds.** Create what step 1 lists and production lacks: `mm-fsm-sync-prod`, `mm-prod-client-photos` and `mm-prod-referral-cards` (open points 85 and 86). Then check every bucket with `node --env-file=.env.cf-read scripts/check-buckets.ts production --strict`, and every queue with `W queues list`. A missing one stops the release at its upload, before any migration.
2. **Vars and secrets.** `npm run check:config` holds each environment to 64 vars and secrets together (ADR 0009, rule 6). A secret the switched-on providers need must be set before the release (step 7): the Worker refuses to start without it, and Cloudflare refuses the upload.
3. **The apps.** The release passes over an app whose surface is off in production, whether or not it has a Worker there: `mm-app-production` was bootstrapped on 22 September 2026, and until 27 September 2026 the release shipped it and its production build refused the copy still owed (`docs/open-points.md`, item 152). An app is shipped from the release that switches its surface on (step 11).
4. **After the release.** Attach the new consumer with `npm run apply-triggers -- --env production` and check it (step 9). Then the contract step ADR 0070 holds back, dropping the old Zoho token tables, may be merged (`docs/migrations.md`).

## The CI runner

Where GitHub Actions jobs run is the repository variable `CI_RUNNER`. **Since 2 October 2026 it is `github`** (`gh variable list` shows it): every job runs on GitHub's own runners, and the repository is public, so the minutes are free and the jobs run side by side. Every push to a pull request runs the full suite: the static checks, the unit and contract tests with coverage, the build, every browser-test project and Lighthouse, the deployed code on new migrations and the local smoke. A check that already passed on the same files is not run again (docs/decisions/0006-deployment-pipeline.md, "Checks are not repeated"), and adding a label starts no run.

**The owner's machine is retired.** Its runner, `maneman-runner` (`maneman-pc`, built from `ops/runner/`), was shut down on 2 October 2026. Never set `CI_RUNNER` to `maneman` while the repository is public: a fork's pull request would run its own code on that machine. The rest of this section is for bringing it back on a private repository: the machine must be on, with Docker Desktop running.

- **Check them:** `docker logs --tail 5 maneman-runner` (and `maneman-runner-2`) ends "Listening for Jobs", and GitHub → the repository → Settings → Actions → Runners lists `maneman-pc` and `maneman-pc-2` as Idle or Active.
- **Set it up again** (a new machine, or after removing it). Build the image, take a registration token (it lasts an hour), and start the container once with it; the registration is kept in the `maneman-runner` volume. Then start it again without the token, so the token is not left in the container's settings:

  ```sh
  docker build -t maneman-runner:2.337.0 ops/runner
  token=$(gh api -X POST repos/techadmin-maneman/web/actions/runners/registration-token -q .token)
  docker run -d --name maneman-runner --restart unless-stopped --shm-size=2g     -v maneman-runner:/home/runner/actions-runner -e REPOSITORY=techadmin-maneman/web -e RUNNER_TOKEN="$token"     maneman-runner:2.337.0
  docker rm -f maneman-runner   # once the logs say "Listening for Jobs"
  docker run -d --name maneman-runner --restart unless-stopped --shm-size=2g     -v maneman-runner:/home/runner/actions-runner -e REPOSITORY=techadmin-maneman/web maneman-runner:2.337.0
  ```

- **A second runner** is the same, with its own name and volume. `RUNNER_NAME` is what GitHub lists it as; without it the entrypoint registers `maneman-pc`, and `--replace` would take the first one's place instead of joining it:

  ```sh
  token=$(gh api -X POST repos/techadmin-maneman/web/actions/runners/registration-token -q .token)
  docker run -d --name maneman-runner-2 --restart unless-stopped --shm-size=2g     -v maneman-runner-2:/home/runner/actions-runner -e REPOSITORY=techadmin-maneman/web     -e RUNNER_NAME=maneman-pc-2 -e RUNNER_TOKEN="$token" maneman-runner:2.337.0
  docker rm -f maneman-runner-2   # once the logs say "Listening for Jobs"
  docker run -d --name maneman-runner-2 --restart unless-stopped --shm-size=2g     -v maneman-runner-2:/home/runner/actions-runner -e REPOSITORY=techadmin-maneman/web     -e RUNNER_NAME=maneman-pc-2 maneman-runner:2.337.0
  ```

- **One fewer runner:** `docker rm -f maneman-runner-2`, then remove it in Settings → Actions → Runners. Nothing in the workflows names a particular runner, only the `maneman` label they share.

- **Move the jobs back to the machine** (a private repository only): check the runner is listening (above), then `gh variable set CI_RUNNER --body maneman`. `gh variable set CI_RUNNER --body github` sends them to GitHub's runners again.
- **After a new runner release,** the agent updates itself; the image's pinned version only matters for a fresh set-up.

## Staying on the free tier

The rules are in `docs/decisions/0009-stay-inside-cloudflare-free-tier.md`. The account is on Workers Free, where everything except R2 stops at its limit instead of billing.

Once, in the Cloudflare dashboard:

1. Billing → Budget alerts: create an alert at the lowest amount offered. Any usage-based charge then emails the billing address.
2. Notifications → Add → Usage-based billing: one notification each for R2 storage (5 GB), R2 Class A operations (500,000) and R2 Class B operations (5,000,000). That is half of each monthly allowance.
3. Billing → Subscriptions should list only free plans. Never upgrade Workers to Paid without a new ADR.

Cloudflare is not the only card now. The owner's own card is on Google Maps Platform for the address search, and Google bills past its free allowance rather than stopping. Its quotas and its kill switch are section 13, and its ceiling is `GEOCODE_DAILY_CEILING`.

If an R2 alert fires: set `UPLOAD_DAILY_CEILING`, `RENDER_DAILY_CEILING` and `RESULT_READ_DAILY_CEILING` to `"0"` in `wrangler.jsonc` and deploy. New uploads, renders and result reads then answer `busy`. Find the cause before raising them again. `test/node/free-tier-budget.test.ts` refuses any ceiling that could take R2 or Queues past 80% of the free allowance, counting the share set aside for Phase 2 (`docs/decisions/0015-render-pipeline.md`, `docs/decisions/0039-phase-2-budget.md`).

### The daily allowances

Queue operations (10,000 a day), D1 rows read (5 million a day) and D1 rows written (100,000 a day) are the account's, staging and production together, and each starts again at midnight UTC, 05:30 IST. Past one, Cloudflare refuses that work for the rest of the day: past the queue operations every queue send fails, so bookings, payment confirmations, CRM updates and messages stall; past D1's, every query, or every write, fails.

Once an hour, at a quarter past, the cron reads the day's figures from Cloudflare's analytics (`src/scheduled/daily-allowances.ts`). At 70% of one it tells ops once (`daily_allowance:queueOperations`, `daily_allowance:d1RowsRead` or `daily_allowance:d1RowsWritten`), and the alert closes on its own when the next day starts the figures again. It reads them with `CLOUDFLARE_ANALYTICS_TOKEN` (step 7), set in one environment only: `W secret put CLOUDFLARE_ANALYTICS_TOKEN --env staging` until go-live. If the figures cannot be read three hours running it says so (`daily_allowances_unreadable`): the token was deleted, expired or lost its permission. Make a new one as step 7 says and put it in the same way.

When one is told:

1. See what is spending it: the dashboard's D1 and Queues pages, each database's and each queue's Metrics. Staging's names carry `staging`, production's `prod`. For D1's rows, Workers Logs says which work read them: every `request` line carries `d1_rows_read`, `d1_rows_written` and `d1_queries`, as does each cron run's `cron_run` line (with `d1_rows_read_by_job`) and each queue batch's `queue_batch` line. In the Query Builder, sum `d1_rows_read` grouped by `route`.
2. A test run on staging (a load test, a soak, browser tests in a loop) is the usual cause: stop it. A job retrying the same thing again and again shows in Workers Logs as one event repeating; tell the developers.
3. If it is production's own traffic, tell the developers the same day. More of these allowances means Workers Paid, which needs the owner's decision and a new ADR (step 3 above).

### Workers daily limit reached (1027)

Workers requests, 100,000 a day, are the account's too, staging and production together, and every surface spends them: the API on every host, the site's home, `/book` and `/r/*` pages, and the three apps. Past them Cloudflare answers every request a Worker would have served with its own error page, **error 1027**, until midnight UTC, 05:30 IST. Clients cannot book or pay, technicians cannot send their steps, ops cannot use the console, and Razorpay's webhooks are refused (Razorpay retries them for a day, so payments catch up after the reset). Nothing is lost from D1, and nothing in the code can lift it before the reset: the owner ruled on 2 October 2026 to stay on Workers Free (ADR 0009, "Update, 4 October 2026: a flood").

1. **Confirm it.** Cloudflare dashboard → **Workers & Pages** → **Overview** shows the day's requests near 100,000. A page that answers 1027 on one host answers it on all of them.
2. **Find who is spending them.** `maneman.in` → **Security** → **Analytics** (or **Analytics & Logs** → **HTTP Traffic**): group by source IP, then by path and user agent. The rate-limiting rule's blocks (step 15) show there too. A test run on staging is the usual cause, as for the other allowances: stop it.
3. **Block the attacker.** **Security** → **Security rules** → **Create rule** → **Custom rules** (the free plan has five): match the addresses, their AS number or their country, action **Block**. This stops them spending tomorrow's allowance as well. Keep the rule until the traffic has stopped for a day, then delete it.
4. **Many addresses at once** cannot be held off by a rule per address. Lower the rate-limiting rule's **Requests** for the day, and tell the owner: the remaining answer is Workers Paid, which needs the owner's decision and a new ADR.
5. **After the reset,** check the cron ran (the heartbeat, "The outside watchers") and that Razorpay's retried webhooks arrived ("Razorpay's webhook is not arriving").

### R2 storage growing

R2's 10 GB a month is the account's, both environments together, and past it R2 bills. What fills it:

| Bucket                            | What                                                                                                                       | Kept                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `mm-<t>-tryon-uploads`            | Try-on photographs                                                                                                         | Deleted within the hour; the bucket's 30-day rule behind that                                                                    |
| `mm-<t>-tryon-results`            | Try-on results                                                                                                             | `RESULT_RETENTION_DAYS`: 3 on staging, 14 in production; the 30-day rule behind that                                             |
| `mm-<t>-client-photos`            | Visit photographs, ten a visit, each with its thumbnail from the technician app, or copied from FSM without one (ADR 0093) | For good: deleted only by an erasure, which deletes everything under the visit                                                   |
| `mm-<t>-client-photos`, `tryons/` | A try-on photograph's small copy, and a client's kept look (ADR 0084)                                                      | The copy as long as its look; a client's for good, and their look until their first fit is photographed; an erasure deletes both |
| `mm-<t>-referral-cards`           | One card for each referrer who made one                                                                                    | Until its referrer revokes it or is erased                                                                                       |

ADR 0039 gives the photographs and the cards 4 GB. At 250 KB a photograph and 32 KB its thumbnail, which is what the technician app sends, that is about 1,312 visits. A client's kept try-on is paid from the same share, and while its look is kept at full size, the share holds about 444 visits at worst (ADR 0084, ADR 0093). A photograph copied from FSM keeps FSM's size, several MB (open point 125), and spends it faster. One from the technician app is at most 2 MB.

**The storage meter** (ADR 0093) is a running figure of what this environment's `client-photos` and `referral-cards` hold. It tells ops once at 50%, 80% and 100% of the share (the alerts `r2_share:50`, `r2_share:80` and `r2_share:100`), and Settings shows it. **Past the share R2 bills, as the owner accepted** (open point 151): nothing is refused. Past the runaway ceiling, 20 GB, the technician app's uploads answer `503 busy` and wait on the phones, and ops are told (`r2_runaway_ceiling`): something is writing far more than the business makes. Find it before anything else. The usage notifications above, at 5 GB for the account, stay as the backstop.

Each environment's meter counts its own buckets against the whole share, which staging and production share. Staging holds little, but read both on the dashboard before trusting one.

```sql
SELECT ROUND(bytes / 1e9, 2) AS gb, told_percent FROM storage_meter;
```

The figure is the sum of `stored_objects`, a row for each object with its size, kept beside it. It can drift from the bucket: an object written outside the meter's helpers, or a write whose D1 batch failed after R2 took it, is not counted until its key is written again. It started from the rows (migration 0055), with cards, copies and kept looks at their upload limits and without the photographs a retake replaced. The largest objects it counts: `SELECT key, bytes FROM stored_objects ORDER BY bytes DESC LIMIT 20;`. If the figure and the rows disagree, after a correction by hand or a batch that failed half-way, set the figure back to the rows' sum: `UPDATE storage_meter SET bytes = (SELECT COALESCE(SUM(bytes), 0) FROM stored_objects) WHERE id = 1;`.

The bucket sizes on the dashboard's R2 page are what bills, and they read higher than the rows: a photograph a retake replaced before migration 0055 has no row. Setting the figure to the bucket sizes instead (`UPDATE storage_meter SET bytes = <client-photos + referral-cards> WHERE id = 1;`) makes it tell ops at the true share, but the surplus over the rows is never taken off again, since an erasure takes off only what rows hold, so the figure stays that much high for good. Do it only knowing that, and note the surplus and the date where the team keeps such notes. A mark is told once for good; to hear of one again after the figure fell below it, `UPDATE storage_meter SET told_percent = 0 WHERE id = 1;`.

Where it stands: the dashboard's R2 page gives each bucket's size, which is the figure that bills. The photographs the database knows of:

```sql
SELECT COUNT(*) AS photographs, ROUND(SUM(bytes) / 1e9, 2) AS gb, ROUND(AVG(bytes) / 1e3) AS average_kb FROM photos;
SELECT p.id, p.bytes, s.appointment_id FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id ORDER BY p.bytes DESC LIMIT 20;
-- Clients' kept try-ons, and how many of their looks still wait for a first fit (ADR 0084).
SELECT COUNT(*) AS kept_try_ons, SUM(kept_look_key IS NOT NULL) AS looks_waiting FROM tryon_jobs WHERE kept_at IS NOT NULL;
```

A bucket much larger than its rows is holding files nothing points at any more; tell the developers.

If the total nears 8 GB:

1. Stop the try-on as above. Its results then leave over the retention days and give their share back.
2. Never delete a client's photographs to make room: they are the client's record, promised kept. The owner decided on 27 September 2026 to pay for R2 past the free allowance (open point 151; ADR 0093), so the bill is the cost of keeping them.

### D1 growing

Each environment's database may hold 500 MB on Workers Free (ADR 0009). Past it every write fails, the audit entry each ops call writes first among them, so the console, bookings and payments stop together. The `storage_meter` cron job reads its size once an hour, on the half hour, and tells ops once at 50%, 80% and 95% (the alerts `d1_size:50`, `d1_size:80` and `d1_size:95`). Settings shows it beside the R2 meter.

Where it stands: `npx wrangler d1 info maneman-staging --env staging` (or production's) gives the size. What fills it is usually the audit log:

```sql
SELECT COUNT(*) AS entries, MIN(at) AS oldest FROM audit_log;
SELECT action, COUNT(*) AS entries FROM audit_log GROUP BY action ORDER BY entries DESC LIMIT 10;
```

At 50%, tell the developers. Never delete rows by hand to make room: the audit log and the credit ledger refuse it by trigger, and the rest are clients' records and the history of their money. The audit log's retention, two years once counsel confirms it, is what takes rows off it. At 80%, the owner decides between that and Workers Paid, which holds 10 GB a database and needs a new ADR (ADR 0009).

A mark is told once for good; to hear of one again after the database shrank below it, `UPDATE storage_meter SET database_told_percent = 0 WHERE id = 1;`.

---

## Alerts and the cron

Every alert says what went wrong with IDs only, and most link to the place in the ops console to act on it. Most are kept in D1 and told once, then again when they have happened 10, 100 and 1,000 times ("Still happening, 10 times: …"), and closed when what they were about is put right. What is told, and when, is the table in `docs/decisions/0067-alerts-and-silent-failures.md`. Without `ALERT_WEBHOOK_URL` they are logged as `alert` and still kept.

What is still open:

```sql
SELECT key, message, link, count, first_seen_at, last_seen_at FROM alerts WHERE resolved_at IS NULL ORDER BY last_seen_at DESC;
```

A daily alert (Google, Turnstile) and one ops settle by hand (a refund, a kept charge, an FSM erasure) stay open once dealt with. Close one with `UPDATE alerts SET resolved_at = '<now, ISO>' WHERE key = '<key>' AND resolved_at IS NULL;`.

**A cron job keeps failing.** The alert names the job and its last error. Where each job stands:

```sql
SELECT job, failed_runs, last_failed_at, last_error FROM cron_jobs WHERE failed_runs > 0;
```

The other jobs run regardless. A run shares 40 outside calls between its jobs; a job that finds them spent stops and leaves the rest to the next run, and the run logs `cron_calls_spent`. Seen now and then, that is a backlog clearing. Seen on every run, the passes cannot keep up within the free plan.

Some jobs run only where what they need is switched on: FSM's jobs need `FSM_PROVIDER`, the invoices and Books need both FSM and Books, the FSM reconciliation needs the real FSM, and the visit reminders need `MESSAGING_ENABLED` (`src/scheduled/cron.ts`).

**The cron and the queue consumers have stood still for maintenance.** The switch a restore runs under has been on for an hour ("Restoring D1"). Once the restore is done, switch it off; the next run does its jobs, and the queues deliver what they hold. Then close the alert by hand.

### A cron run cut short

Each run notes when it starts and when it finishes (`cron_runs`). A run that finds the one before it never finished alerts once (`cron_run_cut_short`), and the alert closes once runs have finished for an hour. The jobs after where the run stopped did not run that time; the next run does them, so one alert is a blip. Where it stands:

```sql
SELECT started_at, completed_at, failed_jobs, cut_short_at FROM cron_runs;
```

`GET /api/health` shows `cron_completed_at`, the last finished run, for information; its status does not depend on it.

Cloudflare stops a run that uses too much CPU time, and the free plan allows 10 ms an invocation. Every staging deploy reports mm-api's CPU over the last day in its last step, and `node --env-file=.env.cf-read scripts/cpu-report.ts production` reports production's (the token needs Account Analytics: Read). Workers Logs at the run's start time show the last job that logged before it stopped. If runs are cut again and again, tell the developers: the later jobs (invoices, Books, refunds owed, erasures) are not running.

### The outside watchers

Every alert is sent from inside mm-api, so a cron that stops altogether, or an API that is down, tells nobody. Two free monitors outside Cloudflare watch for that:

1. **The cron's heartbeat.** On healthchecks.io, a check for each environment (`mm-api-staging cron`, `mm-api-production cron`): period 5 minutes, grace 10 minutes, and its Google Chat integration on the alert space (or e-mail). Put its ping URL in the environment as `HEARTBEAT_URL` (`W secret put HEARTBEAT_URL --env <env>`). The cron pings it after every run, and pings `/fail` with the failed jobs' names when one failed. No ping for 15 minutes means the cron is not running: check the triggers (step 9), then Workers Logs for the scheduled event.
2. **The API.** Any free uptime monitor checking `https://maneman.in/api/health` every 5 minutes for HTTP 200, telling the owner's e-mail. Production only: staging is behind Access. A 503 means the database is unreachable or not production's, and the answer's `d1` says which.

### What each alert means

The chat shows the message; the `alerts` table keeps it under its key. Most alerts say what to do; this is where each leads. An alert whose "closes" is "by hand" stays open until you close it as above.

| The alert says                                                                           | Key                                                                                                       | Closes                               | See                                                                     |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| The cron's _job_ job has failed _n_ runs in a row                                        | `cron_job:<job>`                                                                                          | when a run works                     | the job's own section; `cron_jobs` above                                |
| The cron run started at _time_ never finished                                            | `cron_run_cut_short`                                                                                      | after an hour of finished runs       | "A cron run cut short"                                                  |
| Cloudflare's free _allowance_ are _n_% used today                                        | `daily_allowance:<allowance>`                                                                             | when a new day starts the figures    | "The daily allowances"                                                  |
| Cloudflare's usage figures could not be read three hours running                         | `daily_allowances_unreadable`                                                                             | when they are read                   | "The daily allowances"                                                  |
| The WhatsApp bridge is not connected                                                     | `whatsapp_bridge`                                                                                         | when it is open                      | "WhatsApp (Evolution) is down"                                          |
| _n_ login codes failed to send in the last hour                                          | `login_codes_failing`                                                                                     | when a code goes                     | "WhatsApp (Evolution) is down"                                          |
| Message _id_ (_kind_) failed after _n_ attempts                                          | none: told for each                                                                                       | not kept                             | "Replaying a failed message"                                            |
| Messages queued over a day ago were never sent, and are now failed                       | `messages_unsent:<date>`                                                                                  | by hand                              | "WhatsApp (Evolution) is down", then "Replaying a failed message"       |
| Lead _id_ did not reach the CRM                                                          | none                                                                                                      | not kept                             | "Replaying failed leads"                                                |
| Erasing person _id_ in the CRM failed                                                    | none                                                                                                      | not kept                             | "Erasure within the day", step 3                                        |
| FSM would not anonymise contact _id_                                                     | `fsm_erasure:<person>`                                                                                    | by hand                              | "Erasure within the day"                                                |
| FSM sync gave up on appointment _id_                                                     | `fsm_sync:<fsm id>`                                                                                       | when it syncs                        | "FSM is down"                                                           |
| FSM reconciliation repaired _n_ appointment(s) tonight                                   | none                                                                                                      | not kept                             | "FSM's webhook has stopped"                                             |
| Lead _id_ did not reach FSM                                                              | none                                                                                                      | not kept                             | "FSM is down"                                                           |
| A technician's _step_ … has waited over an hour to reach FSM                             | `job_event_pending:<job event>`                                                                           | when it is written or given up       | "FSM is down"                                                           |
| A technician's _step_ did not reach FSM after _n_ attempts                               | none                                                                                                      | not kept                             | "FSM is down"                                                           |
| Booking _id_ was paid for … and is neither booked in FSM nor refunded                    | `unbooked_hold:<hold>`                                                                                    | when booked or given back            | "A booking FSM would not take"                                          |
| Booking _id_ could not be written to FSM after _n_ attempts. Nothing is refunded …       | `booking_held:<hold>`                                                                                     | when booked or refunded              | "A booking FSM would not take"                                          |
| Booking _id_ was not written to FSM: visit _id_ … reached FSM after the booking was held | `booking_to_link:<hold>`                                                                                  | when booked or refunded              | "A booking FSM would not take"                                          |
| Booking _id_: an earlier try may have made its work order in FSM                         | `work_order_lookup_failed:<hold>`                                                                         | by hand                              | cancel all but one work order, as it says                               |
| The client moved visit _id_ … and FSM would not cancel its work order                    | `replaced_not_cancelled:<visit>`                                                                          | by hand                              | cancel it in FSM, as it says                                            |
| The refund … for visit _id_, cancelled by the client (or a no-show's), failed            | `cancel_refund_failed:<visit>`, `no_show_refund_failed:<why>:<visit>`                                     | by hand                              | "A refund that failed"                                                  |
| The visit credit for visit _id_, a no-show _why_, could not come back                    | `no_show_credit_not_back:<why>:<visit>`                                                                   | by hand                              | "A credit that could not come back"                                     |
| Invoice _id_ of visit _id_ is held as a draft, or is still a draft                       | `invoice_draft:<visit>`                                                                                   | when the invoice is issued           | "Invoices and Books"                                                    |
| FSM refused to invoice, or the invoice pass has failed                                   | `invoice_refused:<visit>`, `invoice_failed:<visit>`                                                       | when the invoice is issued           | "Invoices and Books"                                                    |
| Books refused, or has failed on, a payment, its application or a refund                  | `books_payment_…`, `books_apply_…`, `books_refund_…` (`_refused:` or `_failed:` and an ID)                | when it goes through                 | "Invoices and Books"                                                    |
| Payment _id_ … has nothing to be set against                                             | `books_unapplied:<payment>`                                                                               | by hand                              | "Invoices and Books"                                                    |
| FSM's catalogue item … and the price book has …                                          | `fsm_catalogue:<kind>`, or `fsm_catalogue:<kind>/<tier>` for a service other than the kind's standard one | when the two agree                   | step 11b, point 8                                                       |
| FSM's catalogue has no item for the service _name_, so its bookings go on item _id_      | `fsm_item_fallback:<kind>/<tier>`                                                                         | when the hourly check finds the item | make the item in FSM, named as the console names the service (ADR 0085) |
| FSM's catalogue does not hold _n_ of the consumables as ours                             | `fsm_catalogue:consumables`                                                                               | when each is linked                  | add or rename each part in FSM at Rs. 0, as it says (ADR 0087)          |
| Stock is low in the central store, or in technician _id_'s kit                           | `low_stock:central`, `low_stock:kit:<technician>`                                                         | when the place is no longer low      | record a delivery or a transfer on the Stock page                       |
| Client _id_'s new number, address or invite did not reach FSM (or the CRM)               | `fsm_contact_update:<person>`, `crm_contact_update:<person>`, `contact_sync:<person>`                     | when a later update goes through     | update the contact or lead by hand, as it says                          |
| The database holds _n_ MB, _p_% of the 500 MB Cloudflare's free plan allows it           | `d1_size:<mark>`                                                                                          | not closed; told once a mark         | "D1 growing"                                                            |
| AILabTools credits are down to _n_                                                       | `ailab_credits_low`                                                                                       | when topped up                       | "Credits are low"                                                       |
| Try-on job _id_ failed, or its result was billed but never downloaded                    | none                                                                                                      | not kept                             | "Try-on and WhatsApp"                                                   |
| The daily _name_ ceiling is reached                                                      | none: told once a day                                                                                     | not kept                             | "A ceiling was reached"; section 13 for geocode                         |
| Google refused the address search                                                        | `google_refused:<date>`                                                                                   | by hand                              | section 13                                                              |
| Turnstile could not check _n_ visitors                                                   | `turnstile_unavailable:<date>`                                                                            | by hand                              | Cloudflare's status, and `TURNSTILE_SECRET`                             |
| _n_ account deletion request(s) have waited 5 days                                       | none                                                                                                      | not kept                             | the console's Deletion requests                                         |
| A client raised grievance _id_                                                           | none                                                                                                      | not kept                             | the console's Grievances                                                |

---

## Leads and Zoho

### Checking the booking path on staging

Actions → **staging-lead** → Run workflow, with a pincode staging serves and a window. It books a test consultation through the site's form, `POST /api/consultation` (`scripts/staging-lead.ts`), on the last day the form offers. The name is "Staging test", the mobile number is random, and the address is made up. Within a minute the lead should be in the real Zoho org (ADR 0050), with the day booked, and the consultation in FSM as a work order and an appointment, each "Staging test: Consultation for Staging test": staging shares the owner's org, and its records are the owner's to clear before go-live (`docs/open-points.md`, item 19). Cancel the appointment in FSM once it is seen, so no technician keeps it. A `409` means the window has gone: run it again with another. In D1:

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
2. `W secret put ZOHO_REFRESH_TOKEN --env <env>` (`ZOHO_FSM_REFRESH_TOKEN` for FSM, `ZOHO_BOOKS_REFRESH_TOKEN` for Books).
3. Drop the cached access token: `DELETE FROM zoho_access_tokens WHERE client = 'crm';` (`'fsm'` for FSM, `'books'` for Books).
4. The sweeper delivers the waiting leads within five minutes. Replay any that already gave up.

### Zoho refused a new token ("Access Denied")

Symptoms: calls fail with `Zoho 400 Access Denied: could not refresh the access token`, then with `TOKEN_COOLING_DOWN`. One refresh token mints at most 10 access tokens in 10 minutes, and staging and production share the CRM's (ADR 0050). After Zoho refuses one, nothing asks for another for ten minutes (`zoho_access_tokens.cool_down_until`), and every Zoho call fails at once meanwhile; the queues and the passes try again afterwards on their own. Find what minted the tokens, usually a script run by hand against the same client, and stop it. Do not clear `cool_down_until` to hurry it: asking again inside the ten minutes extends Zoho's refusal.

### Replaying failed leads

```sql
UPDATE leads SET sync_attempts = 0 WHERE sync_state = 'failed';
```

The sweeper picks them up within five minutes. A replay never duplicates a Zoho record: the sync looks the person up by `D1_Person_ID` first, and Zoho refuses a second record with the same `D1_Person_ID`.

---

## FSM and Books

FSM is the record of field work; D1 keeps a mirror of its appointments (ADR 0032). Everything mm-api writes to FSM goes through the fsm-sync queue, which tries each write five times, 30 seconds, 1, 2 and 4 minutes apart: about eight minutes, then it gives up, but for a booking, which is held for ops (ADR 0095). Books is written by the cron, once an hour for each record. Production has both switched off today (`FSM_PROVIDER` and `BOOKS_PROVIDER` are `none`).

### FSM is down

Symptoms: `fsm_sync_failed`, `booking_failed` and `job_event_write_failed` in Workers Logs with FSM's status (a 5xx, a timeout), then the alerts below, and `cron_job:fsm_reconcile` once the reconciliation has failed three runs. If calls fail with `Access Denied` or `TOKEN_COOLING_DOWN`, it is the token rather than FSM: "Zoho refused a new token", above, with `'fsm'` for the client. What follows is the same either way.

What happens while it lasts, each once its eight minutes are spent:

- **A booking** is held: it keeps its slot and its payment, nothing is refunded, ops are told once (`booking_held`, "A booking FSM would not take"), and the cron tries it again every hour for 24 hours. So every booking made during the outage waits, holding its slot, and is booked by the first try after FSM answers. For an outage longer than a day, stop taking them: set `SELF_SERVE_BOOKING` to `"false"` in `wrangler.jsonc` and deploy, and the app says booking goes through ops.
- **A technician's step** is marked `rejected`, with every later step of the same job held back behind it, and ops are told to enter them in FSM by hand. (A step whose queue message was lost is a different thing: the sweeper sends it again after 15 minutes, and tells ops once if it has waited an hour, `job_event_pending`.)
- **A lead from the site** is told to ops, to enter in FSM by hand.
- **The mirror** stays as FSM last answered. FSM's webhook hints fail too, and a hint given up on is told (`fsm_sync`); the reconciliation catches up afterwards.
- **Invoices and Books** wait: each visit or payment is tried again an hour later.

Once FSM answers again:

1. **Bookings held** are booked by the next hourly try. Those past their 24 hours, or whose visit's time came while FSM was down, wait on the Tasks board's "Booking not in FSM": try FSM again from the client's Visits tab, or, for a visit whose time has passed, agree another time with the client, book it in FSM and link it there, or refund it.
2. **Technicians' steps** rejected because FSM could not be reached can be sent again instead of typed in. List them:

   ```sql
   SELECT id, appointment_id, kind, fsm_error, received_at FROM job_events
   WHERE fsm_write_state = 'rejected' AND received_at > '<the outage began, ISO>' ORDER BY appointment_id, received_at;
   ```

   Where the first of each job's errors is FSM's unavailability (a 5xx, a timeout, `TOKEN_COOLING_DOWN`), those after it say "the … before it did not reach FSM", and ops have not entered them by hand already, put them back:

   ```sql
   UPDATE job_events SET fsm_write_state = 'pending', fsm_error = NULL, updated_at = '2000-01-01T00:00:00Z'
   WHERE fsm_write_state = 'rejected' AND received_at > '<the outage began, ISO>';
   ```

   The sweeper sends each job's earliest step at its next run, and each step written sends the next. Sending one again sets FSM's fields to the same values, and finds photographs and pieces already attached rather than adding them (ADR 0070). A step FSM refused, with a 4xx, is entered in FSM by hand instead.

3. **Leads** that did not reach FSM go again if they are under a day old: `UPDATE leads SET fsm_queued_at = NULL WHERE id = '<lead id>';`, and the sweeper sends each within five minutes. An older one, enter by hand.

### FSM's webhook has stopped

FSM calls `POST /api/hooks/fsm/<token>` for each appointment created, edited or deleted (step 11b, point 6). Without it the mirror still follows FSM, only more slowly: every cron run reads the 50 latest changes, two upcoming visits are read again each run, and the whole list is read between 1 and 5 am India time. That night's pass then alerts "FSM reconciliation repaired _n_ appointment(s) tonight that the webhook missed or FSM deleted". An occasional repair is FSM missing a call; one every night, or no hint for hours while FSM is busy, is the webhook.

```sql
SELECT COUNT(*) AS hints, MAX(received_at) AS last FROM webhook_inbox WHERE source = 'fsm';
SELECT record_id, attempts, last_error, received_at FROM webhook_inbox WHERE processed_at IS NULL ORDER BY received_at DESC LIMIT 20;
```

In Workers Logs:

- `fsm_hook_unauthorized`: the token in FSM's webhook URL is not `FSM_WEBHOOK_TOKEN`.
- `fsm_hook_unreadable` or `fsm_hook_ignored`: the webhook's parameters are not the three step 11b names.
- Nothing at all: FSM is not calling. Its workflow rule may be off, or, on staging, Access is stopping `/api/hooks/` (step 12, point 3). If `FSM_WEBHOOK_TOKEN` is not set, the route answers 404.
- Hints taken but `last_error` filled: they reached us and reading the appointment failed; "FSM is down".

### A booking FSM would not take

A booking is written to FSM from the queue once Razorpay says the client paid, or at once for a free one (ADR 0068). FSM's fifth refusal running holds it for ops rather than refunding it (ADR 0095): its slot and its payment are kept, and the cron tries it again every hour for 24 hours, as often and as long as Settings · Rules says ("Trying again a booking FSM refused"). Three alerts follow a booking FSM will not take:

- **"… is neither booked in FSM nor refunded half an hour on"** (`unbooked_hold`): the queue lost it, and the cron has put it back. Nothing to do; if FSM still refuses it, the next alert follows.
- **"Booking _id_ could not be written to FSM after _n_ attempts. Nothing is refunded …"** (`booking_held`), once. It gives FSM's reason and links to the client's Visits tab, where the booking heads the page until it is booked or refunded; the Tasks board lists it as "Booking not in FSM".
- **"Booking _id_ was not written to FSM: visit _id_ … reached FSM after the booking was held"** (`booking_to_link`), once. A try found a visit of the client's, of the booking's kind, that came into FSM after the booking was held and is no booking's, most likely one you booked by hand, and wrote nothing. If it is this booking's, link it (below); if not, refund the booking. Nothing more is written to FSM for the booking while that visit stands.

Read FSM's reason first. A 5xx, a timeout, `Access Denied` or `TOKEN_COOLING_DOWN` is FSM or its token being down ("FSM is down"): the hourly tries book it once FSM answers, so wait. A 4xx about the booking itself (`INVALID_DATA`, `MANDATORY_NOT_FOUND`) will not pass on a try: put what FSM names right (the service's item, the client's contact), then use **Try FSM again**, or book it by hand. From the client's Visits tab:

- **Try FSM again** tries now, as the hourly try would, and says whether FSM took it, or that a visit to link stands. It is not offered once the visit's time has passed.
- **To book it by hand**, press **Stop trying — I'll book it in FSM** first, so that no hourly try books a second visit while you do. The booking keeps its slot and its payment, and is no longer tried by itself. Then book the visit in FSM's own screens, at the booked time or another agreed with the client, wait a minute for it to reach the console (reload the page), press **Link the visit I booked in FSM** and choose it. The booking becomes that visit, with its payment, and the client gets the booking's message. A work order an earlier try left for the booking is cancelled in FSM; if FSM would not cancel it, the answer says to cancel it by hand. Only a visit booked in FSM since the client paid can be linked, and never the visit a move replaces.
- **Refund it** cancels what FSM holds for the booking, refunds the payment in full, lets the slot go and tells the client on WhatsApp. The answer says what happened to each:

  | The answer says                                           | Do                                                                                                                                                                      |
  | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Refunded … in full                                        | Nothing                                                                                                                                                                 |
  | Razorpay payment … was refunded before                    | Nothing if you refunded it in Razorpay's dashboard; else check there that it went back in full                                                                          |
  | Nothing was paid for it                                   | Nothing: a free or credit booking; the credit was never spent                                                                                                           |
  | A try booked it in FSM meanwhile                          | Nothing is refunded: check the visit in the console                                                                                                                     |
  | Razorpay refused to refund …                              | The booking still waits. Try again later, or refund it once in Razorpay's dashboard and then press **Refund it** here again, so the booking goes and the client is told |
  | FSM would not cancel its work order _id_                  | Cancel it in FSM by hand, so no technician goes                                                                                                                         |
  | FSM may hold a work order for it: look for "(booking … )" | Look in FSM's work orders for "(booking _id_)" and cancel it                                                                                                            |

  Whenever a held booking's payment is refunded in Razorpay's dashboard, press **Refund it** here afterwards. A try or a link would let the booking go too, but without cancelling what FSM holds for it or telling the client.

### Invoices and Books

The cron raises each finished visit's invoice through FSM, which puts it in Books as a draft, and marks it sent once it totals what the client was sold the visit for (ADRs 0056 and 0070). Only then can the client open it. It records each payment and refund in Books and sets a visit's payment against its invoice. Nothing here ever sends a draft that already exists, so a draft ops correct is sent by ops.

- **Held as a draft** (`invoice_draft`), the alert says why. The price differs: correct the draft in Books and send it there, and set FSM's catalogue price right (step 11b, point 8). Nothing says what the visit was sold for: check the draft and send it. Paid with a referral credit: leave it until the CA rules (open point 14). Books would not take a discount code's discount: set the discount the alert names on the visit's line, before tax, and send it there (step 11b, point 9).
- **Still a draft an hour after the visit, or Books would not mark it sent** (`invoice_draft`, and `invoice_not_issued` in the logs): send it in Books. Within the hour the pass sees it sent, the client can open it, and the alert closes.
- **FSM refused to invoice** (`invoice_refused`): raise it in FSM by hand, then send it in Books; the pass finds it, since FSM gives a work order one invoice however often it is asked.
- **Books refused a payment, its application or a refund** (`books_…_refused`): the message says what; put it right in Books. It is asked again every hour, and the alert closes when it goes through. `books_…_failed` is Books failing three times in some other way, usually Books being down; nothing to do.
- **Nothing to set a payment against** (`books_unapplied`): it stays in Books as the client's credit. Settle it by hand in Books; how a kept charge is invoiced waits for the CA (open point 16).
- Refunds are recorded in Books only while `BOOKS_REFUND_ACCOUNT_ID` is set (step 11b, point 7).

The console's Tasks board lists every draft invoice. From SQL:

```sql
SELECT id, window_end, fsm_invoice_id, invoice_checked_at FROM appointments
WHERE status = 'completed' AND invoice_issued_at IS NULL AND deleted_at IS NULL ORDER BY window_end;
SELECT id, razorpay_payment_id, captured_at FROM payments WHERE captured_at IS NOT NULL AND books_payment_id IS NULL;
SELECT id, razorpay_refund_id, created_at FROM refunds WHERE status = 'processed' AND books_refund_id IS NULL;
```

### Staging's records in the org

Staging writes to the owner's real FSM and Books (open point 19), and production's reconciliation and invoice pass will read the same org (open point 155), so staging's records go before production connects FSM. The script lists them, the owner reviews the list, and a second run deletes what the owner kept in it. It uses the scripts' own token (step 8.7).

1. List them: `node --env-file=.env.fsm-scripts scripts/staging-records.ts`. It prints every FSM appointment, work order and Request whose summary starts "Staging test: ", and every FSM and Books contact named "Staging test" or "Load test"; and every Books payment whose description starts "Staging test: ", with its refunds, and every Books invoice of a staging contact. It writes them to `private/staging-records-<date>.json`, and names apart any record that looks like a test but carries neither mark, which it never deletes.
2. The owner reads the list. To keep a record, take its entry out of the file.
3. Delete: `node --env-file=.env.fsm-scripts scripts/staging-records.ts --delete private/staging-records-<date>.json`. It reads the org again and deletes only what the file keeps and the org still marks as staging's, what points at a record before it: Books' refunds and payments, FSM's appointments, Books' invoices, FSM's work orders and Requests, then the contacts. Each line says `deleted`, `already gone` or `refused` with FSM's or Books' reason.
4. A refusal is usually a record another still points at: run the delete again, and anything freed by the first run goes. What stays refused is put right by hand in FSM or Books.

FSM's API deletes no invoice, so the list names FSM's invoices of staging's work orders apart: delete them in FSM's Invoices screen, if it still shows them, once the run has deleted their work orders and Books' invoices. On 1 October 2026 it showed none: FSM's API went on listing the three invoices as links of no work order, which neither FSM's screens nor anything of ours reads. Nothing of production reads them, since its invoice pass reads each of its own work orders' invoice.

FSM keeps a deleted record in its recycle bin, out of every list the API gives, so production's reconciliation never sees it.

---

## Razorpay

Razorpay is the record of money. We learn of each payment and refund only from its webhook (ADR 0044): nothing reads them from Razorpay afterwards. Production has it switched off today (`PAYMENTS_PROVIDER` is `none`).

### Razorpay's webhook is not arriving

Symptoms: clients pay, their booking sheet never confirms, and the hold runs out; Razorpay's dashboard shows the payments captured, and D1 has not heard of them.

```sql
SELECT event, COUNT(*) AS events, MAX(received_at) AS last FROM razorpay_events GROUP BY event;
SELECT id, person_id, razorpay_order_id, created_at FROM slot_holds
WHERE razorpay_order_id IS NOT NULL AND confirmed_at IS NULL AND created_at > '<since, ISO>' ORDER BY created_at;
```

The second lists the holds whose Checkout opened and whose payment we never heard of. Look each order ID up in Razorpay's dashboard to see whether it was paid.

The cause, from Workers Logs:

- the route answers 404: `RAZORPAY_WEBHOOK_SECRET` is not set on the Worker (step 11c, point 2);
- `razorpay_hook_unauthorized`: the secret in Razorpay's webhook is not the Worker's;
- nothing at all: Razorpay is not calling. The webhook is disabled (Razorpay disables one that has failed for 24 hours, and e-mails the account), its URL is wrong, it is set up in the other mode from the keys (test or live), or, on staging, Access is stopping `/api/hooks/` (step 12, point 3);
- `razorpay_hook_refund_early`, answered 409: a refund came before its payment. Razorpay sends it again; nothing is wrong.

Put the cause right, and re-enable the webhook in Razorpay's dashboard if it was disabled. Razorpay retries a delivery that failed for 24 hours. A capture that arrives late is judged by Razorpay's own time: paid within the hold's ten minutes and its two minutes' grace, the visit is booked; if the time has gone to another client meanwhile, the payment is refunded in full (ADR 0068).

For a payment whose delivery Razorpay will not send again (past its 24 hours, or while the webhook was disabled), refund it in Razorpay's dashboard and ask the client to book again. That refund's own webhook is then answered 409, since its payment was never recorded; that is expected.

### A refund that failed

"The refund of Rs. _n_ for visit _id_ … failed" (`cancel_refund_failed` for a client's cancel, `no_show_refund_failed` for a waived no-show). Nothing tries it again. In Razorpay's dashboard, find the payment the alert names, check it shows no refund of that amount, refund it once, and close the alert. The refund's webhook records it, and the client's Payments tab shows it.

---

## Try-on and WhatsApp

The render consumer is the only caller of AILabTools and the messaging consumer the only caller of WhatsApp (`docs/decisions/0015-render-pipeline.md`), but for login codes: those go straight to the provider once the response has gone (ADR 0030), and only the Worker's log records them, as `login_code_sent`, `login_code_not_sent` with its reason, or `login_code_failed`. D1 records where every job and message stands:

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

The sweeper reads the balance once an hour and alerts once when it is below `AILAB_CREDIT_FLOOR`, not every hour; a top-up that lifts it over the floor closes the alert. Top up in the AILabTools dashboard. At zero, every render fails.

### A ceiling was reached

The alert names the ceiling (`upload`, `render` or `result_read`). Try-ons answer `503 busy` until midnight IST, and the alert fires at most once a day per ceiling. The result-read ceiling also counts a client opening their try-on's photograph or look in the app (ADR 0082), so past it the app's Photos tab shows those two as blank blocks until midnight.

- If the traffic is real, raise the ceiling in `wrangler.jsonc` and deploy. The free-tier budget test refuses any value that could take the account past 80% of a free allowance.
- If the traffic is abuse, leave the ceiling: it is doing its job.

### A billed image was lost

Alert: "its result was billed but never downloaded, and its URL has expired". The download was retried for 24 hours. The customer's job is `failed`, and nothing can recover the image. Check whether the result host (`ailab-outputs.oss-accelerate.aliyuncs.com`) is reachable at all.

### WhatsApp (Evolution) is down

Symptoms: every login code goes through the bridge, so clients and technicians cannot sign in. Two alerts say so: the cron reads the bridge's connection state every five minutes and alerts when two readings in a row find it closed, naming what to check, and login codes alert when three fail to send in an hour. Both close once it works again.

Messages wait out the bridge. While it has no instance by our name (`HTTP 404`), refuses our key (`HTTP 401` or `403`) or has lost its WhatsApp session (`Connection Closed`), a message stays `queued` with the reason in `last_error`, and the sweeper sends it within five minutes of the bridge reading open again. One still unsent a day after it was queued is failed, and one alert a day counts them. A day-before reminder whose visit day has come, or an arrival notice more than ten minutes old, is skipped rather than sent late. An unreachable bridge or an `HTTP 5xx` is tried four times, then the message fails and an alert names it. A message that failed with `delivery unconfirmed` is different: the bridge did not answer in time (20 s for a text, 60 s for an image), and the message may have arrived. It is never retried automatically.

Whoever is signed in stays signed in: a client's or a technician's session lasts 90 days from its last use, and only a new sign-in needs a code. There is no other way in. SMS is off until a DLT-registered provider exists (open point 37), and the fixed code `dev:all` uses is refused anywhere but a laptop. So ask technicians not to sign out while it lasts.

1. Check the bridge. `GET {EVOLUTION_API_URL}/instance/connectionState/{EVOLUTION_INSTANCE_NAME}` with the `apikey` header should say `"state": "open"`.
2. **`HTTP 404`: the bridge has no instance by that name.** List the ones it has: `GET {EVOLUTION_API_URL}/instance/fetchInstances` with the same header. If ours is there under another name, set `EVOLUTION_INSTANCE_NAME` to it. If the list is another app's, `EVOLUTION_API_URL` reaches the wrong bridge: check its host and port (staging's ends in `:8443`). Set either with `W secret put … --env <env>`; a secret change is live at once. **Never create an instance on the shared bridge** to clear the alert: the bridge serves another app too, and an instance made through the wrong URL lands among that app's. If ours is really gone, the owner, who runs the bridge, restores it.
3. **`HTTP 401` or `403`: the bridge refuses the key.** Set `EVOLUTION_API_KEY` to the bridge's key for our instance.
4. **`state close` or `connecting`: the WhatsApp session dropped.** Reconnect it in the bridge (scan the QR code again). If WhatsApp will not take the number back, see the next section.
5. Messages that waited go by themselves once it is open. Replay only those that failed (below).

**`MESSAGING_ENABLED`.** Set to `"false"` in `wrangler.jsonc` and deployed, it stops every message except login codes:

- the try-on's WhatsApp copy, which the gate then stops promising;
- every message about a visit: the booking confirmation, the payment receipt, the reminder the day before, a move, a cancel, the technician's arrival and a no-show ruling. The cron stops queuing reminders at all;
- the referral messages, the waitlist's confirmation and a pincode's launch.

A message queued while it is off is marked `skipped` rather than held, so switching it back on sends none of them. The technician's arrival message is a no-show's evidence (ADR 0047): with messaging off, a no-show has no delivery receipt to show. Login codes still go, as nobody could sign in otherwise; only stopping the bridge stops them. Production has messaging off today.

### The WhatsApp number is banned

The bridge drives an ordinary WhatsApp account, and WhatsApp can ban a number for sending automatically (ADR 0016). The bridge's connection then closes and will not open again with that number: the alerts are the ones above, and scanning the QR code fails, or WhatsApp on that phone says the number is banned.

1. Nobody who is signed out can sign in (above). Tell ops, and ask technicians to stay signed in.
2. Connect the bridge's instance to another WhatsApp number, by its QR code. The instance keeps its name and key, so the Worker's secrets stay as they are. If a new instance is made instead, set `EVOLUTION_INSTANCE_NAME`, and `EVOLUTION_API_KEY` if it has its own, with `W secret put` (a secret change is live at once), and point its receipts' webhook at us (step 12).
3. Clients now hear from another number. The number the site and the apps ask clients to write to is `WHATSAPP_NUMBER` in `packages/web-kit/whatsapp.ts`; if that number is the banned one, change it and release the site and the apps.
4. Replay the messages that failed (below).

The lasting answers are a number of Mane Man's own (open point 38) and SMS (open point 37).

### Replaying a failed message

```sql
UPDATE outbound_messages
SET state = 'queued', attempts = 0, sending_at = NULL,
  queued_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE state = 'failed' AND created_at > '<since, e.g. 2026-09-21>'
  AND last_error NOT LIKE '%delivery unconfirmed%';
```

The sweeper sends them within five minutes, once the bridge reads open. `queued_at` is set ten minutes back so the next run takes them; set it further back than a day and the sweeper fails them again unsent. Every attempt mints a fresh link, so an old failure is not a problem, as long as the result has not been deleted. A reminder whose visit day has come, or an arrival notice past its ten minutes, is skipped rather than sent. Replay a `delivery unconfirmed` message only once you know it did not arrive; otherwise the person gets it twice.

### Stuck jobs

The sweeper re-enqueues renders whose queue message was lost, and fails a submit that died part-way after 10 minutes, because submitting again could bill twice. Nothing to do by hand.

---

## The technician app

A technician signs in on his phone with his number and a WhatsApp code; the session is bound to that phone, which ops can revoke (ADRs 0052 and 0053). The phone keeps today's and tomorrow's jobs, and every step he takes waits in its outbox until it reaches us.

### A technician's lost phone

1. **Revoke it.** In the ops console, Technicians, under Phones: each phone he has signed in on, and when it was last used. Revoke the lost one; its session ends at once. A technician who installed the app on an iPhone has two rows for one handset, the browser's copy and the installed app's (ADR 0053): revoke both.
2. **What it still holds.** The phone keeps its jobs until it next reaches us: each client's name, number, address and gate code, and any photographs and steps not yet sent. At its next contact it wipes all of it, and `technician_devices.wiped_at` records that it has. A phone that never comes back online keeps it, and that is personal data on a lost device: follow "A personal data breach" to judge it.
3. **What was only on the phone** is lost with it. Ops enter in FSM by hand what the technician did that did not reach us; what did reach us is in `job_events` ("Work stuck on a technician's phone", below).
4. **A new phone.** He signs in on it with his number, and it enrols itself. If the number went with the phone, change it in FSM: a number we do not know is looked up in FSM at sign-in.

```sql
SELECT d.device_id, d.label, d.last_seen_at, d.revoked_at, d.wiped_at
FROM technician_devices d JOIN technicians t ON t.id = d.technician_id
WHERE t.name LIKE '%<name>%' ORDER BY d.last_seen_at DESC;
```

### Work stuck on a technician's phone

The app sends the outbox one step at a time, oldest first, whenever it has signal and whenever it comes to the front. Its "Waiting to reach us" screen (`/waiting`) lists, for each job, the photo sets and steps still on the phone, since when, and what stopped the job's queue.

- **No signal.** Nothing is wrong. Get to signal and open the app. The app warns when the phone has not promised to keep its store: an iPhone keeps it only with the app on its home screen (ADR 0053), so a technician on an iPhone should not leave work waiting for days.
- **A job stopped because it changed** ("This job changed while the phone was offline", "Ops moved this job to another time", "Ops moved this job to Sameer at 10:40 am", "This job is someone else's now", "This job was cancelled…"): ops changed the job, and what is left of it cannot reach us from this phone. Agree with the technician what he did; ops enter it in FSM by hand; then he taps "Got it", which asks first and deletes that job's queue from the phone.
- **A step refused** ("The piece's label was not accepted", and the like): "Correct it" takes him back to the step.
- **Photographs failed**: "Retry".
- **Never sign out or delete the app while work is waiting**: signing out wipes the phone. The app asks first, and offers "Send first".

A step that reached us and not FSM is on the server side: "FSM is down". What reached us for a visit:

```sql
SELECT kind, occurred_at, received_at, fsm_write_state, fsm_error FROM job_events
WHERE appointment_id = '<visit id>' ORDER BY received_at;
```

---

## Locked out of the ops console

The console is behind Cloudflare Access in both environments, and mm-api checks the Access token again on every call (ADR 0031).

- **Access will not let a person in.** Zero Trust → Access → Applications → the console's application (`ops.maneman.in`, `ops-staging.maneman.in`) → Policies: their e-mail must be in the Allow policy, and the login method they use must be switched on (Settings → Authentication). A change takes effect within a minute. It needs someone who can sign in to the Cloudflare account; if nobody can, that is Cloudflare's account recovery.
- **The console opens, and every call fails with "access required"** (403). mm-api refused the token; Workers Logs say why, as `access_refused` with a reason:
  - `wrong_audience`: the application's audience tag is not `ACCESS_OPS_AUD` in `wrangler.jsonc`. The tag changes when the application is deleted and made again: copy the new one (step 11, point 3) and deploy.
  - `wrong_issuer`: `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc` is not the team's domain, the `….cloudflareaccess.com` that Zero Trust's settings show.
  - `missing`: the call reached mm-api without Access, so the host has no Access application: add it (step 11, point 2).
  - `expired`: sign in again.
- **Every call answers 503**, with `access_keys_unavailable` in the logs: mm-api could not fetch Access's signing keys. That is on Cloudflare's side, and each call tries again.
- **The deploys' smoke tests stop getting through** to the Phase 2 hosts: the CI service token has expired or left a policy. Make a new one (step 3) and store it (step 6).

While ops are locked out, nothing in the console can be done by SQL without losing its audit: every decision in the console is written to `audit_log` under the person who made it. Wait unless a deadline forces it (a deletion request's seven days, a refund); if it does, note what was done, when and to which rows in the alert space.

---

## Erasure within the day

The photo notice promises that a person's data is deleted the same day they ask. Whoever takes the request erases it before the end of that day. What is erased, and what is not, is in `docs/decisions/0019-erasure.md`, `0049-dpdp.md` and `0066-erasure-all-or-nothing.md`. A request a client makes from their app is decided in the ops console's Deletion requests, which refuses for the same reasons as step 2 below and says which.

1. **Check the request comes from the number's owner.** Reply to that number on WhatsApp, or call it.
2. **Erase.** With the environment's secret in a git-ignored file, `.env.erasure-production`, holding `ERASURE_SECRET="…"` (for staging, also `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`):

   ```sh
   node --env-file=.env.erasure-production scripts/erase-person.ts --environment production
   ```

   The script asks for the number and for a confirmation, then prints the person's ID and what it deleted: photos, results, and messages not yet sent. It keeps the number out of shell history. Without the script, the call is `POST /api/erasure` with `Authorization: Bearer <ERASURE_SECRET>` and the body `{ "mobile": "98100 00000" }`.

   **A visit booked, or a payment held.** The erasure is refused (`409`, `visit_booked` or `payment_held`) while the person has a visit still to happen, or a payment we captured with no visit behind it, and nothing is erased (`docs/decisions/0066-erasure-all-or-nothing.md`). The script lists each visit and payment. Cancel the visits in FSM and refund the payments in Razorpay, wait for the mirror to show them (a few minutes), then run it again. If they cannot be settled today, run it with `--override-open-bookings` (in the body, `"override_open_bookings": true`): the person is erased anyway, the Worker logs `erasure_override` with the counts, and the visits and payments must still be cancelled and refunded by hand the same day. A refund needs none of the person's details.

   The files (photos, results, visit photographs, the referral card) are deleted just after the rest. If R2 fails, the person is erased all the same and the cron finishes the files within five minutes; `files_erased_at` on the person is set once they are gone.

3. **Check Zoho within a few minutes.** The crm-sync queue blanks the record: the last name becomes "Erased", mobile and e-mail are emptied, and Contact Consent is unticked.

   ```sql
   SELECT erased_at, crm_erased_at, crm_erasure_attempts, crm_erasure_error FROM people WHERE id = '<person_id>';
   ```

   If `crm_erased_at` stays empty, `crm_erasure_error` says why. The sweeper tries 10 times, then alerts. To finish it by hand, find the record in Zoho by `D1_Person_ID` and blank those fields. Then run `UPDATE people SET crm_erased_at = '<now, ISO>' WHERE id = '<person_id>';`.

4. **Delete the chat** with the number in the Mane Man WhatsApp account, if there is one.
5. **Tell the person** it is done.

`404` means no one has that number, or the person was erased already; check the number for typos. Someone who used the try-on but never passed the gate never gave a number, and their photo is deleted within the hour anyway.

**Zoho's history.** Blanking the fields may leave the old values in the record's timeline. If the person or legal asks for full removal, delete the record in Zoho, then delete it from the recycle bin as well. D1's lead history is unaffected.

**A client's account (Phase 2).** A request from the app waits in the ops console's **Deletion requests**, and is decided there rather than by API. Check it with the client on their own number first, as in step 1 above: the console asks you to confirm you have, and says what the deletion destroys and what it keeps before it will take it. Processing it runs the same erasure, and also:

- deletes their visit photographs from the client-photos bucket;
- deletes their saved addresses;
- anonymises their FSM contact within a few minutes, through the fsm-sync queue (docs/decisions/0049-dpdp.md);
- tells the client on WhatsApp that it is done (`deletion_done_v1`), so step 5 is not needed. It is sent once, straight after the erasure; the log's `deletion_done_failed` means it did not arrive, and with the number gone it cannot be sent again. Delete the chat (step 4) after it.

Rejecting a request sends the client your reason on WhatsApp (`deletion_rejected_v1`), and their app shows it for 30 days, so write it for them to read.

Check FSM as you check Zoho:

```sql
SELECT erased_at, fsm_erased_at, fsm_erasure_attempts FROM people WHERE id = '<person_id>';
```

After 10 failed attempts the sweeper stops asking, ops are alerted with the FSM contact's ID, and the console's Tasks board lists it under "Erasure left in FSM". Anonymise the contact in FSM by hand (name, mobile, phone, e-mail and street blanked, last name "Erased"), then run `UPDATE people SET fsm_erased_at = '<now, ISO>' WHERE id = '<person_id>';`, and the task leaves the board.

A request waiting 5 days alerts ops: process it before its 7 days run out. The console counts the days left against each request. Invoices stay in Books for 8 years, by law.

**A grievance, and a change of number.** Both are answered in the console too: **Grievances** holds what a client has said about the way we use their data, and recording your answer closes it — it messages nobody, so send your answer on WhatsApp yourself first. **Number changes** holds the changes whose codes both numbers have already proven; confirming one is what moves the client onto the new number. Every decision on all three is written to `audit_log` under the Access identity that made it.

---

## The service area and the referral log

**The pincodes we serve** are loaded from `data/pincodes/ncr-pincodes.csv` (docs/decisions/0048-referrals.md). Fill in its `served` and `launch_on` columns, then:

```sh
node scripts/import-pincodes.ts staging --all-served-from 2026-09-22   # staging's placeholder (open point 48)
node scripts/import-pincodes.ts production                             # the file's own columns
```

Run it again whenever the file changes: each pincode's row is replaced, except an area name ops gave it in the console. **The import tells nobody on a waitlist, so it refuses to serve a pincode people are waiting for.** It names each such pincode with how many wait, and writes nothing. Serve those from the console — Growth · Service area, or the waitlist's Mark live — which tells those who asked (ADR 0071), then run the import again: a pincode already served is no launch.

**Launching a pincode** is ops' own, in the console: it says how many are waiting and how many will be told, then marks the pincode served and sends the alerts, ten a minute. Nobody is told twice. Serving a pincode in Growth · Service area is a launch too, and says who it will message before it saves; a pincode already live whose waitlist was never told is told from its row on the waitlist.

**Ops' log of referrals before January** is imported once, from a CSV in git-ignored `private/`:

```sh
node scripts/import-referrals.ts production --file private/referrals-before-january.csv
```

It writes people, codes, attributions and the credits, and can be run again safely. Staging uses the synthetic sample in `data/referrals/`.

---

## A personal data breach

A breach is any unauthorised access to, or loss or disclosure of, personal data we hold. For example:

- a leaked secret or token;
- a bucket or database opened to someone who should not have it;
- a client's photographs or details sent to the wrong person;
- a lost phone signed in to ops.

The DPDP Act and its Rules require us to tell the Data Protection Board and each person affected, without delay, and the Board in detail within 72 hours. **Start the clock when anyone at Mane Man first learns of it.**

1. **Contain, within the hour.**
   - Revoke what leaked:
     - rotate the secret (`W secret put … --env <env>`);
     - revoke the Zoho, Razorpay or Evolution key in its console;
     - sign out the ops user in Cloudflare Access;
     - revoke a technician's phone in the console ("A technician's lost phone");
     - revoke client sessions with `UPDATE sessions SET revoked_at = '<now>' WHERE …`.
   - Close the opening. To shut a host at once, put it behind an Access application that lets in only the founders (step 3): every request to it, `/api/*` included, then needs their login, with no release. Roll back a Worker version if a release caused it (below). Switching a surface off for good is step 11 in reverse, in a release: `ENABLED_SURFACES` in `src/config/environments.ts` and its route in `wrangler.jsonc`.
2. **Keep the evidence.** Save `wrangler tail` output, the audit log rows (`SELECT * FROM audit_log WHERE created_at > …`), and the provider's own logs, to a private folder (`private/`, git-ignored). Never paste personal data into chat or email.
3. **Assess.**
   - What data, whose, how many people, since when.
   - Whether photographs were involved: they are the most sensitive thing we hold.
   - Write down what you know and what you do not.
4. **Notify.**
   - **The Board,** at once in brief, and in full within 72 hours: what happened, when, the data and people affected, the harm likely, what we have done, and who to contact.
   - **Each person affected,** in plain words on WhatsApp or by phone: what happened to their data, what it may mean for them, what we have done, what they can do, and who to contact.
   - **The Grievance Officer** leads both (`docs/open-points.md`, item 51).
5. **Record.** Keep a note of the breach, the timeline, the decisions and the notices, for the Board and for us. Review it within two weeks, and fix what let it happen.

---

## The texts file

Every WhatsApp message and every line of copy still marked PLACEHOLDER go to the owner in one Word file to mark up with tracked changes (`docs/open-points.md`, items 39, 41 and 42):

```sh
npm run texts:export              # writes private/texts-<today>.docx
```

It lists each message by its template name, with the note on when it is sent and what its `{{1}}`, `{{2}}` stand for, and each line of copy by the file and line of its mark, grouped by file. The consent notices are listed at the end and are not for editing there: a notice is replaced by a new version counsel approves, never edited. `private/` is git-ignored.

The owner's wording comes back by hand: find each changed item by its id (`src/config/message-templates.ts` for a message; the file and line for the rest), put the words in, and take the PLACEHOLDER mark off what they approved. A message's text must keep the same `{{n}}` it had, unless the code that fills it changes too.

## Cities and visit days

Where we come is decided by the pincode, which ops open from the console (Growth · Service area, ADR 0061), and serving a pincode tells its waitlist. The `cities` table is Phase 1's: its form offered them, and `POST /api/lead` and `GET /api/cities`, which read it, were removed on 28 September 2026 (`docs/open-points.md`, item 107). A booking's lead still names its pincode's city where it is one of these, and the dispatch board filters by them, so a city is a data change, not a deploy:

```sql
-- Add a city the dispatch board can filter by, after Bengaluru.
INSERT INTO cities (name, served, active, sort) VALUES ('Pune', 1, 1, 80);
-- Take a city off the board's filter. Existing leads keep it.
UPDATE cities SET active = 0 WHERE name = 'Pune';
```

Blackout days are days no visit is offered, in the app or from the site. Ops add and remove them in the console, Settings · Blackout days, with a reason; each change is audited under the Access identity that made it (ADR 0088), and the runbook's SQL is no longer the way. A blackout moves no visit already booked on the day: the screen says how many are, and ops move them on the dispatch board.

---

## Restoring D1

D1 Time Travel can put the database back to any minute in the last seven days (the Workers Free plan's window); `time-travel info` hands out bookmarks older than that, but they are not promised. A restore overwrites the whole database in place, cancels the queries running at the time, and undoes everything written since that minute. D1 is the only record of much of it, and the rest is in systems that will not send it again. So take the smallest repair that will do:

1. **Fix the rows by hand**, when you know what they should hold, from the logs, `audit_log` or the vendors' own records.
2. **Repair from an earlier minute**, when you need what the damaged rows held before: go back, copy the damaged tables, and come straight forward again. Every other table stays as it is now.
3. **Restore the whole database**, only when the database itself is broken: tables dropped, or damage in more places than you can name. Everything since that minute is undone, and you carry back what can be trusted.

The last two need `<T>`: the last good minute, in UTC, e.g. `2026-09-27T10:04:00Z`. `W d1 time-travel info maneman-<env> --env <env> --timestamp <T>` shows its bookmark. Work in `private/restore/`, which git ignores: what goes there holds personal data and the Zoho access tokens, and is deleted when you are done. `W d1 export` prints a link that downloads the whole database for an hour, so its output goes to `/dev/null`, as below, and never into a log or a chat.

Both run the Workers on the earlier database for a minute or two, so:

- **Choose a quiet time**, with no technician at work and nobody likely to be paying: after 10 pm India time.
- **Switch maintenance on first, and off at the end.** While it is on, the cron runs no job and each queue consumer hands its batch back for five minutes, so nothing acts on the earlier database. Left on for an hour, it tells ops. Going back to `<T>` undoes the switch with everything else, so each step that goes back switches it on again at once:

  ```sh
  on="INSERT OR REPLACE INTO maintenance (id, reason) VALUES (1, 'restoring D1')"
  W d1 execute maneman-<env> --env <env> --remote --command "$on"                       # on
  W d1 execute maneman-<env> --env <env> --remote --command "DELETE FROM maintenance"   # off
  ```

- **Pause the queues** as well, and resume them at the end. Paused, a message waits; handed back, it spends one of its few retries.

  ```sh
  for queue in render crm-sync messaging fsm-sync; do W queues pause-delivery mm-$queue-<t>; done
  for queue in render crm-sync messaging fsm-sync; do W queues resume-delivery mm-$queue-<t>; done
  ```

- **Start just after a cron run.** The cron runs at every minute that ends in 0 or 5; start at one ending in 1 or 6, so no run falls in the seconds between going back and the switch coming on again.
- **Ask ops to stay out of the console** until you are done.

Anything written while the Workers are on the earlier database is lost when you leave it. Afterwards, look in Razorpay's dashboard for any payment or refund made in those minutes ("Razorpay's webhook is not arriving").

### Repairing from an earlier minute

```sh
mkdir -p private/restore
# 1. Switch maintenance on, and pause the queues (above).
# 2. Go back, and switch maintenance on again. Keep the bookmark it prints after "To undo this operation":
#    it is the database as it is now.
W d1 time-travel restore maneman-<env> --env <env> --timestamp <T> && W d1 execute maneman-<env> --env <env> --remote --command "$on"
# 3. Copy the damaged tables as they were then.
W d1 export maneman-<env> --env <env> --remote --no-schema --table <table> --table <table> --output private/restore/at-T.sql > /dev/null
# 4. Come straight back. The switch is on there, as you set it in step 1.
W d1 time-travel restore maneman-<env> --env <env> --bookmark <the bookmark from step 2>
# 5. Switch maintenance off, and resume the queues.
```

If step 3 fails, go on with step 4 all the same: until step 4 has run, the Workers are on the earlier database.

Then, with no hurry, load the copy beside the tables as they are now, each as `restore_<table>`:

```sh
tables='people leads'   # the damaged tables
{
  for table in $tables; do echo "CREATE TABLE restore_$table AS SELECT * FROM $table WHERE 0;"; done
  sed -nE 's/^INSERT INTO "([a-z_0-9]+)"/INSERT INTO "restore_\1"/p' private/restore/at-T.sql
} > private/restore/load.sql
W d1 execute maneman-<env> --env <env> --remote --file private/restore/load.sql
```

Put right what was damaged, with SQL written for the damage. Rows deleted since `<T>`, say:

```sql
INSERT INTO leads SELECT * FROM restore_leads WHERE id NOT IN (SELECT id FROM leads);
```

Or a column overwritten:

```sql
UPDATE people SET name = (SELECT r.name FROM restore_people r WHERE r.id = people.id)
WHERE erased_at IS NULL AND id IN (SELECT id FROM restore_people);
```

Leave alone what changed rightly since `<T>`: the second example passes over people erased since, whose name must stay "Erased". "What a restore undoes" in `docs/schema.md` is the list to think through. Then drop each `restore_` table and delete `private/restore`.

### Restoring the whole database

```sh
mkdir -p private/restore
# 1. Switch maintenance on, and pause the queues (above).
# 2. Copy everything as it is now, if it can still be read. The export holds up other queries while it runs.
W d1 export maneman-<env> --env <env> --remote --output private/restore/now.sql > /dev/null
# 3. Build the carry-back file. Name each table the restore is for with --leave: it stays as it was at <T>.
node scripts/restore-carry.ts private/restore/now.sql private/restore/carry.sql --leave <table>
# 4. Go back, and switch maintenance on again. Keep the bookmark it prints: restoring to it undoes this.
W d1 time-travel restore maneman-<env> --env <env> --timestamp <T> && W d1 execute maneman-<env> --env <env> --remote --command "$on"
# 5. Carry back what can be trusted.
W d1 execute maneman-<env> --env <env> --remote --file private/restore/carry.sql
# 6. Check the database is still this environment's.
node scripts/mark-database.ts <env> --check
# 7. Switch maintenance off, resume the queues, and run the smoke suite.
```

`scripts/restore-carry.ts` reads the tables and their triggers from the export itself, and prints how it treats each. Its file empties each table and fills it again as it was a moment ago, except that:

- a table that refuses a delete, such as `consents`, `audit_log`, `credit_ledger` or `hair_profiles`, only gains the rows it lacks, and its rows changed since are changed to match, so a hair profile an erasure blanked is blanked again;
- a table triggers write to, such as `last_visits` or `stock_balances`, is written last, as the export had it;
- `d1_migrations`, `deployment_identity` and the maintenance switch are never touched.

`test/worker/restore-carry.test.ts` runs the same steps on a row in every table, so a migration the carry-back cannot pass fails its pull request.

A table dropped since `<T>` is not in `now.sql`, so it stays as it was at `<T>`, named or not. The file runs whole or not at all. It fails, and changes nothing, when a migration ran after `<T>`, as its rows then name tables or columns the restored database lacks (leave out the tables that migration changed), or when a table left at `<T>` points at a row a carried table no longer has (carry it too, or leave out the one it points at). Anything written between the restore and the carry-back is lost.

Then:

1. **A migration that ran after `<T>`** is undone with the rest, and the code serving expects it: roll mm-api back to the release before it ("Rolling back a Worker version"), or apply the migrations again once they are right.
2. **For each table left at `<T>`**, put back what "What a restore undoes" in `docs/schema.md` says for it. Its rows as they were a moment ago are in `now.sql`: load them as `restore_` tables, as "Repairing from an earlier minute" does.
3. Delete `private/restore`.

If nothing is left worth carrying (the export failed, or nothing in it can be trusted), everything since `<T>` is lost, and "What a restore undoes" is the list of what to put back from elsewhere.

### What a restore undoes

What each group of tables means if it is left as it was at `<T>`, and how it is put back, is in `docs/schema.md`, "What a restore undoes". `npm run schema` writes it from `RESTORE_GROUPS` in `scripts/lib/schema-doc.ts`, and its test fails on a table in no group, so a new table cannot leave the list behind.

---

## Rolling back a Worker version

A production release rolls itself back when a smoke check or the soak fails once traffic has started to move: every Worker goes back to the version it served before the release, whichever step failed. Staging has no automatic rollback. By hand, for any of the five Workers, in either environment:

1. **Find the version to go back to.** Each Worker's config is in `scripts/lib/workers.ts`: `wrangler.jsonc` for mm-api, `site/wrangler.jsonc` for mm-site, and `apps/app/wrangler.jsonc`, `apps/ops/wrangler.jsonc` and `apps/tech/wrangler.jsonc` for the apps.

   ```sh
   node scripts/release.ts current --worker <worker> --env <env>     # the version serving now
   W deployments list --config <config> --env <env>                  # the last ten deployments, each with its versions
   W versions list --config <config> --env <env>                     # every version, tagged with the commit it was built from
   ```

   The deployment before the bad one names the version to go back to.

2. **Put it back.** One Worker or several in one command; a Worker already serving the version named is left alone, and every one is tried before the command fails:

   ```sh
   node scripts/release.ts restore --env <env> --message "rollback: <reason>" --to mm-api=<version id> --to mm-app=<version id>
   ```

3. **Smoke it.** The public host, and each switched-on Phase 2 host, which must serve mm-api and its own app:

   ```sh
   npm run smoke -- --base https://maneman.in --environment production --version-id <mm-api's version id>
   npm run smoke -- --environment production --surfaces
   ```

   On staging the base is `https://staging.maneman.in`, and every host is behind Access: put an Access service token (step 3) in `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` first.

What a rollback does not undo:

- **The database.** Every migration works with the code of the release before it (ADR 0006), so mm-api's previous version runs on the migrated schema. Going back further than one release is not promised: a contract step (`docs/migrations.md`) drops what older code still reads. Data a bad release wrote wrongly is "Restoring D1".
- **Triggers.** Cron schedules, queue consumers and routes are not part of a version. If the release was followed by `apply-triggers`, the older code runs with the newer triggers; attach the older ones by checking out the older commit and running `npm run apply-triggers -- --env <env>` from it.
- **Staging's next merge.** A merge to `main` deploys every Worker again, so a rollback on staging lasts until then.

An app's phones and browsers take the rolled-back version the next time they open it, when its service worker sees the change. If a release stopped halfway through a rollout, `release.ts current` refuses to answer and prints the split: put the good version back at 100% with `node scripts/release.ts deploy --worker <worker> --env <env> --split <version id>@100 --message "rollback: <reason>"`.
