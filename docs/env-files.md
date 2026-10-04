# Env files

A script that reaches a real service reads its secrets from a git-ignored file at the repository root, passed as `node --env-file=.env.<name> scripts/<script>.ts`. Each file has a committed template, `.env.<name>.example`, with its names and no values: copy it to `.env.<name>` and fill it in. Never commit a value, never print one, and never paste one into a terminal: a script reads the file, and nothing else does.

| File                     | Read by                                                                                         | Where the values come from                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `.env.staging-access`    | `staging-tryon.ts`, `load-test-leads.ts`, `smoke-csp.ts`, and any call to staging's API by hand | The staging service token: Zero Trust → Access → Service tokens (`docs/runbook.md`, step 3) |
| `.env.production-access` | The production smoke and erasure scripts                                                        | The production service token, the same way; the owner's to hand out                         |
| `.env.ci-staging`        | `verify-ci-token.ts staging`                                                                    | The same values GitHub's staging secrets hold (`docs/runbook.md`, step 6)                   |
| `.env.ci-production`     | `verify-ci-token.ts production`                                                                 | The same values GitHub's production secrets hold                                            |
| `.env.cf-read`           | `cpu-report.ts`, `check-triggers.ts`                                                            | A Cloudflare API token that reads Workers analytics, Workers and Queues, nothing more       |
| `.env.crm-staging`       | `setup-crm.ts`                                                                                  | Staging's Zoho CRM Self Client (`docs/runbook.md`, step 8)                                  |
| `.env.crm-scripts`       | `staging-records.ts`, `zoho-contract-probe.ts`, the CRM's other scripts                         | The same Self Client, with the scripts' own refresh token, never the Worker's               |
| `.env.books-scripts`     | `check-books-setup.ts`, `books-proof.ts`, `staging-records.ts`, `zoho-contract-probe.ts`        | Zoho Books' Self Client, with the scripts' own refresh token                                |
| `.env.staging-test-code` | Scripts that sign in as a staging test record                                                   | The code set in staging's `STAGING_TEST_RECORD_CODE` (`docs/runbook.md`)                    |

**The Worker's own secrets** are not kept in a file. They are set with `wrangler secret put` (or `secret bulk` from a file deleted straight after, `docs/runbook.md`, step 7), and their names are the ones `.dev.vars.example` lists for a local run.

**Locally** no file is needed: `npm run dev` and `npm run dev:all` run every vendor as a stub, and `.dev.vars` is made from `.dev.vars.example` the first time.
