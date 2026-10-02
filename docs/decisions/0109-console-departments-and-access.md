# 0109. The console by departments, and who may do what in it

- Status: accepted, on the owner's ruling of 2 October 2026 (audit decision 18, and its design answers); amended the same day for the navigation
- Date: 2026-10-02

## Context

Until now anyone Cloudflare Access let into the ops console could do everything in it (ADR 0031). The 2 October audit proposed regrouping the console's twelve flat sections (finding OIA-01). The owner asked for more: "Design it better, by departments. Build in access control at city (and zone/national) and department level so that data is shown to people with right level of access." His answers to the design questions are the rules below.

## Decision

**Five departments.** Each section of the console, and each route behind it, belongs to one.

| Department    | What it holds                                                                                                        | Its sections in the console                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Operations    | Dispatch, today's tasks, visits, technicians and their leave and phones, stock, held bookings re-tried               | Tasks, Dispatch, Technicians, Stock                    |
| Customer Care | Clients (record, photos, consents, pieces, hair profile, a phoned-in address), grievances, number changes, deletions | Clients, Grievances, Number changes, Deletion requests |
| Finance       | Payments, refunds, no-show charges and their disputes, credits, discount codes, prices                               | No-shows, Prices, Discount codes                       |
| Growth        | Referrals and invites, the waitlist, the service area and launching it                                               | Referrals, Waitlist, Service area                      |
| Admin         | Settings (rules, services, blackout days, day times, consumables, job sheet, storage), staff and access              | Settings, Staff                                        |

**Three levels, each including the ones below it.**

- **View** sees the department's data in the person's places: every read, client search, and opening a client's photos (still audited one opening at a time).
- **Act** does the day's work: assigning and moving visits, telling a client by phone, taking and closing tasks, retrying, stopping or linking a held booking, leave, revoking a phone, stock movements, correcting a hair profile, saving an address given by phone, answering a grievance, deciding a number change, charging a no-show, upholding a disputed charge, entering a discount code on a visit, deciding a referral, attaching an invite.
- **Manage** also moves money back or waives it, and sets what everyone else works within: refunding a held booking or a disputed charge, waiving a no-show, adjusting credits, prices, making or switching off discount codes, every setting, the service area and launches, deleting an account, and granting access.

Every route's department and lowest level is one table, `ROUTE_NEEDS` in `src/policy/console-routes.ts`. A test holds it to the API: a route with no line there fails CI, because the Staff list would refuse it to everyone. Where one route does both an Act and a Manage thing, the route asks Act and asks Manage inside it for the money: waiving a no-show (`WAIVING_A_NO_SHOW`) and refunding a disputed charge (`REFUNDING_A_DISPUTE`).

**Geography: National, Zone, City.** A zone is a region made of cities: NCR is Delhi, Gurgaon, Noida, Ghaziabad and Faridabad (table `zones`, and `cities.zone`). A national grant reaches everything; a zone grant its zone and its cities; a city grant that city. A city in no zone (Mumbai, Bengaluru today) is reached only nationally or by its own name.

**A grant is a department, at a level, over a place.** A person may hold several: Finance · Act · Delhi and Operations · View · NCR zone, say. The rules are `src/policy/access.ts`.

**The Staff page** (Admin › Staff) lists each person by their Access e-mail, their grants, and whether they are let in, beside the switch that enforces the list and the service tokens let in.

- Admin View sees the people with a grant in their places, and those with none yet; national Admin View sees everyone and the tokens.
- Admin Manage may give or take away a grant only within their own places, and may switch a person off only with Admin Manage over every place that person holds. A person is never deleted: switched off, they keep their grants and are let in nowhere.
- Somebody must always hold Admin · Manage nationally: a change that would leave nobody with it is refused (`last_admin`). A list with nobody yet, as a new environment's, may be built from nothing.
- Only a person with Admin · Manage nationally may start or stop enforcing, or change the service tokens, even while it is off: nobody can lock themselves out, and no token lets another in.

**Deny by default.** Once enforced:

- A person Access lets in who is not on the list, or is switched off, is refused everything (`403 not_permitted`) except `GET /api/whoami`, which tells the console to say so, and the health check.
- A route `ROUTE_NEEDS` does not list is refused. HEAD asks what GET asks, as Hono answers it with the GET route.
- A route needs a **national** grant until it keeps its lists and records to the caller's own places (`ownPlaces` in the table). Today only the Staff routes do. So a city or zone grant opens nothing else yet: it never shows a city lead another city's clients.

**The owner is the national super-admin:** every department at Manage, nationally.

**Service tokens** (CI, the audit tooling) are not people. An explicit list, `staff_service_tokens`, lets a token in as every caller was before; a token not on it is refused once the list is enforced. Access is given by a person: a token cannot change the Staff list or the tokens, even while the list is not enforced.

**How geography will narrow every list and record.** Each record's place is a city, found through a pincode (`serviceable_pincodes.city`), then that city's zone:

- a client: the pincode of their current address, or before they have one, the pincode they booked or joined the waitlist with;
- a visit, a hold, a payment, a refund, a no-show and its dispute: the pincode of the visit's address;
- a grievance, a number change, a deletion request, a referral: the client's;
- a waitlist entry and a launch: its own pincode;
- a technician and a kit: the city set on the technician (a column to add), until then national only;
- a task: its group's department, and its record's city;
- a setting, a price, a code, a service, a consumable, the job sheet, a blackout day, the day times: national. View may read them from any place; changing them needs a national grant.

A record whose city cannot be found is shown only to national grants. Each route that narrows its reads and writes this way changes its line in `ROUTE_NEEDS` to `ownPlaces`, with a test that a city grant sees its own city's records and not another's.

**Enforcement is a switch.** `staff_access_mode` holds it, off to begin with. Off, nothing is refused but the switch, the tokens and a token's change to the list (above), and each call the list would have refused is logged (`staff_access_would_refuse`, with the route and what it asked; the call's `ops.call` audit entry, under the same request ID, names the person). On, it is refused (`staff_access_refused`) after its audit entry is written. Every change to the list, the switch or the tokens is audited under the person who made it (`staff.set`, `staff.enforce`, `staff.token_add`, `staff.token_remove`).

## Seeded so that nobody is locked out

Migration 0069 lists every person in the ops audit log (Access e-mails, `actor_kind = 'staff'`) with every department at Manage, nationally, and puts every service token in it (`actor_kind = 'service'`) on the token list, never on the Staff list. On staging that is one person and the CI token.

## Rollout

1. This change: the tables, the seed, the check on every call with enforcement off, the would-refuse log, and the Staff page.
2. The owner opens Admin › Staff on `ops-staging.maneman.in`, adds everyone else who uses the console with their grants (they also need to be on the Access application's Allow policy), and checks the list. We read the would-refuse log for those days and correct the table where a rightful call would be refused.
3. The owner presses "Start enforcing".
4. The navigation grouped by department, showing only what the person may open (below, amended 2 October 2026). Next: Tasks narrowed to each department's groups; and the lists and records narrowed by place, area by area, each flipping its routes to `ownPlaces`.
5. Production, when its console is switched on: its audit log has no ops calls, so the list starts empty and off. The owner signs in, adds himself and the others, adds `mm-ci-production` to the tokens, and starts enforcing before anyone beyond the founders is given Access.

## The navigation (amended 2 October 2026)

- The console's sections stand under their departments, in the table's order: Operations, Customer Care, Finance, Growth, Admin. Tasks comes first, and the console opens on it.
- Prices, Discount codes, Service area and Staff were tabs of Settings and are now sections of their own departments. Their old addresses (`/settings/prices`, `/settings/discount-codes`, `/settings/area`, `/settings/staff`) open the new ones.
- `GET /api/whoami` names the routes the caller's calls go ahead on (`may_call`, every route while the list is not enforced). The navigation shows a section only when the call its page opens with is among them; a department with none is left out. A page opened by its address that the person may not open says so. A person who may not open Tasks lands on the first section they may.
- Reading the price book (`GET /api/services`) is Finance View, as reading prices is; changing a service stays Admin Manage.
- Each section shows how many tasks wait in it, from the one task board: Tasks all of them, and each other section the groups it decides (`apps/ops/src/tasks/decided.ts`). The count is filled when any of them is overdue.
- A new page moves the keyboard to its heading, and "Skip to content" is the first stop on every page.
- The sidebar's own title, which the boards letter "Operations", reads "Console" until the owner names it, since Operations is now one department beneath it.

## Consequences

- Every ops call reads three small things more: the switch, the caller's row with their grants (or the token's), and the zoned cities.
- `GET /api/whoami` also says whether the list is enforced, whether the caller is on it, their grants and the routes open to them, so the console can say "You are not on the Staff list" and hide what the caller may not open.
- The contract gains the codes `not_permitted` and `last_admin`.
- Every word of the Staff page is a placeholder until the owner gives his.
