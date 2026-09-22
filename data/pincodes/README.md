# NCR pincodes

`ncr-pincodes.csv` lists the 198 pincodes of the five cities Phase 1 serves: Delhi 103, Gurgaon 29, Noida 26, Ghaziabad 25 and Faridabad 15. It is the starting point for the service area (`docs/phase2-inputs.md`, section 7), which P2-M3's `serviceable_pincodes` table is loaded from.

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
