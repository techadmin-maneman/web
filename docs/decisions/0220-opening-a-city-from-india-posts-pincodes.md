# 0220. Opening a city from India Post's pincodes

- Status: accepted
- Date: 2026-10-25
- Topic: The ops console
- Amends [0061](0061-ops-editable-inputs.md)

## Context

The service area held NCR's 198 pincodes, loaded once from `data/pincodes/ncr-pincodes.csv`. A city outside NCR could
be added in the console, but its pincodes could not: ops typed each one, with its area's name, one at a time, under
Areas › Served. A city has between 30 and 170 pincodes, so opening one meant an afternoon of typing, and the names were
whatever ops thought of.

The owner approved a four-part plan to make the service area world class on 25 October 2026: the directory, launch
records, a map of reach, and demand. This is the first part.

## Decision

1. **India Post's whole directory is kept in D1** as `pincode_directory` (migration 0196): every pincode in India, its
   district and state as the delivering office has them, its post offices, and a point. It is reference data, holds
   nobody's data, and the app reads nothing else from it. `scripts/ops/fetch-pincode-directory.ts` fetches it from
   data.gov.in with a registered key kept in `.env.data-gov`, which is never committed;
   `scripts/ops/load-pincode-directory.ts` loads it into an environment. The file is
   `data/pincodes/india-pincodes.csv`, refreshed each quarter.
2. **Ops open a city by district,** in Areas › Served, "Add pincodes by district": a state, up to ten of its districts,
   then their pincodes with what each area would be called and whether we hold it already. Those not held are ticked;
   ops untick what they do not want, choose one of our cities and add them. They are added unserved, so serving any of
   them is still the table's step, which says who it would message first (ADR 0071).
3. **An area's name comes from its post offices,** the shortest of them, fitted to what the API takes. A name left as
   the directory suggests it is not recorded as ops' (`area_named_by` is null), so clients are not shown it until ops
   name it, as for a pincode the NCR file loaded (src/policy/area-names.ts).
4. **The service-area CSV can add pincodes.** A row for a pincode we do not hold, with a `city`, is added from the
   directory before the file's changes are read, with the file's `area` where the API would take it. The file is then
   read again against the table that holds them, so its `served` and `launch_on` go through the same preview and
   launch panel as any other row.
5. **The API adds at most 300 pincodes a call,** which keeps a call within D1's queries a request; the console sends
   larger choices in runs. A pincode the directory does not list is not added, and is named back so ops can add it by
   hand.

## Consequences

- Production needs the directory loaded after migration 0196 deploys: `node scripts/ops/load-pincode-directory.ts
production`. Staging likewise.
- A pincode India Post adds after the last refresh is not offered until the next one; ops add it by hand meanwhile.
- The NCR file and its import stay as they are; the directory does not change a pincode we hold.
