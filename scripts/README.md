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

| Script               | What it does                                                                                             | Run as                                                      | Writes             |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------ |
| `dev-all.ts`         | the whole local stack: mm-api, the site and the three apps on their hosts                                | `npm run dev:all`                                           | the local database |
| `dev-api.ts`         | mm-api alone, as `dev:all` starts it                                                                     | `npm run dev`                                               | the local database |
| `e2e-videos.ts`      | every browser test recorded, for an audit: videos/ by client, technician and staff department            | `npm run e2e:videos`                                        | `videos/`          |
| `ensure-dev-vars.ts` | creates `.dev.vars` from `.dev.vars.example` when it is missing                                          | `dev:all`, and CI                                           | `.dev.vars`        |
| `local.ts`           | the cron, Razorpay's webhook, a technician's close and a client's WhatsApp message, locally              | `npm run tick`, `pay:local`, `close:local`, `message:local` | the local database |
| `seed-local.ts`      | enough of the story to click through, with a supplier, an order and two chats (`seed-stock-and-care.ts`) | `npm run db:seed:local`                                     | the local database |
| `serve-*.ts`         | serves a built site or app as its Worker does, `/api/*` passed to mm-api                                 | `dev:all`, and the browser tests                            | no                 |

## build/

| Script                                          | What it does                                                                | Run as                   | Writes                                |
| ----------------------------------------------- | --------------------------------------------------------------------------- | ------------------------ | ------------------------------------- |
| `app-vite-config.ts`                            | what the three apps' Vite builds share, which each app's config calls       | each app's Vite config   | no                                    |
| `build.ts`                                      | the site and each app for every environment, then each Worker's dry run     | `npm run build`          | `dist/`                               |
| `build-site.ts`                                 | the public site for one environment                                         | `npm run build:site`     | `site/dist/`                          |
| `coming-soon.ts`                                | production's coming-soon page, until the site goes live there               | `build-site.ts`          | `site/dist/production`                |
| `build-app.ts`, `build-ops.ts`, `build-tech.ts` | one app for one environment, with its budgets                               | `npm run build:<app>`    | `apps/<app>/dist/`                    |
| `dist-hash.ts`                                  | proves a change leaves every site build byte for byte the same              | by hand                  | a hashes file                         |
| `export-texts.ts`                               | the texts file the owner marks up                                           | `npm run texts:export`   | the texts file                        |
| `generate-adr-index.ts`                         | `docs/decisions/README.md`                                                  | `npm run adr-index`      | the index                             |
| `generate-openapi.ts`                           | each surface's OpenAPI document and its Markdown twin                       | `npm run openapi`        | `docs/openapi*.json`, `docs/api-*.md` |
| `generate-schema-doc.ts`                        | `docs/schema.md`, from the migrations                                       | `npm run schema`         | `docs/schema.md`                      |
| `generate-settings-doc.ts`                      | `docs/settings.md`, every setting and where it lives                        | `npm run settings`       | `docs/settings.md`                    |
| `generate-upkeep-sql.ts`                        | the SQL the seeds run after the visits they write, from the domain's upkeep | `npm run upkeep-sql`     | `scripts/lib/every-visit-upkeep.ts`   |
| `make-house-card.ts`                            | the house referral card                                                     | by hand                  | the image                             |
| `rules-alias.ts`                                | `@rules/`, the front ends' way into the backend's shared rules              | each bundler's config    | no                                    |
| `subset-fonts.ts`                               | the rupee sign cut out of EB Garamond                                       | `npm run fonts`          | the font file                         |
| `generate-words.ts`                             | `src/config/words.json`, every line the Words page may change               | `npm run words`          | `src/config/words.json`               |
| `words-reviewed.ts`                             | marks every Words line reviewed in its wording now, after a copy review     | `npm run words:reviewed` | `src/config/words-reviewed.json`      |

## ci/

| Script                      | What it does                                                                                                                       | Run by                           | Writes |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------ |
| `already-checked.ts`        | which checks these very files already passed                                                                                       | `ci.yml`                         | no     |
| `audit.ts`                  | `npm audit`, with the reviewed allowlist                                                                                           | `npm run audit`, CI              | no     |
| `auto-merge.ts`             | merges a pull request that passed and should merge itself                                                                          | `auto-merge.yml`                 | GitHub |
| `production-pages.ts`       | production's built pages opened in Chromium from a local server, failing on an error                                               | `npm run build` first            | no     |
| `site-production-gate.ts`   | the production site built as it will go live: refused only on what waits for approval, or built with none of the design's material | CI's build job                   | no     |
| `check-migrations.ts`       | the migrations against the rules in `lib/migration-check.ts`                                                                       | `npm run check:migrations`       | no     |
| `check-open-points.ts`      | `docs/open-points.md` and every citation of a point                                                                                | `npm run check:open-points`      | no     |
| `check-wrangler-config.ts`  | every environment redeclares its bindings, within the limits                                                                       | `npm run check:config`, `ci.yml` | no     |
| `ci-gate.ts`                | fails the gate job unless every job it waits on passed                                                                             | `ci.yml`                         | no     |
| `lighthouse.ts`             | Lighthouse on the built site and the client app                                                                                    | `npm run lighthouse`, CI         | no     |
| `lint.ts`                   | ESLint in four runs, each holding its own part's TypeScript projects                                                               | `npm run lint`, CI               | no     |
| `old-code-on-new-schema.ts` | the deployed code's Worker tests against the new migrations                                                                        | `ci.yml`                         | no     |
| `pr-size.ts`                | warns when a pull request changes more by hand than one review reads well                                                          | `ci.yml`                         | no     |

## release/

| Script                     | What it does                                                                   | Run by, with                                                          | Writes                           |
| -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------- |
| `release.ts`               | uploads, deploys and restores Worker versions                                  | the deploy workflows                                                  | Cloudflare                       |
| `mark-database.ts`         | writes the database's identity row, and checks it                              | the deploy workflows, `npm run db:local`                              | the database                     |
| `apply-triggers.ts`        | attaches each Worker's routes, crons and queue consumers                       | `npm run apply-triggers`                                              | Cloudflare                       |
| `check-triggers.ts`        | the triggers Cloudflare has attached, against the config                       | the deploy workflows                                                  | no                               |
| `check-buckets.ts`         | every R2 bucket an environment binds exists                                    | `deploy-staging.yml`                                                  | no                               |
| `check-copy.ts`            | refuses a production release while copy waits for the owner's wording          | `deploy-production.yml`                                               | no                               |
| `smoke.ts`, `smoke-csp.ts` | an environment's routes, versions and content security policy, once deployed   | `npm run smoke`, `smoke:csp`                                          | no                               |
| `money-path.ts`            | a client holds a window on staging, starts its payment and lets it go, nightly | `watch-money-path.yml`, `npm run watch:money-path`                    | a test client's session and hold |
| `soak.ts`                  | judges the production canary on real requests; failing rolls the release back  | `deploy-production.yml`                                               | no                               |
| `verify-ci-token.ts`       | an environment's CI secrets have the access the runbook gives them             | `verify-ci-secrets.yml`, `.env.ci-<env>`                              | no                               |
| `restore-carry.ts`         | the carry-back file of a whole-database restore                                | by hand (`docs/runbook.md`)                                           | a SQL file                       |
| `check-books-setup.ts`     | the Books org is set up as invoices need                                       | by hand before a release, `.env.books-scripts`                        | no                               |
| `zoho-contract-probe.ts`   | Zoho still answers as the adapters read it                                     | by hand before a release, `.env.books-scripts` and `.env.crm-scripts` | with `--record`, test fixtures   |

## staging/

Each writes **test records**, named "Staging test", on staging or in the owner's real Zoho org.

| Script                      | What it does                                                                                     | With                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `staging-lead.ts`           | books one test consultation through the real API                                                 | `staging-lead.yml`                          |
| `staging-tryon.ts`          | one try-on through the real API                                                                  | `.env.staging-access`                       |
| `youcam-probe.ts`           | every look on one photograph, through the real adapter: the time and units each                  | a file holding `YOUCAM_API_KEY`             |
| `load-test-leads.ts`        | M4's load test: 50 bookings at once, and no duplicates                                           | `.env.staging-access`                       |
| `seed-technician-tester.ts` | a technician a real person signs in as, and their jobs; `--clear` takes them out                 | wrangler's login                            |
| `books-proof.ts`            | a customer, an invoice and a payment in Books, then deleted                                      | `.env.books-scripts`                        |
| `staging-records.ts`        | lists what staging wrote into the org; `--delete <file>` deletes what the owner kept on the list | `.env.books-scripts` and `.env.crm-scripts` |

## ops/

| Script                   | What it does                                                                                                                                                        | With                                                                 | Writes                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| `import-pincodes.ts`     | loads the pincode list into an environment's database                                                                                                               | the environment's name                                               | the database                        |
| `import-referrals.ts`    | back-fills the referrals ops logged before January                                                                                                                  | the environment's name, `--file <path>`                              | the database                        |
| `setup-crm.ts`           | the CRM fields and pick-list values the sync writes; `--check` only reads                                                                                           | `.env.crm-scripts`                                                   | the CRM, without `--check`          |
| `check-zoho-setup.ts`    | the CRM org is set up as the sync expects                                                                                                                           | `.env.crm-scripts`                                                   | no                                  |
| `backup-keys.ts`         | the key pair the weekly backup is encrypted to: prints the public key, writes the private one                                                                       | `--private <file>`                                                   | the file                            |
| `backup-now.ts`          | a backup written now by the weekly job's own code, under today's date                                                                                               | `--env`, `--public-key <file>`; wrangler signed in                   | the backups bucket                  |
| `restore-backup.ts`      | a weekly backup downloaded and decrypted into SQL                                                                                                                   | `--env`, `--date`, `--key`, `--out`; wrangler signed in              | the SQL file                        |
| `whatsapp-templates.ts`  | each WhatsApp template as it is submitted to MSG91 for approval                                                                                                     | none                                                                 | no                                  |
| `cpu-report.ts`          | mm-api's CPU time over the last day                                                                                                                                 | `deploy-staging.yml`, `.env.cf-read`                                 | no                                  |
| `table-sizes.ts`         | each table's rows in an environment's database, the largest first                                                                                                   | `--env`, `--top`; wrangler signed in                                 | no                                  |
| `cost-model.ts`          | a city's month costed from the vendors' prices in `data/cost-model.json`                                                                                            | `--visits`, `--leads`, `--renders`, `--seats`, `--share`, `--bridge` | no                                  |
| `analytics-first-run.ts` | one of every record copied into the reporting copy twice, read back through Zoho's login, then taken out                                                            | `.env.analytics-supabase`                                            | the reporting copy, then empties it |
| `warehouse-migrate.ts`   | the reporting copy's migrations (`warehouse/migrations`) it has not had; `--mark-applied <name>` for a schema made by hand, once it matches; `--pending` lists them | `.env.analytics-supabase` (`WAREHOUSE_ADMIN_URL`)                    | the reporting copy's schema         |
| `warehouse-check.ts`     | whether the reporting copy's schema is what its migrations make                                                                                                     | `.env.analytics-supabase`                                            | no                                  |

## fidelity/

`fidelity.ts` is the harness for the public site; `fidelity-app.ts`, `fidelity-ops.ts`, `fidelity-tech.ts` and
`fidelity-refer.ts` shoot each app's screens beside their boards into `docs/fidelity/` (`npm run fidelity:<app>`), and
`fidelity-kit.ts` shoots the console's kit, every shared part in its states, after the console's pairs. They write
only those images. `fidelity-app-login.ts` holds the login's code as board A2 draws it, for `fidelity-app.ts`.
