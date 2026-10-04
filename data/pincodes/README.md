# NCR pincodes

`ncr-pincodes.csv` lists the 198 pincodes of the five cities Phase 1 serves: Delhi 103, Gurgaon 29, Noida 26, Ghaziabad 25 and Faridabad 15. It is the starting point for the service area (`docs/archive/phase2-inputs.md`, section 7), which P2-M3's `serviceable_pincodes` table is loaded from.

## The columns

One row per pincode. The header names the columns and `scripts/import-pincodes.ts` finds them by name, so the order does not matter and the names have to match exactly.

| Column                  | What it holds                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pincode`               | The six digits. One row each, and the row's identity: do not change one                                                                                                      |
| `city`                  | Delhi, Gurgaon, Noida, Ghaziabad or Faridabad                                                                                                                                |
| `district`              | The delivering office's district, from the directory. Not used by the app                                                                                                    |
| `state`                 | Delhi, Haryana or Uttar Pradesh. Not used by the app                                                                                                                         |
| `office_names`          | The post offices in that pincode, separated by semicolons. The app names the area from the shortest of them, so a client sees "Saket" and not "Distt Court Complex Saket SO" |
| `latitude`, `longitude` | The delivering office's point, for a rough map only. Never used to measure a distance                                                                                        |
| **`served`**            | **Yours to fill in.** `yes` if a technician goes there; anything else, including blank, means not served                                                                     |
| **`launch_on`**         | **Yours to fill in.** The date that pincode started, or is planned to start                                                                                                  |

**What `served` decides:** whether the app offers a booking at that pincode at all. A client at a pincode that is not served is offered the waitlist instead, and one at a pincode that is not in this file at all is treated the same way.

**What a date in `launch_on` means:** the day a technician started coming, or will start. It is read as midnight in India on that day. It does **not** hold booking back — `served` alone does that — so a pincode marked `yes` with a date next month takes bookings today. What the date is for is the waitlist: an invite sent to someone who waited for that area lapses twelve months after it launched, and that clock starts here.

**Write the date as `2026-10-01`** — the year, the month, then the day. Excel and Google Sheets like to turn a date cell into `01-10-2026` or `1 Oct 2026` when they save, and the import stops with an error rather than guess which is the month. If your spreadsheet keeps changing it, format the two columns as plain text before you type in them, then save as CSV.

Leave a pincode you have not decided on blank in both columns. Blank is "not served", which is the safe answer.

**Uploading the file in the ops console** (Areas › Served) reads the same two columns, and is stricter than the import: the file must have `pincode`, `served` and `launch_on` columns, `served` may be yes, y, true or 1 for served and no, n, false, 0 or blank for not, and any other word stops the upload with its pincode. What the file would change is shown pincode by pincode before anything is saved. The console will not serve a pincode from a day still to come: leave it unserved until its day. The list the console downloads writes `yes` or `no`.

**An area's name** starts as the shortest of its post offices. Ops can give it a better one in the console, and the import leaves a name ops gave alone (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

## Source and licence

- **Source:** "All India Pincode Directory till last month", published by the Department of Posts on data.gov.in (resource `5c2f62fe-5afa-4119-a499-fec9d604d5bd`), last updated 3 October 2025. Downloaded on 22 September 2026 through the data.gov.in API.
- **Licence:** Government Open Data License – India. It allows commercial use, as long as the source is credited as above.

## How it was built

- **Which pincodes are included:** every pincode with an office in the cities' districts. Those districts are all of Delhi, Gurugram, Gautam Buddha Nagar (Noida), Ghaziabad and Faridabad. Each pincode goes to the district of its delivering office.
- **`office_names`:** the post offices in that district, with duplicates removed.
- **`latitude` and `longitude`:** the delivering office's coordinates. Where those are missing or outside NCR, the median of the other offices is used instead.
- **`served` and `launch_on`:** left blank for the owner to fill in.

## Caveats

- **The directory spells the district "Gurugram",** while its offices say "Gurgaon". This file labels the city Gurgaon.
- **Greater Noida and the rural edges are included.** Greater Noida (201306, 201310–201312, 201315, 201318) sits in Noida's district. Rural areas on the edges are included too: Pataudi and Farrukhnagar near Gurgaon, Tigaon near Faridabad, Loni and Modinagar near Ghaziabad, and Dadri, Jewar and Dankaur near Noida. Choose areas by hand.
- **Coordinates are rough.** 30 pincodes share a placeholder point, and some point outside NCR. Use them for a map's rough view only, never for routing.
- **Some pincodes in real use are not in the directory,** so a client may type one that is not here.
