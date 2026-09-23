# 0054. Capturing an address: the fields, the pin, and the way to the door

- Status: accepted
- Date: 2026-09-23
- Amends [0036](0036-geocoding.md), which stands except on where a coordinate comes from

## Context

The owner asked, on 23 September 2026:

> "How are the addresses taken and stored right now? Some of the consumer platforms allow for a map search for the apartment/landmark and text field for house no. etc. which allows their delivery teams to directly get routes via google map. Scope this service."

That is the pattern every Indian delivery app uses: find the building on a map, type the flat and floor separately, and hand the rider a pin rather than a sentence.

Reading the code for it found that the chain ADR 0036 describes does not exist. Each link below is a file, not an inference.

**An address is six free-text fields and nothing else.** `migrations/0008_profile.sql` gives `addresses` `line1`, `line2`, `locality`, `city`, `pincode` and `access_notes`, plus `lat`, `lng` and `geocoded_at`. `saveAddress` in `src/domain/profile.ts` writes the six and never the three. There is no flat, floor, tower or landmark: `line1` is labelled "House, flat or building" in `apps/app/src/content.ts` and carries all of it.

**The address never reaches FSM.** `createContact` in `src/providers/fsm-zoho.ts` writes `Street_1: "To be confirmed with the client"` and a city, and nothing ever updates it. Nothing reads `Service_Latitude` or `Service_Longitude` back: the mirror takes `Service_City` and `Service_Zip_Code` from an appointment and no more.

**So ADR 0036's coordinates have never existed.** That ADR has FSM geocoding the service address and the mirror writing the result onto `addresses`. Neither half is built, and the half that could be built would geocode the words "To be confirmed with the client". `addresses.lat` has been null in every environment since migration 0008.

**The geofence therefore measures nothing.** `recordArrival` finds no point, writes `address_id` NULL and — because `checkins.distance_m` is `NOT NULL` — a `distance_m` of **0**, and passes the check-in. The technician API answers `distance_m: null`, which is honest. `no_show_cases` is not: it joins `checkins` and hands ops a flat **0 m** as "fact two", which reads as a technician standing exactly at the door when in truth nothing was measured.

**The way to the door is a text search, and on an iPhone it is nothing at all.** `apps/tech/src/job/JobScreen.tsx` links `geo:0,0?q=<the typed address>`. Android hands that to a map app. iOS Safari does not register the `geo:` scheme, and Apple's own reference documents `http://maps.apple.com/` instead, with no mention of `geo:`. Open point 27 still leaves the technician's phone as "any phone".

**What the repository can already say about accuracy.** `data/pincodes/ncr-pincodes.csv` carries a coordinate per pincode from the Department of Posts. Of the 198, one has none and 30 share a point with another pincode — eight of them on a single point. Among Gurgaon's 29, seven share one point and the distinct points sit a **median 1,484 m** apart. A pincode is the coarsest thing a typed address resolves to, and it is roughly a kilometre and a half from its neighbour: an order of magnitude outside the 200 m fence.

## Decision

**A coordinate we observe is ours; a coordinate a provider computes is theirs.** This is the line the whole design rests on. A position read from a phone's own GPS through `navigator.geolocation` is not any provider's content and carries no licence, no key and no bill. A coordinate returned by a geocoder is that provider's content and is governed by their terms. `addresses` therefore records **where a coordinate came from**, and the cheap sources are preferred in this order:

1. **The technician's check-in.** A technician who has stood at the door has already told us where it is: `checkins.lat` and `checkins.lng` are `NOT NULL` and written on every check-in, measured or not. This business sees the same address again — service visits, and a replacement on a roughly 240-day cycle — so from the second visit onward the door is known exactly, for nothing. It is more accurate than any geocoder, because it is not an estimate of the door; it is the door.
2. **The client's own phone**, when they are at home: one "Use my current location" action in the address form. Free, keyless, no tiles, no bundle cost, and it works with a screen reader.
3. **A pin the client drags on a map**, for a client who is not at home when they fill the form. This is the only source that needs a provider, a licence and possibly money, and it is therefore the only one this ADR does not settle.

**The fields the owner described are added, and nothing is rebuilt.** `checkins.address_id` references `addresses (id)`, and D1 runs a migration in one transaction where SQLite counts dropping a parent as a violation that re-creating it does not undo — the fault that withdrew migration 0025 (ADR 0051, `test/node/migrations-on-a-live-database.test.ts`). `addresses` can never be rebuilt while `checkins` points at it. Every new field is therefore a nullable `ALTER TABLE … ADD COLUMN`: `flat`, `floor`, `tower`, `landmark`, and a `geocode_source` beside the existing `lat`, `lng` and `geocoded_at`. `line1` keeps whatever it already holds and is never reinterpreted.

**The way to the door is a plain link, and it needs no provider at all.** `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` when there is a pin, and the same URL with the address text when there is not. Google documents that "You don't need a Google API key to use Maps URLs", that `api=1` is required, and that the only stated limit is 2,048 characters. Maps URLs is absent from the Core Services Summary that defines what the Maps Platform Terms cover, and has no SKU on either the global or the India price list. It is free, keyless, unmetered and outside the Maps Platform contract — and unlike `geo:` it opens on an iPhone. This replaces the `geo:` link whether or not a map picker is ever built.

**The address goes to FSM, because FSM is the system of record.** A saved address updates the contact's service address rather than leaving "To be confirmed with the client" standing. Whether FSM will carry a coordinate **we** supply is not known: the trial (`docs/decisions/fsm-trial.md`, question 4) established only that FSM geocodes service addresses itself and returns `Service_Latitude` and `Service_Longitude`. It was never asked whether those fields are writable. That question is added to the trial document, and it decides how much a client-placed pin is worth: if FSM overwrites our pin with its own geocode of the street, the pin survives only in our D1 and the round trip loses it.

**The geofence stops lying before anything else is built.** Ops' "fact two" must say _not measured_ rather than 0 m; `no_show_cases` already has `checkins.address_id` to tell the two apart.

**The map provider is not chosen here.** It is the one piece that costs money and binds us to somebody's terms, and it is the last piece that should be built. Open points 64, 65 and 66 carry it. What the licensing review of 23 September 2026 established, so that a later choice does not have to re-open it:

- **Google is not the blanket prohibition it is assumed to be, but it is split.** Their Geocoding terms permit keeping a coordinate indefinitely — "Customer may indefinitely cache latitude (lat), longitude (lng), formatted_address, and the structured address values from the Geocoding API solely to support the direct, End User facing functionality of the Customer Application that initiated the request" — while Places is capped at 30 days, "after which Customer must delete the cached latitude and longitude values". A pin we keep must therefore come from geocoding, not from the search box. Their terms also forbid their content "in conjunction with a non-Google map", so a hybrid is not available. A billing account must exist before any key works, but with no payment method attached "the API ceases to function until you add a valid payment method" — it fails closed, which suits ADR 0009.
- **Ola Maps fits ADR 0009 best.** 100,000 free calls a month per service, no card to sign up, and from September 2026 prepaid only — "auto-debit will be disabled and further billable usage will use prepaid credits" — so an overage cannot bill a card that is not there. Their terms contain no caching or retention clause of any kind, and their own attribution section puts their data under the Open Database Licence, which permits storing what we extract.
- **Mappls is ruled out.** The user "Shall not create copies of MMI Products in the form of Cache to avoid paying 'fees' to Mappls", "Shall not use MMI Products to build commercial applications and products without paying a fee", and on termination "shall remove all MMI Products, its backup copies". Storage is the thing we need and it is the thing they forbid.
- **Open data is free; serving it is not.** ODbL permits storing extracted coordinates against attribution, but OpenStreetMap "cannot provide a free-of-charge map API or map tiles for third-parties", their tile policy may withdraw commercial access "at any point", and Nominatim lists autocomplete among uses that are "strictly forbidden and will get you banned". Of the hosts that serve OSM tiles, MapTiler's and Stadia's free tiers are non-commercial; Geoapify's and LocationIQ's are not. Serving tiles from our own R2 is refused: R2 is the one binding that bills past its allowance rather than failing closed (ADR 0009).

## Consequences

- **Most of what the owner asked for costs nothing and needs no provider.** Separate flat, floor, tower and landmark fields are form work. The pin from the technician's check-in and from the client's own phone are free. The route to the door is a free link. Only the map canvas and its search need a vendor.
- **The evidence arrives on its own.** The parallel run after P2-F4 records a position and an accuracy for every check-in already. Set against the pincode centroids the repository ships, that gives the real distance between what a typed Gurgaon address resolves to and where the technician actually stood — which is what open points 26 and 46 have both been waiting for. No build is needed to collect it.
- **What we give up by not choosing a provider now:** a client who is not at home when they first give their address still gets no pin, and the first visit to a new address still cannot be fenced. The fence begins working from the second visit. That is the honest cost of refusing to spend before the evidence is in.
- **ADR 0036 stands, amended.** Its ruling that the geofence degrades honestly rather than passing silently at zero metres is right and is kept. Its ruling that the coordinates come from FSM is set aside: that path was never built, and the cheaper and better sources above are preferred. Its openness to a provider behind `src/providers/geocode.ts` is unchanged, and `geocode_source` is what makes it safe.
- **A map picker cannot be bundled.** `scripts/build-app.ts` sums every `.js` file the app emits against a 150 KB gzipped budget, and the app is at 79.8 KB. MapLibre GL JS is about 274 KB gzipped and needs `blob:` in `worker-src` and `data:` in `img-src`, neither of which `packages/web-kit/headers.ts` grants. A picker must therefore be loaded from the provider's own CDN when the address form is opened, exactly as `apps/app/src/booking/checkout.ts` loads Razorpay Checkout, and its host added to the client app's policy — or be one of the small libraries that does fit. Either way it is the owner's spend ruling first.
- **Typing an address stays possible, always.** The map is an addition to the form, never a gate in front of it. A client on a slow phone, a client refusing the location permission, and a client using a screen reader all reach the same saved address by typing, and the form is already covered by an axe WCAG 2.2 AA scan in `e2e/app/profile.e2e.ts` that any addition has to keep passing.
- **The client app would have to grant itself geolocation.** `apps/app/headers.ts` grants only `otp-credentials` today. "Use my current location" adds `geolocation`, which the technician app already has and the client app has never needed.

---

## Update, 23 September 2026: the owner chose Google, and what that settles

The owner ruled, knowing it means a card on file and a storage restriction:

> "The user enters his apartment and then selects from Google autocomplete which corresponds to an exact location. Then they enter their home/flat no. This ensures that technicians will find the exact location easily."

Open points 64, 65 and 66 are answered by that ruling. This section records what was verified against the live terms before anything was built, because the reading above was made from a summary and the summary was trusted where it should have been checked.

### What may be kept, quoted rather than remembered

The terms are a default prohibition with per-service exceptions. Google Maps Platform Terms of Service, **section 3.2.3(b)**:

> "**No Caching.** Customer will not cache Google Maps Content except as expressly permitted under the Maps Service Specific Terms."

The exceptions, from the Maps Service Specific Terms (the non-EEA set, which is ours):

- **Place IDs, without limit.** Section A.3, "Google ID Caching": _"Customer may cache the Google ID values from the Services that return such field and allow caching, in accordance with its Documentation. For example, Customer may cache (a) place_id from Places API, Directions API, Geolocation API and Routes API"_. Their Place ID documentation says what that means outright: _"Place IDs are exempt from the caching restrictions stated in Section 3.2.3(b) of the Google Maps Platform Terms of Service. You can therefore store place ID values for later use."_ It adds that Google _"recommends refreshing place IDs if they are more than 12 months old"_, free of charge.
- **Places coordinates, 30 days.** Section B.14.3, "Places API (Legacy and New)": _"Customer may temporarily cache latitude and longitude values from the Places API for up to 30 consecutive calendar days, after which Customer must delete the cached latitude and longitude values."_
- **Geocoding coordinates, indefinitely.** Section B.6.3.2: _"Customer may indefinitely cache latitude (lat), longitude (lng), formatted_address, and the structured address values from the Geocoding API solely to support the direct, End User facing functionality of the Customer Application that initiated the request (e.g., displaying the address of a location in a weather application, associating location data with a photograph), only where the cache is not used as a replacement for making an additional call to the Services. Cached data must be logically isolated to the specific End User it is associated with and must not be used across multiple End Users."_

### The question that decided the design

Google's Geocoding API accepts a `place_id` parameter. If a coordinate it returns for a Place ID that came from Autocomplete is _Geocoding_ content, we may keep it and the geofence can work offline. If it is _Places_ content, we may keep it thirty days and the technician's phone would have to ask Google at the door — which it cannot do without a signal.

**It is Geocoding content, and the offline geofence survives.** Three things establish it:

1. **The clauses are scoped by the service that answered, not by where the request's parameters came from.** B.6.3.2 says "from the Geocoding API"; B.14.3 says "from the Places API". Nothing in either set makes content inherit a restriction from an input.
2. **Google documents `place_id` as an ordinary Geocoding request.** Their "Geocoding requests by place ID" page gives `https://maps.googleapis.com/maps/api/geocode/json?place_id=…`, answering with `geometry.location` and `formatted_address` — the exact fields B.6.3.2 names.
3. **Google bills it as Geocoding.** On the India price list it is SKU `Geocoding (India)` `AB12-DA89-B523`, not a Places SKU. A call documented as Geocoding and billed as Geocoding is governed by the Geocoding terms.

The Place ID that joins the two calls is itself the one thing Google says outright may be stored for good. The chain is licensed end to end.

**This is not the convenient answer taken on trust.** B.6.3.2 attaches three conditions, and they are design constraints rather than boilerplate:

- _"solely to support the direct, End User facing functionality of the Customer Application that initiated the request."_ The coordinate exists to get a technician to that client's own door and to measure that they arrived. Google's own example — "associating location data with a photograph" — is the same shape: one coordinate, attached to one record, for that record's sake.
- _"only where the cache is not used as a replacement for making an additional call to the Services."_ We geocode once per address saved, and again when the address changes. The store is never consulted to answer a lookup it was not created for.
- _"Cached data must be logically isolated to the specific End User it is associated with and must not be used across multiple End Users."_ **This forbids the obvious optimisation.** Two clients in one tower get two Geocoding calls and two rows; a building's coordinate is never shared between clients. `addresses` is per person by construction, and `saveAddress` carries the reason in a comment so the saving is not added later by someone who has not read this.

### What is still uncomfortable, and what was done about it

Section 3.2.3(c), "No Creating Content From Google Maps Content", forbids by example _"(iv) use latitude/longitude values from the **Places API** as an input for point-in-polygon analysis"_. A 200 m geofence is a point-in-circle test — close kin. The clause names the Places API only, and our coordinate is Geocoding content, so the example does not reach us; but the prohibition is broader than its examples, and this is the one place where a careful reader could disagree.

Two things make it tolerable rather than a gamble. The clause's subject is _creating content_ — deriving a dataset or a product out of Google's — and what we derive is one distance for one visit, shown to ops as a fact about that visit and never accumulated into anything. And the permissive reading and the conservative one produce the same build: a geofence on a Places coordinate would be forbidden twice over, by the thirty days and by 3.2.3(c)(iv) by name, which is exactly why the design routes through Geocoding instead. **The question to put to Google, if the owner wants it narrower still, is whether a proximity check on a Geocoding coordinate counts as point-in-polygon analysis. It is open point 67.**

### No map is displayed, which settles three other things at once

Sections B.6.1 and B.14.1 permit Google Maps Content _"in Customer Applications without a corresponding Google Map"_; B.6.2 and B.14.2 forbid it _"in conjunction with a non-Google map"_. **The picker is a text combobox with no map canvas anywhere** — which is also what the owner described. Three consequences follow for nothing:

- the no-non-Google-map prohibition cannot be breached, because there is no map;
- the bundle problem this ADR worried about disappears: no MapLibre, no CDN script, no new CSP host, and `apps/app/headers.ts` is unchanged;
- the form stays reachable by keyboard and screen reader, which dragging a pin on a canvas never is.

Attribution is required against content shown without a Google map: _"When displaying Places API data without a Google Map, you must include the Google logo"_, and _"In cases where space is limited, the text Google Maps is acceptable."_ The suggestion list carries the words **Google Maps**. The API returns that as an `attribution` field rather than leaving the front end to remember it.

### The money, and why this costs nothing

The flow is three calls, and the session token is what makes two of them free. From Google's session-token documentation, a session _"begins with a call to Autocomplete (New), and concludes with a call to Place Details (New) or Address Validation"_, and — the sentence the cost design rests on — _"If the session token is omitted, each request is billed separately and charges the SKU: Autocomplete Requests."_ An abandoned session is billed the same way: _"If a session is abandoned, meaning no Place Details (New) request or Address Validation request is made, Autocomplete (New) requests are charged as if no session token were provided."_

The order therefore matters, and `resolve()` closes the session **before** it geocodes:

| Call                                        | India SKU                                          | Free allowance                       |
| ------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| `places:autocomplete`, with a session token | Autocomplete Session Usage `4764-9FA0-0FC0`        | **unlimited**                        |
| `places/{id}` with a field mask of `id`     | Place Details Essentials IDs Only `FAA1-1118-93BE` | **unlimited**                        |
| `geocode/json?place_id=`                    | Geocoding (India) `AB12-DA89-B523`                 | 70,000 a month                       |
| the same autocomplete **without** a token   | Autocomplete Requests `F155-0371-DCAE`             | 70,000 a month, then $0.85 per 1,000 |

**One metered call per address saved**, against 70,000 free a month. At about 300 addresses a month that is 0.4% of the allowance, and it stays ₹0 until roughly two hundred times our size — the scope's conclusion, now with the SKU IDs behind it.

### The ceilings, because a free allowance is not a spending cap

ADR 0009 forbids a surprise bill on Cloudflare's card. The owner has now extended one to Google and the same rule governs it. Google's free allowance does not stop at its limit; it bills. Four guards, none of which trusts the others:

1. **`GEOCODE_DAILY_CEILING`**, a counter in our own D1 on the pattern of the render and login ceilings. It counts **every** request to Google, free SKU or not, because the free ones are free only while the session token does its work, and a ceiling that assumed that would be no ceiling at all. On breach the API answers `503 busy` and alerts once a day. Setting it to `"0"` is the kill switch.
2. **`GEOCODE_CEILING_MAX`** in `src/config/settings.ts` refuses at startup any ceiling above 1,800 — 80% of the 70,000 monthly allowance spread over a 31-day month, so no run of days at the ceiling can reach the free limit. Staging and production are set to 200.
3. **A per-client daily limit** of 120 suggestions, so one client cannot spend the day's ceiling alone.
4. **The quota the owner sets in the Google Cloud console**, the only one outside our code and the only one that binds if our code is wrong. `docs/runbook.md`, section 13, has the exact steps. It matters because Google's budget alerts are explicitly not a cap: they notify after the money is spent.

### FSM will carry our pin

`docs/decisions/fsm-trial.md` question 4 recorded this as unknown. **It was tried against the real FSM org on 23 September 2026 and is now answered: FSM accepts a coordinate we supply, and does not geocode over it.** The trial document holds the detail; three findings matter here.

The coordinate lives on the **address record**, as `Latitude` and `Longitude` — not as `Service_Latitude`/`Service_Longitude` on the contact, which stayed null throughout. It is written by nesting the address in a contact write: `POST /Contacts` on create, and `PUT /Contacts/{id}` with `Service_Address: { id, Latitude, Longitude }` to move an existing pin. `PUT /Addresses/{id}` and `PUT /Contacts/{id}/Addresses` both answer 400.

And the premise ADR 0036 rested on does not hold: **a contact created with no coordinate got none.** Its `Google_Geocodedtime` stayed null and no coordinate ever appeared. FSM did not geocode the service address at all. There was never a coordinate coming from FSM to wait for, which is the last reason to set 0036's source ruling aside.

**Our coordinate wins the geofence either way.** `src/domain/check-ins.ts` reads `addresses.lat`/`lng` from our own D1 and never asks FSM. If some future FSM setting re-geocodes the street and overwrites the pin in their copy, the fence still measures against ours. FSM's copy is for the technician's own navigation; ours is the record.

### Decided

1. **Google Places Autocomplete and the Google Geocoding API**, behind `src/providers/geocode.ts`, with `google-places.ts` the only file that knows Google. Open point 64 is closed.
2. **Every call goes through our API.** The browser never holds the key: the app's policy is `connect-src 'self'`, and a key in a page is a key anyone can spend — ADR 0014's reasoning applied to a second provider.
3. **We keep the Place ID and a Geocoding coordinate, and nothing else Google returns.** The suggestion text is shown and discarded; the building name stored is the one the client kept in the form.
4. **No map is displayed, anywhere.**
5. **Typing an address by hand stays first-class.** The combobox is one field among several, never a gate in front of the form. A client with no signal, no suggestions, a screen reader or a refused provider fills the same form and saves the same address, without a pin. Open point 66 is closed by building it this way: nothing had to be sequenced behind the purchase.
6. **A missing coordinate is still never a zero.** ADR 0036's honest degradation is untouched: a typed address saves no pin, `recordArrival` names no address, and the answer is `distance_m: null`.
7. **The spend to approve is ₹0**, with the ceilings above. Open point 65 is closed.

### What this changes in the sections above

"The map provider is not chosen here" is superseded: it is chosen. Its findings on Ola Maps, Mappls and OpenStreetMap stand as the comparison that was made, and are kept for the next time this is asked. The consequence "A map picker cannot be bundled" is moot, because nothing is bundled and nothing is drawn. The ranking of coordinate sources is unchanged, and Google joins it fourth: the technician's check-in and the client's own phone are still free, unlicensed and better, and `geocode_source` records which of them a row's coordinate came from.
