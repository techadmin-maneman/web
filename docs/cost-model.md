# What a city costs to run

A small monthly model of the costs that grow with cities, clients and staff, beside the plan, reviewed when a city opens and whenever a vendor's price changes. Infrastructure is the small part; messages, renders and seats are what grow.

## The prices

Each vendor's price is in `data/cost-model.json`, with the day it was read and where it came from, before GST. A price marked "confirm" there is from the vendor's published list or a partner's, not yet from our own invoice: replace it with the invoice's figure once one arrives, and change `as_of`.

| Line                         | Counted by                                                    |
| ---------------------------- | ------------------------------------------------------------- |
| Cloudflare Workers Paid      | national, shared by visits                                    |
| Supabase, the reporting copy | national, shared by visits; free to 500 MB                    |
| Zoho Books Professional      | national, shared by visits                                    |
| Zoho CRM Professional        | the city team's seats                                         |
| WhatsApp utility messages    | visits, four each; billed on MSG91 only                       |
| WhatsApp login codes         | leads, one each; billed on MSG91 only                         |
| WhatsApp marketing messages  | the month's launch alerts and campaigns; billed on MSG91 only |
| YouCam looks                 | renders, two units each                                       |
| Google Maps                  | national; nothing within the daily ceilings                   |

Not modelled yet: Zoho Analytics' seats, since its plan is the owner's to set, and the Care number's calls, which the Support build adds.

## Running it

```sh
node scripts/ops/cost-model.ts --visits 400 --leads 300 --renders 600 --seats 2 --share 0.25
```

`--share` is the city's part of every city's visits, which it carries of the national lines; `--bridge` prices WhatsApp as the Evolution bridge does, at nothing. It prints each line, the month's total and the cost a visit. The figures a visit, a lead and a seat send are in `scripts/lib/cost-model.ts` (`CITY_MONTH_DEFAULTS`): four utility messages a visit (its booking, a reminder, the arrival, a check-in) and one login code a lead.

## When to look again

- **A city opens**: run it with the city's plan, and keep the figures beside its targets.
- **MSG91 goes live**: messages start to bill; run it without `--bridge`.
- **A vendor's invoice arrives**: put its figure in `data/cost-model.json`.
