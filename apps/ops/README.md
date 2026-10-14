# The ops console

Ops' desk tool, behind Cloudflare Access (docs/decisions/0031-access-and-audit.md). Each section of the navigation is a
folder of `src/`, named as its path is, and makes its calls through that folder's own module, `<folder>-api.ts`; the
calls several sections share, the client itself, and the types the answers are named by are `src/api.ts`.

| Section            | Path                                    | Folder                                                              | Its calls                                 |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| Tasks              | `/tasks`                                | `tasks/`                                                            | `tasks-api.ts`, and `api.ts`'s `tasks`    |
| Dispatch           | `/dispatch`                             | `dispatch/`                                                         | `dispatch-api.ts`                         |
| Technicians        | `/technicians`, `/technicians/:id/:tab` | `technicians/`                                                      | `technicians-api.ts`                      |
| Stock              | `/stock`                                | `stock/`                                                            | `stock-api.ts`, and `api.ts`'s `stock`    |
| Counts             | `/counts`                               | `counts/`                                                           | `counts-api.ts`                           |
| Usage              | `/usage`                                | `usage/`                                                            | `usage-api.ts`                            |
| Quality            | `/quality`                              | `quality/`                                                          | `quality-api.ts`                          |
| Purchasing         | `/purchasing`                           | `purchasing/`                                                       | `purchasing-api.ts`                       |
| Supply plan        | `/supply-plan`                          | `supply-plan/`                                                      | `supply-plan-api.ts`                      |
| Items              | `/items`                                | `items/`                                                            | `items-api.ts`                            |
| Suppliers          | `/suppliers`                            | `suppliers/`                                                        | `suppliers-api.ts`                        |
| Clients            | `/clients`, `/clients/:id/:tab`         | `clients/`                                                          | `clients-api.ts`, and `api.ts`'s `client` |
| Messages           | `/messages`                             | `care/`                                                             | `care-api.ts`                             |
| Care settings      | `/care-settings`                        | `care/`                                                             | `care-api.ts`                             |
| Care numbers       | `/care-numbers`                         | `care/`                                                             | `care-api.ts`                             |
| Concerns           | `/grievances`                           | `grievances/`                                                       | `grievances-api.ts`                       |
| Number changes     | `/number-changes`                       | `number-changes/`                                                   | `number-changes-api.ts`                   |
| Deletion requests  | `/deletion-requests`                    | `deletion-requests/`                                                | `deletion-requests-api.ts`                |
| Charges            | `/payments`                             | `payments/`                                                         | `payments-api.ts`                         |
| Prices             | `/prices`                               | `prices/`                                                           | `prices-api.ts`                           |
| Discount codes     | `/discount-codes`                       | `discount-codes/`                                                   | `discount-codes-api.ts`                   |
| Technician pay     | `/technician-pay`                       | `technician-pay/`                                                   | `technician-pay-api.ts`                   |
| Partner commission | `/partner-commission`                   | `partner-commission/`                                               | `partner-commission-api.ts`               |
| Referrals          | `/referrals`                            | `referrals/`, the partners included                                 | `referrals-api.ts`                        |
| Areas              | `/areas`, `/areas/:tab`                 | `areas/`                                                            | `areas-api.ts`                            |
| Spend              | `/spend`                                | `spend/`                                                            | `spend-api.ts`                            |
| Words              | `/words`                                | `words/`                                                            | `words-api.ts`                            |
| Settings           | `/settings`, `/settings/:tab`           | `settings/`: the rules, blackout days, the job sheet, and the forms | `settings-api.ts`                         |
| Staff              | `/staff`                                | `staff/`                                                            | `staff-api.ts`                            |
| Cities             | `/cities`                               | `cities/`                                                           | `cities-api.ts`                           |
| Targets            | `/targets`                              | `targets/`                                                          | `targets-api.ts`                          |
| Activity           | `/activity`                             | `activity/`                                                         | `activity-api.ts`                         |

What every section shares sits beside them: `components/` (the frame, `Refusal`, `RowHead`, `FormActions` and the
shared form sheet), `lib/` (access, the page read again, a write's shape), `states/`, `styles/` (the console's tokens)
and `content/` (every word, one file a feature). A section reads another's code only through that folder's
`index.ts`, which says what it offers (test/node/architecture/feature-imports.test.ts). `kit/` is the local-only page
of every shared part, as the console draws it.
