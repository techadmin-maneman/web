# 0226. The console's frame, to the November redesign

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0225](0225-the-console-on-a-desk-and-a-phone.md) with the frame's step

## Context

The second of the redesign's eight steps (ADR 0225): the frame every page stands in. The design draws the navigation in four groups with the person signed in at its foot; a header of where the page sits, a search, the city and Book a visit; and on a phone a tab bar on the ink with More for the rest, the search and the account in the page's head, and the city as chips under Today's and Dispatch's titles.

## Decision

1. **The navigation** groups its entries as the brief names them, Settings in the last group, the person signed in at its foot. Its entries keep their counts.
2. **The search** is a box in the header, which "/" takes the keyboard to from anywhere but another box, its results opening beneath it: clients by name or mobile, technicians, then the pages the person may open, Settings' among them, each page found by its own name. Ctrl K and the dialog it opened are gone. On a phone a search button opens it as a sheet.
3. **The city** is chosen in the header, from "All cities" and each city served or with a technician at work, as the dispatch board offers them, which `GET /api/whoami` now names. The choice is the person's, kept in this browser under their e-mail, and narrows Dispatch, Clients, Technicians and Technician pay, whose own city boxes are gone. The other screens take it as their steps rebuild them.
4. **On a phone** the navigation gives way to a tab bar of Today, Tasks, Dispatch and Messages, with how many wait in each, and More, a page of the rest under the same groups, with the city's chips; More is current wherever a page the tab bar has no tab for is open.

## Where the build departs from the files, and why

- **Mine stays in the header,** beside the city: the tasks given to the person signed in, with how many are new to them. The design draws nowhere for it, and without it a person given a task is told nothing. The owner may rule it away once Tasks' own filter for "mine" is built (step 3).
- **The navigation's fold stays in its foot,** above the person signed in. The design draws no fold; a person who folded the navigation keeps the room they asked for.
- **Book a visit is not yet in the header.** It opens the booking drawer that step 4 rebuilds, which needs a client chosen first; it joins the header with it.
- **The search finds no piece numbers, and lists no actions.** `POST /api/clients/find` takes a name or a mobile number alone, and the console has no action to list yet; both wait for the owner.
- **The city picker shows no figure beside each city.** The API sends none, such as technicians working, and none is made up.

## Consequences

- `GET /api/whoami` reads the cities on each load of the console: one read of the cities table, a handful of rows. The search reads the technicians' roster once, when something is first typed, never as a page opens.
- A link that names a city, as Dispatch's address once did, no longer changes it; the address still says which city the board shows.
