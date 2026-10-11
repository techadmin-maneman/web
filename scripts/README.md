# scripts/

Every script is run from the repository root with `node` (Node 24 runs TypeScript as it is). The shared code is in
`lib/`, and each script's header says how to run it. **Writes** means the script changes something outside the
checkout: a database, an org, Cloudflare or GitHub. A script that reads a secrets file never prints a secret.

| Folder      | Who runs it, and when                                                                      |
| ----------- | ------------------------------------------------------------------------------------------ |
| `dev/`      | a developer, on a laptop, against the local stack (`docs/getting-started.md`)              |
| `build/`    | a developer or CI: builds, and the files generated from the code                           |
| `ci/`       | CI, on every pull request and push (`.github/workflows/ci.yml`)                            |
| `release/`  | the deploy workflows, and the checks before a release, against an environment              |
| `staging/`  | a person, by hand: proofs on staging and in the owner's Zoho org, which write test records |
| `ops/`      | a person, by hand: an environment's setup and its data                                     |
| `fidelity/` | a developer: each screen beside its board (`docs/fidelity-method.md`)                      |

## dev/

| Script               | What it does                                                              | Run as                                     | Writes             |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | ------------------ |
| `dev-all.ts`         | the whole local stack: mm-api, the site and the three apps on their hosts | `npm run dev:all`                          | the local database |
| `dev-api.ts`         | mm-api alone, as `dev:all` starts it                                      | `npm run dev`                              | the local database |
| `ensure-dev-vars.ts` | creates `.dev.vars` from `.dev.vars.example` when it is missing           | `dev:all`, and CI                          | `.dev.vars`        |
| `local.ts`           | the cron, Razorpay's webhook, and a technician's close, locally           | `npm run tick`, `pay:local`, `close:local` | the local database |
| `seed-local.ts`      | enough of the story to click through                                      | `npm run db:seed:local`                    | the local database |
| `serve-*.ts`         | serves a built site or app as its Worker does, `/api/*` passed to mm-api  | `dev:all`, and the browser tests           | no                 |

## build/

| Script                                          | What it does                                                       | Run as                 | Writes                                |
| ----------------------------------------------- | ------------------------------------------------------------------ | ---------------------- | ------------------------------------- |
| `build.ts`                                      | the site for local and staging, and each app for every environment | `npm run build`        | `dist/`                               |
| `build-site.ts`                                 | the public site for one environment                                | `npm run build:site`   | `site/dist/`                          |
| `build-app.ts`, `build-ops.ts`, `build-tech.ts` | one app for one environment, with its budgets                      | `npm run build:<app>`  | `apps/<app>/dist/`                    |
| `dist-hash.ts`                                  | proves a change leaves every site build byte for byte the same     | by hand                | a hashes file                         |
| `export-texts.ts`                               | the texts file the owner marks up                                  | `npm run texts:export` | the texts file                        |
| `generate-adr-index.ts`                         | `docs/decisions/README.md`                                         | `npm run adr-index`    | the index                             |
| `generate-openapi.ts`                           | each surface's OpenAPI document and its Markdown twin              | `npm run openapi`      | `docs/openapi*.json`, `docs/api-*.md` |
| `generate-schema-doc.ts`                        | `docs/schema.md`, from the migrations                              | `npm run schema`       | `docs/schema.md`                      |
| `make-house-card.ts`                            | the house referral card                                            | by hand                | the image                             |
| `subset-fonts.ts`                               | the rupee sign cut out of EB Garamond                              | `npm run fonts`        | the font file                         |

## ci/

| Script                      | What it does                                                              | Run by                           | Writes |
| --------------------------- | ------------------------------------------------------------------------- | -------------------------------- | ------ |
| `already-checked.ts`        | which checks these very files already passed                              | `ci.yml`                         | no     |
| `audit.ts`                  | `npm audit`, with the reviewed allowlist                                  | `npm run audit`, CI              | no     |
| `auto-merge.ts`             | merges a pull request that passed and should merge itself                 | `auto-merge.yml`                 | GitHub |
| `check-migrations.ts`       | the migrations against the rules in `lib/migration-check.ts`              | `npm run check:migrations`       | no     |
| `check-open-points.ts`      | `docs/open-points.md` and every citation of a point                       | `npm run check:open-points`      | no     |
| `check-wrangler-config.ts`  | every environment redeclares its bindings, within the limits              | `npm run check:config`, `ci.yml` | no     |
| `ci-gate.ts`                | fails the gate job unless every job it waits on passed                    | `ci.yml`                         | no     |
| `lighthouse.ts`             | Lighthouse on the built site and the client app                           | `npm run lighthouse`, CI         | no     |
| `old-code-on-new-schema.ts` | the deployed code's Worker tests against the new migrations               | `ci.yml`                         | no     |
| `pr-size.ts`                | warns when a pull request changes more by hand than one review reads well | `ci.yml`                         | no     |

## release/

| Script                     | What it does                                                                  | Run by, with                                                          | Writes                         |
| -------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| `release.ts`               | uploads, deploys and restores Worker versions                                 | the deploy workflows                                                  | Cloudflare                     |
| `mark-database.ts`         | writes the database's identity row, and checks it                             | the deploy workflows, `npm run db:local`                              | the database                   |
| `apply-triggers.ts`        | attaches each Worker's routes, crons and queue consumers                      | `npm run apply-triggers`                                              | Cloudflare                     |
| `check-triggers.ts`        | the triggers Cloudflare has attached, against the config                      | the deploy workflows                                                  | no                             |
| `check-buckets.ts`         | every R2 bucket an environment binds exists                                   | `deploy-staging.yml`                                                  | no                             |
| `check-copy.ts`            | refuses a production release while copy waits for the owner's wording         | `deploy-production.yml`                                               | no                             |
| `smoke.ts`, `smoke-csp.ts` | an environment's routes, versions and content security policy, once deployed  | `npm run smoke`, `smoke:csp`                                          | no                             |
| `soak.ts`                  | judges the production canary on real requests; failing rolls the release back | `deploy-production.yml`                                               | no                             |
| `verify-ci-token.ts`       | an environment's CI secrets have the access the runbook gives them            | `verify-ci-secrets.yml`, `.env.ci-<env>`                              | no                             |
| `restore-carry.ts`         | the carry-back file of a whole-database restore                               | by hand (`docs/runbook.md`)                                           | a SQL file                     |
| `check-books-setup.ts`     | the Books org is set up as invoices need                                      | by hand before a release, `.env.books-scripts`                        | no                             |
| `zoho-contract-probe.ts`   | Zoho still answers as the adapters read it                                    | by hand before a release, `.env.books-scripts` and `.env.crm-scripts` | with `--record`, test fixtures |

## staging/

Each writes **test records**, named "Staging test", on staging or in the owner's real Zoho org.

| Script                      | What it does                                                                                     | With                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `staging-lead.ts`           | books one test consultation through the real API                                                 | `staging-lead.yml`                          |
| `staging-tryon.ts`          | one try-on through the real API                                                                  | `.env.staging-access`                       |
| `load-test-leads.ts`        | M4's load test: 50 bookings at once, and no duplicates                                           | `.env.staging-access`                       |
| `seed-technician-tester.ts` | a technician a real person signs in as, and his jobs; `--clear` takes them out                   | wrangler's login                            |
| `books-proof.ts`            | a customer, an invoice and a payment in Books, then deleted                                      | `.env.books-scripts`                        |
| `staging-records.ts`        | lists what staging wrote into the org; `--delete <file>` deletes what the owner kept on the list | `.env.books-scripts` and `.env.crm-scripts` |
| `ailabtools-probe.ts`       | calls AILabTools through the real adapter                                                        | `.env.worker-staging`                       |

## ops/

| Script                  | What it does                                                              | With                                    | Writes                     |
| ----------------------- | ------------------------------------------------------------------------- | --------------------------------------- | -------------------------- |
| `import-pincodes.ts`    | loads the pincode list into an environment's database                     | the environment's name                  | the database               |
| `import-referrals.ts`   | back-fills the referrals ops logged before January                        | the environment's name, `--file <path>` | the database               |
| `setup-crm.ts`          | the CRM fields and pick-list values the sync writes; `--check` only reads | `.env.crm-scripts`                      | the CRM, without `--check` |
| `check-zoho-setup.ts`   | the CRM org is set up as the sync expects                                 | `.env.crm-scripts`                      | no                         |
| `whatsapp-templates.ts` | each WhatsApp template as it is submitted to MSG91 for approval           | none                                    | no                         |
| `cpu-report.ts`         | mm-api's CPU time over the last day                                       | `deploy-staging.yml`, `.env.cf-read`    | no                         |

## fidelity/

`fidelity.ts` is the harness for the public site; `fidelity-app.ts`, `fidelity-ops.ts`, `fidelity-tech.ts` and
`fidelity-refer.ts` shoot each app's screens beside their boards into `docs/fidelity/` (`npm run fidelity:<app>`).
They write only those images.
