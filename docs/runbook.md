# Runbook

Commands run from the repository root. `W` stands for `node node_modules/wrangler/bin/wrangler.js`. Always pass `--env staging` or `--env production`; the top level of each config is local only.

Everything lives in the Cloudflare account `Tech@maneman.in's Account` (`a2e185075b1b8eef3bee24b72f45ace3`), which holds the `maneman.in` zone.

To run SQL against an environment's database: `W d1 execute maneman-<env> --env <env> --remote --command "<sql>"`, where `maneman-<env>` is `maneman-staging` or `maneman-prod`.

The public site (`mm-site`) is built, edited and published as `docs/frontend.md` describes. Staging serves the site; production serves a placeholder page until the site goes live.

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
| 8. Zoho org, fields, secrets                | done: the real org (ADR 0050)         | done: the real org (ADR 0050)                   |
| 9. Triggers (cron and all three consumers)  | done                                  | done                                            |
| 10. Access bypass for result links          | done                                  | not applicable                                  |
| 11. Phase 2 hosts: DNS, Access              | done                                  | done (all three behind Access until go-live)    |
| 11. Phase 2 surfaces switched on            | done (22 September 2026)              | not yet: waits for the production go-ahead      |
| 11. The client app's Worker, bootstrapped   | done (22 September 2026)              | not yet: waits for the production go-ahead      |
| 7. Worker secrets: login code pepper        | done (22 September 2026)              | not yet: with the client surface                |
| 12. Evolution receipts: token, bypass       | done                                  | not yet                                         |
| 12. Evolution receipts: the webhook         | open: the shared instance's webhook   | not yet                                         |

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
- Workers: role **Editor**, scope **Specified Workers**: every Worker in `scripts/lib/workers.ts`, for that environment: `mm-api-<env>`, `mm-site-<env>`, `mm-app-<env>` and `mm-ops-<env>`. A token can only name a Worker that exists, so a new Worker is added to its token after its bootstrap (step 11); until then its deploy step fails with "No access to the specified service".
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
| `ZOHO_ACCOUNTS_HOST`, `ZOHO_API_HOST`                                       | India data centre: `accounts.zoho.in`, and for the API `www.zohoapis.in`. Both environments use the real org (ADR 0050); a Developer Edition org would answer on `developer.zohoapis.in` instead.                                                                                                                                   |
| `AILAB_API_KEY`                                                             | The environment's AILabTools API key, a separate key per environment where the dashboard allows.                                                                                                                                                                                                                                    |
| `RESULT_SIGNING_KEY`                                                        | 32 or more random characters, generated like `IP_HASH_SALT`. Signs upload and result links; changing it invalidates links already handed out.                                                                                                                                                                                       |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`         | The Evolution API bridge (`docs/decisions/0016-whatsapp-through-evolution.md`). The URL must be public `https://`, reachable from Cloudflare, and include the port if it is not 443: staging's ends in `ts.net:8443`, because port 443 on that host serves another app. `GET /` there should answer "Welcome to the Evolution API". |
| `ERASURE_SECRET`                                                            | 32 or more random characters, generated like `IP_HASH_SALT`. Authorises `POST /api/erasure`. Keep one copy, in the git-ignored `.env.erasure-<env>` file that ops use for erasures ("Erasure within the day").                                                                                                                      |
| `MESSAGING_ALLOWLIST`                                                       | Staging: the founders' mobile numbers, comma-separated. Only these receive messages. A secret, so the numbers stay out of git.                                                                                                                                                                                                      |

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

The Turnstile widgets are `mm-staging` (hostname `staging.maneman.in`) and `mm-production` (`maneman.in`, `www.maneman.in`). The front-end needs their site keys, which are public: `docs/turnstile.md`.

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

2. **Pick-list values.** Lead Status: add `New`, `Waitlist` and `Try-on — delivery only` (with the em dash). Lead Source: add `Booking form`, `Waitlist` and `Try-on`.
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

5. **The route.** After the merge, run `W deploy --env <env>` to attach the new route, since CI never changes routes. Then run the smoke tests against the new host.
6. **The app's own Worker**, where the surface has one: the client app is `mm-app` (docs/decisions/0043-client-app.md) and the ops console is `mm-ops`. Its first deploy is a bootstrap, which also attaches its route; CI deploys it after that.

   ```sh
   npm run build:app -- --env <env>
   W deploy --config apps/app/wrangler.jsonc --env <env> --tag bootstrap

   npm run build:ops -- --env <env>
   W deploy --config apps/ops/wrangler.jsonc --env <env> --tag bootstrap
   ```

### 11a. The client app's login

Before the client surface is switched on in an environment, give its Worker the pepper that login codes are hashed under (docs/decisions/0030-one-time-codes.md): a random value of at least 32 characters, different in each environment.

```sh
openssl rand -hex 32 | W secret put OTP_PEPPER --env <env>
```

Changing it later voids every code in flight; sessions are unaffected. SMS stays off (`SMS_PROVIDER` is `none`) until a DLT-registered provider is set up.

### 11b. Zoho FSM and Books

The client surface reads visits from Zoho FSM and documents from Zoho Books (docs/decisions/0032-fsm-mirror.md). Both are in the real org (ADR 0025, item 26) and share one API client, separate from the CRM's.

1. **The client.** In `https://api-console.zoho.in`, as an administrator of the org: Add Client → Self Client. On **Generate Code**, use the scopes in `docs/phase2-inputs.md`, section 3. Exchange the code for a refresh token within its 10 minutes:

   ```sh
   curl -X POST "https://accounts.zoho.in/oauth/v2/token?grant_type=authorization_code&client_id=<id>&client_secret=<secret>&code=<code>"
   ```

2. **The file.** Put the values in `.env.fsm-<env>`. Git ignores it.

   ```sh
   ZOHO_FSM_CLIENT_ID=...
   ZOHO_FSM_CLIENT_SECRET=...
   ZOHO_FSM_REFRESH_TOKEN=...
   ZOHO_FSM_ACCOUNTS_HOST=accounts.zoho.in
   ZOHO_FSM_API_HOST=www.zohoapis.in
   ZOHO_BOOKS_ORG_ID=...
   ```

   The Books organisation ID is on Books → Settings → Organisation Profile.

3. **The org.** Check it, then create what is missing: a service item for each visit type and the base part, at placeholder prices until the price book is set (`docs/open-points.md`, item 1).

   ```sh
   node --env-file=.env.fsm-<env> scripts/setup-fsm.ts --check
   node --env-file=.env.fsm-<env> scripts/setup-fsm.ts
   ```

4. **The Worker.** Set the three secrets, then set the hosts and `ZOHO_BOOKS_ORG_ID` in `wrangler.jsonc`, with `FSM_PROVIDER` and `BOOKS_PROVIDER` as `zoho`.

   ```sh
   W secret put ZOHO_FSM_CLIENT_ID --env <env>
   W secret put ZOHO_FSM_CLIENT_SECRET --env <env>
   W secret put ZOHO_FSM_REFRESH_TOKEN --env <env>
   ```

   Set the secrets before deploying with the providers switched on: the guard refuses a Worker without them.

5. **The bucket and the queue.** Create both once, before the first deploy that uses them. The photographs bucket gets no lifecycle rule: a client's photograph is only deleted on purpose.

   ```sh
   W r2 bucket create mm-<t>-client-photos
   ```

   Then attach the queue's consumer after that deploy (step 9):

   ```sh
   W queues create mm-fsm-sync-<t>
   npm run apply-triggers -- --env <env>
   ```

6. **FSM's webhook** keeps the mirror current within seconds. Without it, the mirror waits for the reconciliation.
   - **The token.** Make one and set it: `openssl rand -hex 24 | W secret put FSM_WEBHOOK_TOKEN --env <env>`.
   - **The webhook.** In FSM, Setup → Automation → Webhooks → New Webhook:
     - URL: `https://<public host>/api/hooks/fsm/<token>`;
     - method: POST;
     - body: form data, with three parameters from the Service Appointment: `module` (the value `Service_Appointments`), `id` (the appointment's ID), and `modified_time` (its Modified Time).
   - **Photographs.** Until the technician app arrives, technicians attach a visit's photographs to its appointment in FSM, named for their phase and angle: `before-front.jpg`, `before-top.jpg`, `before-left.jpg`, `before-right.jpg`, `before-hair.jpg`, and the same with `after-`. Other attachments are not copied.
   - **The workflow rule.** Setup → Automation → Workflow Rules → Service Appointments → New Rule:
     - when a record is created or edited, and when it is deleted;
     - action: the webhook.
   - **On staging,** the hooks path already has the Access bypass (step 12, point 3).

7. **The refund account.** Payments go to Books by themselves (docs/decisions/0044-payments-mirror.md, "Receipts in Books"). Refunds need the account Books pays them from, which must be a bank account: Books refuses Undeposited Funds.
   - In Books: Banking → Add Bank or Credit Card → Bank, named "Razorpay", in INR.
   - Open it; its ID is the number at the end of the address.
   - Set it as `BOOKS_REFUND_ACCOUNT_ID` in the environment's vars in `wrangler.jsonc`, then deploy. It is not a secret.

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
   - Events: `order.paid`, `payment.authorized`, `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed`.
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

## The CI runner

GitHub Actions jobs run on the owner's machine, in containers (docs/decisions/0006-deployment-pipeline.md, "The runner"). The machine must be on, with Docker Desktop running; the containers start with Docker.

**There are two,** `maneman-runner` (`maneman-pc`) and `maneman-runner-2` (`maneman-pc-2`), each with its own volume. One runner meant a pull request, a deploy and a second pull request waited for each other, half an hour at a time; two run side by side on a twelve-core machine. They share the machine, so a job is slower when both are busy: that is why the worker tests allow thirty seconds each (`vitest.config.ts`), since they write to a real D1 and a slow one is working, not hanging. One CI run is itself six jobs now (docs/decisions/0006-deployment-pipeline.md, "Parallel jobs"), so a single pull request keeps both runners busy, and a third runner would shorten a run further.

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

- **Move the jobs back to GitHub's runners:** `gh variable set CI_RUNNER --body github`. They are then within GitHub's free minutes, which a run spends about twice as fast as it used to: GitHub bills each of the seven jobs a minute at least (docs/decisions/0006-deployment-pipeline.md, "Parallel jobs").
- **After a new runner release,** the agent updates itself; the image's pinned version only matters for a fresh set-up.

## Staying on the free tier

The rules are in `docs/decisions/0009-stay-inside-cloudflare-free-tier.md`. The account is on Workers Free, where everything except R2 stops at its limit instead of billing.

Once, in the Cloudflare dashboard:

1. Billing → Budget alerts: create an alert at the lowest amount offered. Any usage-based charge then emails the billing address.
2. Notifications → Add → Usage-based billing: one notification each for R2 storage (5 GB), R2 Class A operations (500,000) and R2 Class B operations (5,000,000). That is half of each monthly allowance.
3. Billing → Subscriptions should list only free plans. Never upgrade Workers to Paid without a new ADR.

If an R2 alert fires: set `UPLOAD_DAILY_CEILING`, `RENDER_DAILY_CEILING` and `RESULT_READ_DAILY_CEILING` to `"0"` in `wrangler.jsonc` and deploy. New uploads, renders and result reads then answer `busy`. Find the cause before raising them again. `test/node/free-tier-budget.test.ts` refuses any ceiling that could take R2 or Queues past 80% of the free allowance, counting the share set aside for Phase 2 (`docs/decisions/0015-render-pipeline.md`, `docs/decisions/0039-phase-2-budget.md`).

---

## Leads and Zoho

### Checking the lead path on staging

Actions → **staging-lead** → Run workflow, with a city and window. It books a test lead through the real API. The name is "Staging test" and the mobile number is random. Within a minute the lead should be in the real Zoho org (ADR 0050): assigned, with its proposed date, or as Waitlist for Mumbai and Bengaluru. In D1:

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

**A client's account (Phase 2).** A request from the app waits in ops' deletion requests. Processing it runs the same erasure, and also:

- deletes their visit photographs from the client-photos bucket;
- deletes their saved addresses;
- anonymises their FSM contact within a few minutes, through the fsm-sync queue (docs/decisions/0049-dpdp.md).

Check FSM as you check Zoho:

```sql
SELECT erased_at, fsm_erased_at, fsm_erasure_attempts FROM people WHERE id = '<person_id>';
```

A request waiting 5 days alerts ops: process it before its 7 days run out. Invoices stay in Books for 8 years, by law.

---

## The service area and the referral log

**The pincodes we serve** are loaded from `data/pincodes/ncr-pincodes.csv` (docs/decisions/0048-referrals.md). Fill in its `served` and `launch_on` columns, then:

```sh
node scripts/import-pincodes.ts staging --all-served-from 2026-09-22   # staging's placeholder (open point 21)
node scripts/import-pincodes.ts production                             # the file's own columns
```

Run it again whenever the file changes: each pincode's row is replaced.

**Launching a pincode** is ops' own, in the console: it says how many are waiting and how many will be told, then marks the pincode served and sends the alerts, ten a minute. Nobody is told twice.

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
     - revoke client sessions with `UPDATE sessions SET revoked_at = '<now>' WHERE …`.
   - Close the opening. Turn off a surface (`SURFACES` in `wrangler.jsonc`), and roll back a Worker version if a release caused it (below).
2. **Keep the evidence.** Save `wrangler tail` output, the audit log rows (`SELECT * FROM audit_log WHERE created_at > …`), and the provider's own logs, to a private folder (`private/`, git-ignored). Never paste personal data into chat or email.
3. **Assess.**
   - What data, whose, how many people, since when.
   - Whether photographs were involved: they are the most sensitive thing we hold.
   - Write down what you know and what you do not.
4. **Notify.**
   - **The Board,** at once in brief, and in full within 72 hours: what happened, when, the data and people affected, the harm likely, what we have done, and who to contact.
   - **Each person affected,** in plain words on WhatsApp or by phone: what happened to their data, what it may mean for them, what we have done, what they can do, and who to contact.
   - **The Grievance Officer** leads both (`docs/open-points.md`, item 42).
5. **Record.** Keep a note of the breach, the timeline, the decisions and the notices, for the Board and for us. Review it within two weeks, and fix what let it happen.

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
