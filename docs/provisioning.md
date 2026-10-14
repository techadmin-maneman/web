# Provisioning an environment

Setting up staging or production from nothing, a step at a time. Operating an environment once it runs, and what to do when something is wrong, is [runbook.md](runbook.md).

## Where things stand, 27 September 2026

Staging's column is as its deploy of 27 September 2026 found it: all five Workers took commit 16fde86 and passed the smoke tests. Production's is as last recorded: its last release was 268eaa4 on 21 September 2026, which deployed mm-api and mm-site. Nothing here was read from production for this table; "Before the first production release of Phase 2", below the steps, is how to check.

| Step                                           | staging                                                 | production                                                                                |
| ---------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1. D1 database                                 | done                                                    | done                                                                                      |
| 1. Queues: render, crm-sync, messaging         | done                                                    | done                                                                                      |
| 1. R2 buckets, 30-day expiry                   | done                                                    | done                                                                                      |
| 1. R2 buckets: photographs, referral cards     | done                                                    | not yet (open point 86)                                                                   |
| 2. DNS record                                  | done                                                    | exists (the apex record)                                                                  |
| 3. Access application and service token        | done                                                    | not applicable                                                                            |
| 4. Migrations and identity mark                | done                                                    | done, to the migrations of 268eaa4                                                        |
| 5. Bootstrap deploy of mm-api and mm-site      | done                                                    | done                                                                                      |
| 6. CI tokens and GitHub secrets, checked       | done                                                    | done                                                                                      |
| 7. Worker secrets: Turnstile, IP salt          | done                                                    | done                                                                                      |
| 7. Worker secrets: alert webhook               | done (Google Chat)                                      | done (the same Google Chat space)                                                         |
| 7. Worker secrets: YouCam, link signing        | done                                                    | done (the harness's YouCam key, as staging's, for now)                                    |
| 7. Worker secrets: Evolution, allowlist        | done (poker-settle's bridge, for now)                   | Evolution done (the same bridge; messaging off)                                           |
| 7. Worker secrets: erasure                     | retired: delete `ERASURE_SECRET` once this lands        | retired: delete `ERASURE_SECRET` with the release that carries it                         |
| 7. Worker secrets: login code pepper           | done (22 September 2026)                                | not yet: with the client surface                                                          |
| 7. Worker secrets: the cron's heartbeat        | done (4 October 2026)                                   | done (4 October 2026); pinged once production runs it                                     |
| 7. Worker secrets: the analytics token         | retired (ADR 0112): the secret stays, unread            | retired                                                                                   |
| 8. Zoho org, fields, secrets                   | done: the real org (ADR 0050)                           | done: the real org (ADR 0050)                                                             |
| 9. Triggers: the cron                          | done, and checked by the deploy                         | done                                                                                      |
| 9. Triggers: the queue consumers               | done (all three); CI cannot read them, so check by hand | done (all three)                                                                          |
| 10. Access bypass for result links             | done                                                    | not applicable                                                                            |
| 10b. Access bypass for invite previews         | not yet: the owner's (27 September 2026)                | not applicable                                                                            |
| 11. Phase 2 hosts: DNS, Access                 | done                                                    | done (all three behind Access until go-live)                                              |
| 11. Phase 2 surfaces switched on               | done (22 September 2026)                                | not yet: waits for the production go-ahead                                                |
| 11. The apps' Workers: mm-app, mm-ops, mm-tech | done: each deploys with every merge                     | mm-app recorded as bootstrapped with no route (open point 83); mm-ops and mm-tech not yet |
| 11b. Books                                     | done                                                    | not yet: `BOOKS_PROVIDER` is `none`                                                       |
| 11c. Razorpay                                  | done, test keys                                         | not yet: `PAYMENTS_PROVIDER` is `none`                                                    |
| 12. Evolution receipts: token, bypass          | done                                                    | not yet                                                                                   |
| 12. Evolution receipts: the webhook            | open: the shared instance's webhook                     | not yet                                                                                   |
| 13. The address search (Google)                | `google`, and Google refuses the key (open point 54)    | not yet: `none`                                                                           |
| 14. Cloudflare's edge scripts                  | off for the zone, 11 October 2026                       | the same zone settings                                                                    |
| 15. The rate-limiting rule                     | not set: the dashboard asks for a paid plan             | the same: the zone's                                                                      |

## 1. Resources

```sh
W d1 create maneman-<env> --location apac      # put the ID in wrangler.jsonc, env.<env>
W queues create mm-render-<t>
W queues create mm-crm-sync-<t>
W queues create mm-messaging-<t>
npm run check:config -- --require-provisioned  # must pass before anything deploys
```

`wrangler.jsonc` binds all three queues and all four buckets below in every environment, so an upload of mm-api fails until each exists. The release uploads before it migrates (ADR 0006), so a missing one stops it with the database untouched.

R2 must be enabled on the account first (dashboard → Storage & databases → R2; it needs a payment method). Try-on photos and results must not outlive 30 days, so each bucket gets an expiry rule:

```sh
for bucket in mm-<t>-tryon-uploads mm-<t>-tryon-results; do
  W r2 bucket create $bucket --location apac
  W r2 bucket lifecycle add $bucket expire-after-30-days --expire-days 30 --abort-multipart-days 1 --force
done
```

Phase 2's two buckets get no rule: a client's photograph is deleted only on purpose, and a referral card when its referrer or a revoke takes it down.

A client's referral card is drawn by Cloudflare Images, through the Worker's `IMAGES` binding (`wrangler.jsonc`), which needs nothing set up. The free plan allows 5,000 transformations a month and refuses work past them, with no bill; a card takes a few. A refusal shows in Workers Logs as `card_not_made`, and the app sends the house card instead.

```sh
W r2 bucket create mm-<t>-client-photos --location apac
W r2 bucket create mm-<t>-referral-cards --location apac
```

Then check every bucket the Workers bind: that it exists, that the try-on ones expire everything within 30 days, and that no other expires anything. CI's tokens may not read R2 (step 6), so this takes a token of your own that can (Account → Workers R2 Storage → Read), as `CLOUDFLARE_API_TOKEN` in a git-ignored `.env.cf-read`:

```sh
node --env-file=.env.cf-read scripts/release/check-buckets.ts <env> --strict
```

## 2. DNS

The hostname needs a proxied DNS record for visitors to reach it. There is no origin behind it; the Workers answer.

- Staging: in the `maneman.in` zone, DNS → Add record: type `AAAA`, name `staging`, IPv6 address `100::`, **Proxied**.
- Production: the apex already has proxied records (the old GoDaddy parking addresses). The Workers' routes answer before any origin is contacted, so nothing reaches GoDaddy. Replacing them with `AAAA @ 100::` is tidier but not required.

## 3. Access (staging only)

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

### Staff sign in with their maneman.in Google accounts

Care, dispatch and city staff sign in to the console with Google Workspace, never with a Cloudflare account of their own. Do it for `ops-staging.maneman.in` first, then `ops.maneman.in`.

1. **The owner, in Google Cloud** (the project under the maneman.in organisation): APIs & Services → OAuth consent screen → **Internal**. Then Credentials → Create credentials → OAuth client ID → **Web application**, named `Cloudflare Access`, with the authorised redirect URI `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback` (the team name is in Zero Trust → Settings → Custom pages). Send the client ID and secret to whoever sets up Access, through the password manager.
2. **Zero Trust → Settings → Authentication → Login methods → Add new → Google Workspace.** Paste the client ID and secret, and the domain `maneman.in`. Test it: the test signs in a maneman.in account and shows its email.
3. **Make it the only way in for staff:** on each console application, under Login methods, tick Google Workspace alone and turn on **Instant Auth**, so the login page goes straight to Google. Service Auth for the CI token stays as it is.
4. **MFA and the session:** in the Google Admin console, Security → 2-Step Verification → **Enforce** for every maneman.in account. On each console application set **Session duration** to **24 hours**, and on the policy that admits staff add the rule **Require: Login methods — Google Workspace**.
5. **Who gets in:** the Allow policy names the staff by their maneman.in emails, or a Google group, never `@maneman.in` as a whole. The console's own Staff list ([ADR 0189](decisions/0189-the-staff-list-on-by-default.md)) still decides what each can do once in.
6. **Check:** in a private window, open the console: Google's sign-in comes up at once, a personal Gmail is refused, and a maneman.in account without 2-Step Verification cannot finish signing in.

## 4. Database

```sh
W d1 migrations apply maneman-<env> --env <env> --remote
node scripts/release/mark-database.ts <env>    # writes the identity row once; fails if it names another database
```

## 5. Bootstrap both Workers

The first deploy is `wrangler deploy`, which also attaches the routes. Every later deploy goes through the workflows.

```sh
W deploy --env <env> --tag bootstrap
W deploy --config site/wrangler.jsonc --env <env> --tag bootstrap
npm run smoke -- --base https://<host> --environment <env>
```

## 6. CI token and GitHub secrets

Cloudflare dashboard → Manage Account → Account API Tokens → Create Token → Custom token, one per environment:

- Name `mm-ci-<env>`.
- Workers: role **Editor**, scope **Specified Workers**: every Worker in `scripts/lib/workers.ts`, for that environment: `mm-api-<env>`, `mm-site-<env>`, `mm-app-<env>`, `mm-ops-<env>` and `mm-tech-<env>`. A token can only name a Worker that exists, so a new Worker is added to its token after its bootstrap (step 11); until then its deploy step skips it, or fails with "No access to the specified service".
- Account → **Workers Scripts → Read**. The upload checks that each Workflow the API binds is its own (`GET /workflows/<name>`), and that call takes an account-wide Workers permission; Read is the least that does. It lets the token read the other environment's Workers' settings and code, never change them; their secrets stay unreadable. The Workflows themselves are made by `npm run apply-triggers`, from a login of your own.
- Account → **Workers Scripts → Read**. The upload checks that each Workflow the API binds is its own (`GET /workflows/<name>`), and that call takes an account-wide Workers permission; Read is the least that does. It lets the token read the other environment's Workers' settings and code, never change them; their secrets stay unreadable. The Workflows themselves are made by `npm run apply-triggers`, from a login of your own.
- Account → **Workers Scripts → Read**. The upload checks that each Workflow the API binds is its own (`GET /workflows/<name>`), and that call takes an account-wide Workers permission; Read is the least that does. It lets the token read the other environment's Workers' settings and code, never change them; their secrets stay unreadable. The Workflows themselves are made by `npm run apply-triggers`, from a login of your own.
- Account → **D1 → Edit**. This is account-wide, so the staging token can also read and write production's database, and production's staging's; that is accepted in `docs/decisions/0008-owner-decisions-on-platform-constraints.md`.
- Optional, production's token: Account → **Account Analytics → Read**. With it, the canary's soak judges the new version on real visitors' errors as well as the smoke's (`docs/decisions/0006-deployment-pipeline.md`); without it the soak says so and the smoke checks stand alone.
- Optional, production's token: Account → **Workers Observability → Edit** (Cloudflare asks for Edit to run a query, which changes nothing). With it, the soak also fails a release whose busy routes read more rows from D1 a request than their ceilings in `scripts/lib/usage-budget.ts`, or whose Home or job card is slower at p95 than its budget in `scripts/lib/soak.ts`; without it the soak says it could not read them.
- Optional, staging's token: the same **Account Analytics → Read**. With it, each staging deploy reports mm-api's CPU time over the last day, warning past a tenth of the 30 seconds an invocation may use (`scripts/ops/cpu-report.ts`); without it the step says it could not read it.
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
node --env-file=.env.ci-staging scripts/release/verify-ci-token.ts staging
node --env-file=.env.ci-production scripts/release/verify-ci-token.ts production
```

Then load the files into the GitHub environments and delete them:

```sh
gh secret set -f .env.ci-staging --env staging
gh secret set -f .env.ci-production --env production
rm .env.ci-staging .env.ci-production
```

Rotating a token later is the same: new token in a file, check it, load it, delete the file.

When the GitHub plan allows (0008): require every job in `.github/workflows/ci.yml` on `main`, and add required reviewers to the `production` environment.

## 7. Worker secrets

Set these on the Worker, not in GitHub. `wrangler secret put` prompts for the value. Set them **before** deploying code that needs them: the Worker refuses to start without them (`docs/decisions/0011-lead-api.md`).

| Secret                                                                      | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TURNSTILE_SECRET`                                                          | The secret of the environment's Turnstile widget (Cloudflare dashboard → Turnstile).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `IP_HASH_SALT`                                                              | 32 or more random characters: `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`. Changing it resets the rate-limit counters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ALERT_WEBHOOK_URL`                                                         | An incoming-webhook URL for Slack, Google Chat or Discord. Alerts carry IDs, never names or numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `LEAD_WEBHOOK_URL`                                                          | Optional. Where the one-line notice for each new lead is posted, if not the alert space (`docs/decisions/0018-one-look-pro-only-lead-notices.md`). Notices carry city, window and date, never a name or number.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `HEARTBEAT_URL`                                                             | Optional, and wanted before go-live. The ping URL of the environment's healthchecks.io check, `https://hc-ping.com/<uuid>`, which the cron pings after every run ("The outside watchers").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_LAR_ID` | Step 8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ZOHO_ACCOUNTS_HOST`, `ZOHO_API_HOST`                                       | India data centre: `accounts.zoho.in`, and for the API `www.zohoapis.in`. Both environments use the real org (ADR 0050); a Developer Edition org would answer on `developer.zohoapis.in` instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `YOUCAM_API_KEY`                                                            | The environment's YouCam API key, a static key from the YouCam API console, sent only to YouCam's API host. Staging and production hold the harness's key for now (ADR 0201).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `RESULT_SIGNING_KEY`                                                        | 32 or more random characters, generated like `IP_HASH_SALT`. Signs upload and result links. To change it, put its old value in `RESULT_SIGNING_KEY_PREVIOUS` first: links signed with it still open. Delete that a year later, when the last stop link it signed has lapsed.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`         | The Evolution API bridge (`docs/decisions/0016-whatsapp-through-evolution.md`). The URL must be public `https://`, reachable from Cloudflare, and include the port if it is not 443: staging's ends in `ts.net:8443`, because port 443 on that host serves another app. `GET /` there should answer "Welcome to the Evolution API".                                                                                                                                                                                                                                                                                                                                            |
| `MESSAGING_ALLOWLIST`                                                       | Staging: the founders' mobile numbers, comma-separated. Holds back an automatic message — a reminder, a launch alert, or one to someone other than who acted — and any message about a record one of our own scripts made ("Staging test", "Load test"), whatever its kind; a login code and a message that answers a real person who just acted (their booking, their move, their cancel, the try-on result they claimed) reach any number otherwise (ADR 0097; `isStagingTestRecord`, `src/policy/staging-test-records.ts`). A secret, so the numbers stay out of git.                                                                                                       |
| `STAGING_TEST_RECORD_CODE`                                                  | Staging only, optional: six digits that a test record signs in with, so an audit walks the real login screens; such records also skip the per-address limits on codes and the site's forms (`src/policy/staging-test-records.ts`). A test record is one made on staging with a "Staging test …" or "Load test …" name, marked on the person when made (`people.test_record`); renaming a record later marks nothing, and a number change's new number never takes this code. The guard refuses it anywhere else. The owner keeps it as a staging feature (decision 23, 2 October 2026): rotate it after each audit with `W secret put STAGING_TEST_RECORD_CODE --env staging`. |
| `GOOGLE_MAPS_API_KEY`                                                       | The address search, once `GEOCODE_PROVIDER` is `google`. Make and restrict it in section 13 first: an unrestricted key is a key anyone can spend.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

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

## 8. Zoho

Both environments use the real org (`docs/decisions/0050-crm-in-the-real-org.md`), which also holds Books. Do this once per org.

Steps 1 and 2 are what `scripts/ops/setup-crm.ts` does, where the refresh token's scope includes `ZohoCRM.settings.fields.ALL`:

```sh
node --env-file=.env.crm-<env> scripts/ops/setup-crm.ts --check   # read-only
node --env-file=.env.crm-<env> scripts/ops/setup-crm.ts           # creates what is missing
```

Zoho names a new field from its label, so the script reads each one back: the sync writes the API name and nothing else. Steps 3 and 4 have no API and stay by hand.

1. **Fields.** Setup → Customization → Modules and Fields → Leads → Standard layout. Add these fields; their API names must match exactly:

   | Field                                                    | Type        | Values                                                                                          |
   | -------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
   | First Choice Window (`First_Choice_Window`)              | Pick list   | Weekday morning, Weekday evening, Weekend morning, Weekend evening                              |
   | Loss Extent (`Loss_Extent`)                              | Pick list   | Crown thinning, Receding front, Advanced                                                        |
   | Proposed Visit Date (`Proposed_Visit_Date`)              | Date        |                                                                                                 |
   | Contact Consent (`Contact_Consent`)                      | Checkbox    |                                                                                                 |
   | Try On (`Try_On`)                                        | Checkbox    |                                                                                                 |
   | D1 Lead ID (`D1_Lead_ID`)                                | Single line |                                                                                                 |
   | D1 Person ID (`D1_Person_ID`)                            | Single line | tick "Do not allow duplicate values"                                                            |
   | UTM Source (`UTM_Source`), UTM Campaign (`UTM_Campaign`) | Single line |                                                                                                 |
   | Referral Code (`Referral_Code`)                          | Single line |                                                                                                 |
   | Booked Window (`Booked_Window`)                          | Pick list   | Morning, 9 am to 12 pm; Afternoon, 12 to 4 pm; Evening, 4 to 8 pm                               |
   | Last Contact Date (`Last_Contact_Date`)                  | Date        |                                                                                                 |
   | Last Contact Reason (`Last_Contact_Reason`)              | Pick list   | Booking, Move or cancel, Fit problem, Aftercare, Billing, Signing in, Try-on, Their data, Other |

2. **Pick-list values.** Lead Status: add `New`, `Waitlist` and `Try-on — delivery only` (with the em dash). Lead Source: add `Booking form`, `Waitlist`, `Try-on` and `Referral`.

   The last two fields and `Referral` came with ADR 0074, for an invited friend and the window a booking asked for. Zoho refuses a lead carrying a pick-list value it does not have, so the sync writes none of the three until `CRM_ORG_HAS_REFERRAL_FIELDS` in `src/config/crm.ts` is turned on: run `scripts/ops/setup-crm.ts`, then `scripts/ops/check-zoho-setup.ts` to prove them, then turn it on in a release. Until then a record the CRM already has gets the invite and the window in its note.

   The last-contact fields came with ADR 0137, for a client's last closed chat with Care, and the Lead_Source `WhatsApp` and Lead_Status `WhatsApp — answer in chat` with ADR 0138, for a stranger Care save from a chat. They wait the same way, on `CRM_ORG_HAS_CARE_FIELDS`: until it is on, nothing of the last contact is written, and a WhatsApp lead waits unsent.

3. **Assignment rule.** Setup → Automation → Assignment Rules → Leads: create the rule that gives each new booking an owner. Its ID becomes `ZOHO_LAR_ID`; `scripts/ops/check-zoho-setup.ts` (step 6) lists it. An org may have none: leave `ZOHO_LAR_ID` unset and Zoho leaves each record with the API user.
4. **Workflows.** Setup → Automation → Workflow Rules → Leads:
   - on create, when Lead Status is New: notify the assigned technician and ops;
   - on edit, when Contact Consent becomes true: assign an owner. This covers a try-on customer who later books; Zoho has no assignment rule on update.
   - Nothing may fire for Lead Status "Try-on — delivery only". The sync no longer sends a try-on to the CRM (ADR 0012, amended 4 October 2026), so only older records carry it.
5. **API client.** The data centre is in the address you log in at: `crm.zoho.in` is India, `crm.zoho.com` the US, and so on. Use the matching API console, for example `https://api-console.zoho.in`. A Developer Edition org answers on `developer.zohoapis.<dc>`, not `www.zohoapis.<dc>`, even though the token reply names `www` (ADR 0012).
   1. **Add Client** → **Self Client** → **Create Now** → **OK**. The **Client Secret** tab shows the client ID and secret.
   2. **Generate Code** tab. Scope, exactly:

      ```
      ZohoCRM.modules.leads.ALL,ZohoCRM.modules.notes.CREATE,ZohoSearch.securesearch.READ,ZohoCRM.settings.fields.READ,ZohoCRM.settings.assignment_rules.READ,ZohoCRM.modules.contacts.UPDATE,ZohoCRM.modules.contacts.DELETE
      ```

      The first three are what the sync uses. The two `contacts` scopes let an erasure blank and delete the Contact that Books' CRM integration made of the client (`src/domain/books/books-erasure.ts`); a token without them leaves every such Contact to be erased by hand. The two `settings…READ` scopes let `scripts/ops/check-zoho-setup.ts` read the fields and assignment rules; they cannot change anything. Choose the longest time duration, add a description, then **Create** and pick the org.

   3. Before the code expires, exchange it for a refresh token. Use your data centre's accounts host:

      ```sh
      curl -X POST "https://accounts.zoho.in/oauth/v2/token?grant_type=authorization_code&client_id=<id>&client_secret=<secret>&code=<code>"
      ```

      Keep the `refresh_token` from the answer. It does not expire; revoke it in the API console if it leaks.

   Do 2 and 3 once for each environment: staging and production each keep a refresh token of their own from this Self Client. One refresh token mints at most ten access tokens in ten minutes, and each environment counts only its own, so with one shared token either could lock the other out of the CRM for ten minutes.

6. **Check, then store.** Put the Zoho values (and `ALERT_WEBHOOK_URL`) in `.env.worker-<env>` (step 7). Leave `ZOHO_LAR_ID` empty if you don't know it yet. Then:

   ```sh
   node --env-file=.env.worker-staging scripts/ops/check-zoho-setup.ts
   ```

   It confirms every field, type and pick-list value the sync writes, and lists the Leads assignment rules with their IDs. Fill in `ZOHO_LAR_ID`, run it again until it passes, then `W secret bulk` the file and delete it. The next lead proves the setup end to end: it should reach Zoho within a minute, assigned and with its proposed date.

7. **A refresh token for scripts.** Zoho mints at most ten access tokens in ten minutes from one refresh token, so a script run by hand must never share the Worker's: a proof that did took the Worker's Zoho calls down with it (`docs/open-points.md`, item 32). Repeat step 5.2 and 5.3 with the same Self Client to get a second refresh token, with only the scopes the scripts need. For the CRM, exactly:

   ```
   ZohoCRM.settings.fields.ALL,ZohoCRM.settings.assignment_rules.READ,ZohoCRM.modules.leads.READ,ZohoCRM.modules.leads.DELETE,ZohoCRM.modules.contacts.READ,ZohoCRM.modules.contacts.DELETE,ZohoSearch.securesearch.READ
   ```

   The settings scopes are for `scripts/ops/setup-crm.ts` and `scripts/ops/check-zoho-setup.ts`, the lead read and the search for the contract probe, and the lead and contact reads and deletes for "Staging's records in the org". For Books, use the same scopes as the Worker's Books token (step 11b). Keep it in the scripts' own git-ignored file, never in a Worker secret:
   - the CRM's as `ZOHO_SCRIPTS_REFRESH_TOKEN`, beside `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` and the hosts, in `.env.crm-scripts`;
   - Books' as `ZOHO_BOOKS_SCRIPTS_REFRESH_TOKEN`, beside `ZOHO_BOOKS_CLIENT_ID`, `ZOHO_BOOKS_CLIENT_SECRET`, the hosts and `ZOHO_BOOKS_ORG_ID`, in `.env.books-scripts`.

   `scripts/ops/check-zoho-setup.ts`, `scripts/ops/setup-crm.ts` and the Books scripts stop, naming this step, when theirs is missing (`scripts/lib/zoho-script-token.ts`). In an emergency, with the scripts' token lost, `--use-worker-token` runs one on the Worker's token on purpose; every token it mints is one the Worker cannot for ten minutes.

## 9. Triggers

CI deploys code but cannot attach cron schedules, queue consumers or routes (`docs/decisions/0010-applying-triggers.md`). After the code that handles them is live, attach every Worker's:

```sh
npm run apply-triggers -- --env <env>
```

After every deploy, both workflows compare the live cron schedules and queue consumers, with each consumer's settings, with every Worker's config, and warn on a difference. CI's token cannot read the queues, so its consumers read "not compared"; check them, and confirm an `apply-triggers`, with a token of your own that can read Workers and Queues:

```sh
node --env-file=.env.cf-read scripts/release/check-triggers.ts <env> --strict
```

## 10. Result links through Access (staging only)

A WhatsApp copy carries a link to `/api/result/…`, which the Evolution bridge fetches. On staging, Cloudflare Access would stop it. Each link is signed and expires, so the path can bypass Access:

1. Zero Trust → Access → Applications → Add → Self-hosted. Domain `staging.maneman.in`, path `api/result/`.
2. Policy: action **Bypass**, include **Everyone**.

Access applies the most specific path, so the rest of staging stays behind the founders' login.

**Access matches a bypass path without regard to case; the Workers' routes do not.** `/API/Result/…` and `/api/HOOKS/…` reach a Worker with no login, and today answer 404, because no route has those spellings. So the bypassed paths stay as narrow as they are, and every route added beneath them must be one anyone may call: `/api/result/` and `/api/hooks/` (step 12) hold nothing but signed links and webhooks that check their own secret. A route that needs the login goes under another path. A hooks host of its own would close it for good, but only staging has Access, so the owner kept the hooks where they are (5 October 2026).

## 10b. Invite previews through Access (staging only)

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

## 11. Switching on a Phase 2 surface

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

## 11a. The client app's login

Before the client surface is switched on in an environment, give its Worker the pepper that login codes are hashed under (docs/decisions/0030-one-time-codes.md): a random value of at least 32 characters, different in each environment.

```sh
openssl rand -hex 32 | W secret put OTP_PEPPER --env <env>
```

Changing it later voids every code in flight; sessions are unaffected. SMS stays off (`SMS_PROVIDER` is `none`) until a DLT-registered provider is set up.

## 11b. Zoho Books

Our own database is the record of visits (docs/decisions/0110-field-work-without-fsm.md). Zoho Books holds each client's customer, each visit's invoice and the money against it, in the real org (ADR 0025, item 26), on a refresh token of its own. Books' own CRM integration carries customers into CRM Contacts.

1. **The refresh token.** Zoho allows one Self Client per account, so Books uses the CRM's (step 8.5): the same client ID and secret, and a code of its own. In `https://api-console.zoho.in`, as an administrator of the org, open that Self Client. On **Generate Code**, use `ZohoBooks.contacts.ALL`, `ZohoBooks.invoices.ALL`, `ZohoBooks.customerpayments.ALL`, `ZohoBooks.creditnotes.ALL`, `ZohoBooks.bills.ALL`, `ZohoBooks.debitnotes.ALL`, `ZohoBooks.accountants.READ`, `ZohoBooks.banking.READ`, `ZohoBooks.settings.READ`, `ZohoBooks.settings.CREATE` and `ZohoBooks.settings.UPDATE`. Bills and debit notes are for suppliers' bills and credits (step 9); the two reads let `scripts/release/check-books-setup.ts` check the accounts in steps 6 and 9. Exchange the code for a refresh token within its 10 minutes:

   ```sh
   curl -X POST "https://accounts.zoho.in/oauth/v2/token?grant_type=authorization_code&client_id=<id>&client_secret=<secret>&code=<code>"
   ```

   The scripts take a second code, exchanged the same way, for a refresh token of their own (step 8.7). Theirs is made with `ZohoBooks.fullaccess.all`: they are run by hand, and the staging clean-up deletes what the narrower scopes cannot.

2. **The file.** Put Books' values in `.env.books-<env>`. Git ignores it.

   ```sh
   ZOHO_BOOKS_CLIENT_ID=...
   ZOHO_BOOKS_CLIENT_SECRET=...
   ZOHO_BOOKS_REFRESH_TOKEN=...
   ```

   The Books organisation ID is on Books → Settings → Organisation Profile.

3. **The org.** Books needs a custom field on Customers and Vendors, **"MM person ID"**: Text, unique values, API name `cf_mm_person_id`. It is what finds a client's customer again. Then prove Books' calls on "Staging test" records the script removes again (about 20 calls; it keeps one item, "Staging test: proof item", which the scripts' scopes cannot delete), and check the org's settings:

   ```sh
   node --env-file=.env.books-scripts scripts/staging/books-proof.ts
   node --env-file=.env.books-scripts scripts/release/check-books-setup.ts --env <env>
   ```

4. **The Worker.** Set the secrets, then set the hosts (`ZOHO_BOOKS_*_HOST`) and `ZOHO_BOOKS_ORG_ID` in `wrangler.jsonc`, with `BOOKS_PROVIDER` as `zoho`.

   ```sh
   W secret bulk .env.books-<env> --env <env>    # ZOHO_BOOKS_CLIENT_ID, _SECRET and _REFRESH_TOKEN, nothing else
   ```

   Set the secrets before deploying with the provider switched on: the guard refuses a Worker without them. Check `/api/health` after: a secret change deploys by itself, and an empty required secret stops the Worker (step 7).

5. **The buckets.** `mm-<t>-client-photos` and `mm-<t>-referral-cards` are step 1's, and must exist before any deploy, since `wrangler.jsonc` binds them. Neither gets a lifecycle rule: a client's photograph is only deleted on purpose.

6. **The refund account.** Payments go to Books by themselves (docs/decisions/0044-payments-mirror.md, "Receipts in Books"). Refunds need the account Books pays them from, which must be a bank account: Books refuses Undeposited Funds.
   - In Books: Banking → Add Bank or Credit Card → Bank, named "Razorpay", in INR.
   - Open it; its ID is the number at the end of the address.
   - Set it as `BOOKS_REFUND_ACCOUNT_ID` in the environment's vars in `wrangler.jsonc`, then deploy. It is not a secret.

7. **Each service's item.** A visit is invoiced on its service's Books item, at the price book's price on the day (docs/decisions/0073-prices-from-the-price-book.md). Once an hour the cron's `books_items` job matches each service offered today to its item: the one kept on it, else the active one Books holds under its name.
   - **With the push on,** an item Books lacks is made, and one that differs is written with the console's name, today's price and the SAC code, a few a pass. Ops hear, as `books_item:<kind>/<tier>`, only of one still unsettled an hour on.
   - **With the push off,** ops are told of each at once, and set the item in Books by hand as the alert says.
   - `BOOKS_ITEM_PUSH` in `src/config/environments.ts` is each environment's own switch, for its own organisation: staging's is on. **Only the owner switches production's on,** once production's price book holds the owner's prices.
   - An invoice carries its own name and price, so an item that differs never changes what a client is billed.

8. **Discounts at line-item level.** A discount code on a visit is written onto its draft invoice as the visit line's discount, before tax (docs/decisions/0108-discount-codes.md). In Books: Settings → Preferences → Invoices (or General, "Do you give discounts?"), choose discounts at line-item level, before tax. Until it is set, and until the first discounted visit is invoiced on staging, a draft Books will not discount is held and ops told (`docs/open-points.md`, item 181).

9. **The bill accounts.** Each receipt against a purchase order becomes a bill of its supplier, made a Books vendor first (docs/decisions/0168-bills-in-books.md). A hair system's lines post to **Cost of Goods Sold**, a consumable's to **Raw Materials and Consumables**.
   - In Books: Accountant → Chart of Accounts, open each; its ID is the number at the end of the address.
   - Set them in `BOOKS_BILL_ACCOUNTS` in `src/config/environments.ts`; staging and production share them, as they share the org. Where none are set, no bill is made.
   - A token made before `ZohoBooks.bills.ALL` was in step 1 cannot make bills: Books refuses each, and ops are told. Make a new code with step 1's scopes, exchange it, and set `ZOHO_BOOKS_REFRESH_TOKEN` again (step 4).
   - A claim settled as a credit becomes a vendor credit on the same account (docs/decisions/0171-vendor-credits.md).
   - Freight, duty and clearing are billed by the forwarder or broker, and entered in Books by hand.

10. **Staging's own organisation** (docs/decisions/0200-staging-tenants-of-its-own.md). Staging and production never share a Books organisation: the config check refuses the release that would. Before production's Books goes on:
    - In Books, as the owner, add an organisation for staging (or open Zoho's sandbox of the real one), with the custom field of step 3, the bank account of step 6, the discount setting of step 8 and the two accounts of step 9.
    - Set staging's `ZOHO_BOOKS_ORG_ID` and `BOOKS_REFUND_ACCOUNT_ID` in `wrangler.jsonc`, and its pair in `BOOKS_BILL_ACCOUNTS`, to the new organisation's. Mint staging's refresh token in it (step 1).
    - Delete staging's records from the real organisation (step 8, "Staging's records in the org"). Production then takes the real organisation.

## 11c. Razorpay

Payments and refunds are mirrored from Razorpay's webhook (docs/decisions/0044-payments-mirror.md). Staging uses test keys, which take no real money.

1. **The keys.** Follow `docs/archive/phase2-inputs.md`, section 4. The key ID goes in `wrangler.jsonc` as `RAZORPAY_KEY_ID`, since it is public, with `PAYMENTS_PROVIDER` set to `razorpay`. The key secret is a secret:

   ```sh
   W secret put RAZORPAY_KEY_SECRET --env <env>
   ```

2. **The webhook secret.** Make one, set it on the Worker, and keep it to paste into Razorpay. It must be at least 32 characters (the command below gives 48), and while `SELF_SERVE_BOOKING` is on the Worker refuses to start without it:

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

4. **The logo on a link's page,** in Razorpay's dashboard, in each mode: Account & Settings → Branding → upload the site's `icon-512.png` (`https://maneman.in/icon-512.png`). The API cannot set it, and without it a link's page shows a blank square. Every link already carries the client's name and number.

## 12. WhatsApp delivery receipts and STOP replies (Evolution)

Evolution reports each message as delivered and read to `POST /api/hooks/evolution/<token>` (docs/decisions/0041-outbound-messages-for-phase-2.md), and passes on the messages people send us, where a STOP reply withdraws the sender's WhatsApp consents and is answered once. The no-show evidence depends on the receipts. Until this is set up, the route answers 404: no receipts are recorded and a STOP reply stops nothing (the link at the foot of a reminder still works).

1. **The token.** Make a random value of at least 32 characters, e.g. `openssl rand -hex 24`, and set it on the Worker with `W secret put EVOLUTION_WEBHOOK_TOKEN --env <env>`. Use a different value in each environment.
2. **Evolution's webhook**, on the instance the Worker sends from:
   - URL: `https://<host>/api/hooks/evolution`, with the header `Authorization: Bearer <token>` (the webhook's `headers` in Evolution's settings), so the token is in no URL a proxy logs. A bridge that cannot send headers uses `https://<host>/api/hooks/evolution/<token>`, which mm-api still takes;
   - events: **`MESSAGES_UPDATE` and `MESSAGES_UPSERT` only**;
   - "webhook by events": off.

   Every event is a request mm-api answers, billed past the month's allowance, so send no others.

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

   Then reply STOP from that handset, if its person has agreed to WhatsApp about visits or launches. The handset gets one answer, the client's page in the console shows the consents withdrawn by "STOP reply", and Workers Logs has an `evolution_replies` line with `stopped: 1`. Switch the consents back on in the app afterwards.

---

## 12a. WhatsApp through MSG91

The WhatsApp Business Platform, which sends from the business's own number with templates WhatsApp approves (ADR 0114). Built, and off until the number is ready: each environment's `MESSAGING_PROVIDER` stays `evolution` until step 4.

1. **The number.** In MSG91 (WhatsApp → Numbers), connect the office WhatsApp Business number to the business's Meta account. The number can no longer be used in the WhatsApp app on a phone.
   Staging sends from a number of its own, which production never uses (docs/decisions/0200-staging-tenants-of-its-own.md): a second number on the same Meta account, or, while staging stays on Evolution, an instance of its own that serves no other app.
2. **The templates.** `node scripts/ops/whatsapp-templates.ts --origin https://maneman.in` (or `https://staging.maneman.in` for a staging number) prints each one: submit it in MSG91 (WhatsApp → Templates) under the same name, category and language, with its image header and buttons. A button's address is the origin followed by `{{1}}`. Wait until every one is approved; a text missing approval is refused, and its message fails.
3. **The secrets,** for the environment: `W secret put MSG91_AUTH_KEY --env <env>` with MSG91's API key, and `W secret put MSG91_INTEGRATED_NUMBER --env <env>` with the number and its country code, as `919810000000`.
4. **The switch.** A pull request sets `MESSAGING_PROVIDER` to `"msg91"` in that environment's vars. Once deployed, sign in with a code, and check one booking's confirmation arrives. A refused key alerts as the bridge being down; a refused template fails its message with MSG91's reason in `outbound_messages.last_error`.
5. **Receipts, replies and STOP.** A token of at least 32 characters, `W secret put MSG91_WEBHOOK_TOKEN --env <env>`; then in MSG91 (Webhooks (New) → WhatsApp), a webhook to `https://<host>/api/hooks/msg91/<token>` on the public host, for the inbound messages and the outbound reports. A delivered or read report fills in the message's receipt; a message to the number is filed in the Care inbox, and a STOP, typed or pressed, stops our messages (ADR 0197). Workers Logs shows `msg91_inbound` with what each post held. Keep Evolution's webhook (step 12) on the old number for any replies still sent there.

## 12b. Login codes by SMS (MSG91)

The fallback for login codes (ADR 0030, amended 11 October 2026): a code WhatsApp fails to send goes again by SMS, and the client app offers "send by SMS" 30 seconds after the first code. Built, and off until DLT approves the template: each environment's `SMS_PROVIDER` stays `none` until step 5. India requires every business SMS to be registered on DLT first, which takes one to three weeks.

1. **The entity.** Register the company as a Principal Entity on one operator's DLT portal (Jio TrueConnect, Airtel, Vi Vilpower or BSNL; one covers all). It takes the company's PAN, GST certificate and a letter of authorisation. Keep the Entity ID.
2. **The header.** On the same portal, register a six-letter sender ID for service messages, such as `MANEMN`.
3. **The template.** Register a content template, type _Service Implicit_, under that header, with exactly this text:

   ```
   {#var#} is your Mane Man code. It expires in 10 minutes. Don't share it with anyone.

   @app.maneman.in #{#var#}
   ```

   The last line lets Chrome on Android fill the code in by itself; it must stay exactly as written. Keep the DLT template ID.

4. **MSG91.** In MSG91 (SMS → DLT), add the Entity ID and the header. Then add the template (SMS → Templates) with its DLT template ID and the same text, each `{#var#}` written `##otp##`. Keep the template ID MSG91 gives it, and set it for the environment with `W secret put MSG91_SMS_TEMPLATE_ID --env <env>`. `MSG91_AUTH_KEY` is the same key as section 12a's: put it now if 12a isn't done.
5. **The switch.** A pull request sets `SMS_PROVIDER` to `"msg91"` in that environment's vars. Once it is deployed, sign in to the client app and tap **Send by SMS instead** once it shows: the code arrives by SMS from the header. Workers Logs shows `login_code_sent` with `channel: "sms"`, or MSG91's reason under `login_code_failed`.

## 13. The address search (Google Maps Platform)

The client app's address form searches for a building and keeps a coordinate for the check-in's geofence (docs/decisions/0054-address-capture.md). Until this is done, `GEOCODE_PROVIDER` stays `none`: the form takes a typed address, saves no coordinate, and nothing calls Google.

**This is the owner's card, so do every step. Google's free allowance does not stop at its limit — it bills. Google's budget alerts are not a spending cap; they tell you after the money is spent. The only thing that stops a charge is the per-API quota in step 4.**

Everything below is at <https://console.cloud.google.com>, signed in as the account that holds the card.

1. **A project of its own.** Top bar → the project picker → **New project**. Name it `mane-man-maps`. A separate project keeps the quotas and the bill readable, and lets the key be deleted without touching anything else.

2. **Switch on exactly two APIs, and no others.** Navigation menu (☰) → **APIs & Services** → **Library**. Search for and **Enable** each:
   - **Places API (New)** — the search box.
   - **Geocoding API** — the coordinate we keep.

   Do not enable Maps JavaScript API, Maps SDK, Distance Matrix or anything else here. Section 13a adds Routes and Maps Static for the dispatch board; nothing else is called, and an API that is not enabled cannot be billed.

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

### If the address search misbehaves

- **Suggestions never appear, and the logs say `address_suggest_failed` with `refused`.** The key is wrong, restricted to the wrong APIs, or its quota is spent. The alert space is told at once and again each day while it lasts, with Google's own words, and the alert closes at the next search Google answers: the Places API refuses with a 403 and a message, the Geocoding API with a 200 whose `status` is `REQUEST_DENIED`, `OVER_DAILY_LIMIT` or `OVER_QUERY_LIMIT`. Check step 3's API restrictions first. The form still works: an address can always be typed.
- **"busy" instead of suggestions.** A ceiling is reached. `geocode` is the ceiling's name in the alert. Either a client is hammering the form — the per-client limit is 120 a day — or `GEOCODE_DAILY_CEILING` is too low for real use. Raise it in `wrangler.jsonc` and deploy; the guard refuses anything above 1,800.
- **To stop all spending at once.** Set `"GEOCODE_DAILY_CEILING": "0"` in `wrangler.jsonc` and deploy, or set `"GEOCODE_PROVIDER": "none"`. Either way the form keeps working, typed.
- **A charge appears at all.** Something is wrong, because the quotas in step 4 cannot reach the free allowance. Disable the key in **Credentials**, set `GEOCODE_PROVIDER` to `none`, and find out how before re-enabling it.

## 13a. The dispatch board's drive times and day map (Routes and Maps Static)

The board's Routes, from each column's head: a map of each technician's day and the drive between their visits (ADR 0120). Until this is done, `ROUTES_PROVIDER` stays `none`: the board lists the day's visits with no drive times and no map. It uses section 13's project and key, so do that first.

1. **Switch on two more APIs**, in the `mane-man-maps` project: **APIs & Services** → **Library** → **Routes API** → **Enable**, then **Maps Static API** → **Enable**.
2. **Let the key call them.** **Credentials** → the `mm-api address search` key → **API restrictions**: tick **Routes API** and **Maps Static API** as well as the two already ticked. **Save.**
3. **Cap their quotas**, as in section 13 step 4:

   | API             | Quota to edit               | Set it to |
   | --------------- | --------------------------- | --------- |
   | Routes API      | Compute Routes requests/day | **1200**  |
   | Maps Static API | Requests per day            | **400**   |

   Each sits just above our own daily ceiling (1,000 drives, 300 maps), so our code refuses first. A month at either quota stays under the 70,000 Google gives free on the India price list.

4. **Switch it on.** A pull request sets `"ROUTES_PROVIDER": "google"` under `env.staging.vars` in `wrangler.jsonc`. Leave production as `none` until its release.
5. **Check it.** Open Dispatch, then **Routes** under a day with visits whose clients' addresses are pinned. The map shows each technician's day in their colour, and the list shows the drive between each two visits. If it says the drive times are unavailable, look for `vendor_call` lines with `vendor: "google"` in Workers Logs: a 403 is step 2's restriction.

## 14. Cloudflare's edge scripts: Web Analytics and JavaScript detections

**Both off,** for the whole zone, since 11 October 2026: JavaScript detections through Cloudflare's API (the zone's bot settings, `enable_js` false, with Bot Fight Mode off), and Web Analytics' automatic setup in the dashboard (Web Analytics → `maneman.in` → **Manage site**). No page carries either script, and no surface's policy allows either. The site counts its visits with the analytics tags it sets itself (`site/src/lib/analytics.ts`).

Cloudflare can add two scripts to a page at its edge, where no local run sees them:

- **Web Analytics' beacon,** from `static.cloudflareinsights.com`, which it added to every host of the zone (`docs/open-points-settled.md`, item 144).
- **JavaScript detections,** an inline script that loads `/cdn-cgi/challenge-platform/`, different with every request, so no hash could allow it (ADR 0023, section 2; item 111). Turnstile's own check, on the forms that ask for it, loads from `challenges.cloudflare.com` under the same path, and is allowed.

**If either comes back,** the staging deploy's last step fails: `npm run smoke:csp -- --environment staging` opens every host's pages in Chromium and fails on any refusal. Switch it off again as above. JavaScript detections have no dashboard switch on the free plan: `PUT /zones/<zone>/bot_management` with `{"enable_js": false}`, from a token with Bot Management · Edit on the zone.

## 15. The rate-limiting rule

**Not set, 4 October 2026:** the dashboard asks for a paid plan to make the rule, and the owner keeps the free one. Until it is set, the API's own limits per address and per number (`src/config/limits.ts`) are what hold a flood off, and they count against the Workers allowance as they refuse; "A flood of requests" (`docs/runbook/cloudflare-plan.md`) is what to do if one gets through.

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

Anything that sends more than 50 API requests in 10 seconds from one address is blocked too. The load test (`scripts/staging/load-test-leads.ts`) sends 50 at once: run it with `--people 20`, or switch the rule off for its run and on again after. If ops working from one office are shown Cloudflare's block page, raise **Requests** rather than delete the rule.

## Before the first production release of Phase 2

Production runs 268eaa4, of 21 September 2026. The next release carries every migration since, and a Worker that binds what production has never had. Before starting `deploy-production.yml`:

1. **What mm-api binds.** Create what step 1 lists and production lacks: `mm-prod-client-photos` and `mm-prod-referral-cards` (open point 86). Then check every bucket with `node --env-file=.env.cf-read scripts/release/check-buckets.ts production --strict`, and every queue with `W queues list`. A missing one stops the release at its upload, before any migration.
2. **Vars and secrets.** `npm run check:config` holds each environment to 64 vars and secrets together (ADR 0009, rule 6). A secret the switched-on providers need must be set before the release (step 7): the Worker refuses to start without it, and Cloudflare refuses the upload.
3. **The apps.** The release passes over an app whose surface is off in production, whether or not it has a Worker there: `mm-app-production` was bootstrapped on 22 September 2026, and until 27 September 2026 the release shipped it and its production build refused the copy still owed (`docs/open-points.md`, item 152). An app is shipped from the release that switches its surface on (step 11).
4. **After the release.** Attach the new consumer with `npm run apply-triggers -- --env production` and check it (step 9). Then the contract step ADR 0070 holds back, dropping the old Zoho token tables, may be merged (`docs/migrations.md`).
