# Taking an address on a map: what it would take

This answers the question asked on 23 September 2026 — how addresses are taken and stored today, and what it would take to do what the delivery apps do: find the building on a map, type the flat number separately, and send the technician straight to a pin.

It is written to be read without knowing the code. The decision in the ADR beside it is `docs/decisions/0054-address-capture.md`.

## The short version

**The money: ₹0 a month.** Three of the four pieces below need no supplier, no account and no payment at all. The fourth — the map you drag a pin on — is the only one that needs a company's permission, and at our size it is free too: about 300 addresses saved a month is roughly **0.3%** of the free monthly allowance of every supplier we would actually choose. It stays ₹0 until we are about two hundred times bigger, and the supplier we recommend cannot charge us even then without our first paying money up front.

**The finding that matters more than the map.** Looking into this turned up something that has to be fixed whether or not you ever want a map: **we are not measuring anything at the door, and the address a client types never reaches Zoho at all.** The "you are 240 m from the address" check that guards no-shows has never had a coordinate to measure against. It currently records every technician as being exactly **0 m** from the door, and shows that to ops as evidence. That is not a map problem; it is a wiring problem, and it is cheap to fix.

**The recommendation in one line.** Fix the wiring, take the pin for free from the technician's own phone and the client's own phone, and only buy a map afterwards, if the evidence says the free pins are not good enough.

## What happens today

When a client adds their address in the app they fill in six boxes: house/flat/building, street, sector or area, city, pincode, and access notes ("gate code 4417, park in visitor bay B"). That is all. There is no separate flat number, no floor, no tower and no landmark — they all go into the first box together.

That address is saved in our own database. Three empty columns sit next to it, waiting for a map coordinate that has never arrived.

Three things follow from that, and all three are broken:

1. **Zoho never sees the address.** When we create a client in Zoho, we write the street as the words _"To be confirmed with the client"_, and nothing ever replaces it. So Zoho — which is the system of record for field work — has a city and a placeholder where the address should be.
2. **The arrival check measures nothing.** The technician taps "I have arrived" and we are supposed to check they are within 200 m of the address. With no coordinate there is nothing to compare against, so the check quietly passes. Worse, the ops screen that decides whether to charge a client for a no-show shows the distance as **0 m** — which reads as "the technician was standing exactly at the door" when the truth is "we did not measure".
3. **The "Navigate" button is a text search, and on an iPhone it does nothing.** It hands the typed address as words to whatever map app is installed. On Android that opens a search. On an iPhone the link format we use is not recognised at all, so nothing happens. Technicians' phones are still "any phone" (open point 27).

## How far wrong is a typed address, really?

This is the honest case for the whole feature, so it is worth being concrete.

When you type "Sector 65, Gurgaon, 122018" and a computer turns that into a coordinate, it lands somewhere in the middle of that area — not at your gate. We can already measure how coarse that is, because the repository ships a coordinate for every pincode we serve, from the Department of Posts.

Of the 198 pincodes we cover:

- one has no coordinate at all;
- **30 of them share a coordinate with another pincode** — eight of them sit on a single identical point;
- in Gurgaon, **seven of the 29 pincodes are on one point**, and the distinct points are a **median 1,484 m apart**.

So a pincode resolves to something roughly a kilometre and a half from its neighbours. The fence we are trying to enforce is 200 m. A typed address is not merely imprecise for this job — it is off by a factor of seven or more, which is why the check either has to be switched off or has to be wrong.

A pin, by contrast, is within a few metres of the door.

**But we do not have to take this on faith, and we should not.** Every check-in already records where the technician's phone was and how accurate that fix was — that data is collected whether or not the address has a coordinate. The two-week parallel run scheduled after the technician app ships will therefore produce, for free and with no extra work, exactly the evidence needed: for each real visit, where the technician actually stood, which we can compare against what the typed address would have resolved to. **That is the measurement that should decide whether to spend anything on a map.** It also settles the 200 m radius itself (open point 46), which has been waiting on the same missing numbers.

## What we propose to build, in order

The order matters: each stage is useful on its own, and each later stage is easier to judge once the earlier one has run.

### Stage 1 — Stop the arrival check from lying. **Half a day.**

Make ops' no-show evidence say _not measured_ instead of **0 m**. Nothing else changes. This is a correctness fix on a screen that is used to decide whether to charge a client money, so it should not wait for anything.

**Cost to run: nothing.**

### Stage 2 — The fields the delivery apps have. **Two to three days.**

Split the address into the boxes you described: **flat or house number**, **floor**, **tower or block**, and **landmark**, alongside the existing area, city and pincode. Access notes stay as they are.

The existing boxes are not disturbed and nothing already saved is rewritten — the new boxes are simply added empty, and an address saved before today keeps reading exactly as it does now. (There is a hard technical reason we cannot restructure the existing table, explained under "the one technical constraint" below.)

**Cost to run: nothing.**

### Stage 3 — A pin, for free, from two sources. **Three to four days.**

This is the part that gets most of the benefit without buying anything.

- **From the technician.** When a technician taps "I have arrived" at a door, their phone tells us where that door is — to within a few metres. We already record it and then throw it away. Instead, save it against the address. Because this business sees the same address again and again — service visits, and a replacement roughly every 240 days — **from the second visit onwards we know the door exactly, and it cost nothing.** It is better than any map service could give us, because it is not an estimate of the door; it is the door.
- **From the client.** One button in the address form: _Use my current location_, for a client filling the form at home. Their phone gives the coordinate directly. No map, no supplier, no account.

Both are the phone's own satellite position. Crucially, **a position a phone measures is ours** — it is not any company's data, so no licence, no key and no bill attaches to it. Only a coordinate that a _map company calculates for us_ comes with conditions.

**Cost to run: nothing.**

### Stage 4 — The map itself. **Five to eight days, and a decision from you.**

A map in the address form that the client can search and drag a pin on, for the client who is not at home when they fill the form in. This is the only stage that needs a supplier, an account, and agreement to somebody's terms.

**Recommendation: do not start this until the parallel run has reported.** If Stage 3's free pins turn out to be good enough — and for a business with repeat visits they may well be — this stage buys very little for real money and real complexity.

## Where the technician actually gets their route

Worth separating out, because it is the cheapest thing in this document and it is free regardless of everything above.

Sending a technician to a pin does **not** require a map licence, an account or a key. A plain web link of the form `https://www.google.com/maps/dir/?api=1&destination=<coordinates>` opens Google Maps with directions already running. Google's own documentation states: _"You don't need a Google API key to use Maps URLs."_ It has no price, no usage cap (beyond a 2,048-character URL limit), and it is not listed among the services their Maps Platform contract covers — so it carries none of the storage restrictions discussed below.

It also works on an iPhone, which the current button does not.

**This should be fixed in Stage 1 or 2 regardless of whether a map is ever bought.**

## The licensing question, carefully

You asked about this in the context of Google. The answer is more permissive than expected in one place and stricter in another, and the distinction is worth understanding because it shapes what we are allowed to keep.

The rule is about **where a coordinate came from**, not what we do with it.

**Free and unrestricted:**

- **A coordinate the phone measured** — the technician's check-in, or the client's "use my location". This is not any company's data. No terms apply. This is what Stage 3 uses.
- **Linking out for directions.** As above: no key, no cost, outside the Maps Platform contract.

**Restricted — these bind us to a supplier's terms:**

- **Asking a company to turn an address into a coordinate**, or to tell us what is at a pin we dropped, or to suggest addresses as someone types. This is the supplier's content, and how long we may keep it varies by supplier and even by which of their products we used.

### Google, in detail

The terms are not what is commonly assumed, and the detail would decide the design:

- Their **Geocoding** service permits keeping a coordinate **indefinitely**: _"Customer may indefinitely cache latitude (lat), longitude (lng), formatted_address, and the structured address values from the Geocoding API solely to support the direct, End User facing functionality of the Customer Application that initiated the request"_ — provided it is kept per-customer and not shared across customers. Saving a client's own address coordinate against that client's own record is exactly this case.
- Their **Places** service does **not**. There the rule is 30 days: _"Customer may temporarily cache latitude and longitude values from the Places API for up to 30 consecutive calendar days, after which Customer must delete the cached latitude and longitude values."_ So a pin we keep has to come from the geocoding service, not from the search box.
- **You cannot mix suppliers.** Google forbids using their content _"in conjunction with a non-Google map"_. We could not put Google's address search over a cheaper map. It is all one supplier or all another.
- **A billing account is required even to use the free allowance.** There is no keyless free tier. The protection is that Google's FAQ states that if the free allowance is exceeded with no valid payment method attached, _"the API ceases to function until you add a valid payment method."_ It stops rather than charges. Note also that Google says plainly that a **budget alert is not a spending cap**; the real cap is a per-service daily request limit, which we would have to set ourselves.

### Ola Maps, which fits the "never be charged" rule better

- **100,000 free calls a month, per service** — separately for address suggestions, geocoding, reverse geocoding and map loads. That is larger than Google's Indian allowance.
- **It cannot bill us by accident.** From September 2026 Ola is prepaid only: _"You do not need a credit balance while your usage remains within this allowance"_, and _"After the August payment is settled, auto-debit will be disabled and further billable usage will use prepaid credits."_ With no credits loaded and no card on file, going over the free allowance cannot produce a charge — it simply stops. No other supplier offers a guarantee this strong, and it is the closest match to the rule that our card is never charged.
- **No storage restriction exists.** Their Platform Terms and Fair Usage Policy were read end to end: the words "cache", "caching", "retain" and "permanent" do not appear at all. There is neither a permission nor a prohibition.
- **Their data is OpenStreetMap under the Open Database Licence**, by their own terms — attribution must be to "Ola Maps" and _"must also make it clear that the data is available under the Open Database License."_ That licence positively allows storing coordinates we extract; the obligation is a credit line on the map.
- **No card is needed to sign up.**
- The catch: their web map library is a rebadged copy of a large open-source one, so the map is a heavy download. It would load only when the address form is opened, never on start-up.

### Mappls — we recommend ruling it out

Their terms are the strictest of the three and are incompatible with what we need. The user _"Shall not create copies of MMI Products in the form of Cache to avoid paying 'fees' to Mappls"_ and _"Shall not use MMI Products to build commercial applications and products without paying a fee to Mappls"_. On termination the user _"shall remove all MMI Products, its backup copies from its computers, servers etc."_ — so every stored coordinate would have to be deleted if we ever stopped paying. They also forbid showing their content near a non-Mappls map, require a "Powered by Mappls" logo wherever their content appears, and cap their own liability at **₹20,000**. They publish no free-tier numbers at all; the figures sit behind a login.

### The free open-data route, and why it is not the recommendation

OpenStreetMap's licence does allow storing coordinates. But OpenStreetMap themselves say _"we cannot provide a free-of-charge map API or map tiles for third-parties"_, their tile policy warns commercial users that access _"may be withdrawn at any point"_ without notice, and their free address-search service forbids exactly our use — autocomplete is listed under "strictly forbidden and will get you banned". So the data is free but somebody must serve it, and the obvious free hosts are closed to us: **MapTiler**'s free plan is _"limited to non-commercial use"_, and **Stadia Maps**' free tier is likewise for _"non-commercial or evaluation purposes"_, with permanent storage needing their $80-a-month plan (about ₹7,000). Two are genuinely open to a commercial free user — **Geoapify** (3,000 calls a day, whose FAQ says commercial production use is allowed, no card) and **LocationIQ** (5,000 a day, commercial use if we show a link back, and whose support states _"You can store the output forever"_).

Hosting the map ourselves from our own Cloudflare storage is the only option with no supplier at all — but that storage is the one Cloudflare service that **bills past its free limit instead of stopping**, which is exactly what ADR 0009 forbids us to risk. That alone rules it out.

## What it would cost, in rupees

Our size is the decisive fact. A map is loaded **once per address saved**, not once per screen view — a client saves an address perhaps once and edits it rarely. Even generously, at **300 addresses saved a month**:

| Supplier          | Free allowance a month      | Our expected use | Share used | Cost    |
| ----------------- | --------------------------- | ---------------- | ---------- | ------- |
| **Ola Maps**      | 100,000 per service         | ~300 per service | **0.3%**   | **₹0**  |
| **Google, India** | 70,000 per service          | ~300 per service | **0.4%**   | **₹0**  |
| **Geoapify**      | 3,000 a day (~90,000)       | ~300             | **0.3%**   | **₹0**  |
| **LocationIQ**    | 5,000 a day (~150,000)      | ~300             | **0.2%**   | **₹0**  |
| Mappls            | not published               | —                | —          | unknown |
| Stadia, MapTiler  | free tier is non-commercial | —                | —          | ~₹7,000 |

**Total: ₹0 a month**, under every option we would actually choose. The free allowance is between 230 and 500 times our expected use.

**Where the free tier stops.** With Ola, at 100,000 calls of any one service a month — about 3,300 addresses saved a day, roughly two hundred times the business we expect. Past that the rates are about **₹0.06 an address suggestion**, **₹0.10 a geocode** and **₹0.012 a map load**, so even at ten times our expected volume the bill would be under ₹100 a month — and with no prepaid credits loaded it would stop rather than charge. With Google the allowance is 70,000 per service and the India rates are about **₹185 per 1,000 map loads** and **₹132 per 1,000 geocodes**.

**What is not free and must be watched:** nothing in this proposal touches Cloudflare's paid edges. Stages 1 to 3 add no requests to speak of and store no files. The one option that would — hosting map tiles ourselves — is ruled out above for exactly that reason.

## The one technical constraint worth knowing

We cannot restructure the existing address table. The arrival records point at it, and our database (Cloudflare D1) runs each change as a single all-or-nothing step in which removing a table that something else points at counts as a breakage that putting it back does not undo. We proved this in September: a change written exactly that way was accepted locally, failed on the staging deploy, and had to be withdrawn.

So every new field is **added alongside** the existing ones and left empty for old records. This is a mild constraint, not a blocking one — it just means we add boxes rather than redesigning the form's storage. It does mean the old combined "house, flat or building" box has to stay, holding whatever people have already typed into it.

## What we need from you

Three rulings, recorded as open points 60, 61 and 62:

1. **Which map supplier, if any** (open point 60). **Our recommendation, if one is wanted at all, is Ola Maps** — the largest free allowance, no card, no storage restriction in their terms, and a prepaid model under which going over the free allowance physically cannot charge us. Google is the better map of Indian apartment complexes, and its geocoding terms do permit keeping the coordinate, but it requires a billing account to exist before anything works. **Mappls we recommend ruling out** for the reasons above. **Our stronger recommendation is to defer this ruling entirely until the parallel run reports.**
2. **Whether to sign up for anything at all, and for how much** (open point 61). Every option for Stage 4 needs an account with a map company. At our size the answer is ₹0 a month under any of them, so the ruling is not really about money — it is about whether you want a third company holding an account for us, and whether the feature is worth it once the free pins are working. The spend to approve is **nil**, with a ceiling: we would set a hard daily request cap so the service stops rather than ever bills.
3. **Before or after the staging test** (open point 62). Our recommendation: Stages 1 and 2 before, because one is a correctness fix on a screen used to charge clients money and the other is plain form work; Stage 3 before, so the parallel run starts collecting real pins as it goes; Stage 4 after, judged on what the parallel run shows.

We would also like Zoho checked on one point: **whether it will accept a coordinate we supply**, or insists on working out its own from the street. This was never tested in the trial. If Zoho overwrites our pin, then a client-placed pin only ever lives in our own system and is worth noticeably less — it would still drive our arrival check and our technician's directions, but it would not appear in Zoho's own app.

## What this deliberately leaves out

- **Routing and journey planning.** No route optimisation, no live traffic, no estimated arrival times. The technician's own map app does that, for free.
- **Live technician tracking on a map.** Not asked for, and a much larger piece of work.
- **A map in the ops console.** Ops see the address as text. A map there is a separate question.
- **Checking whether a pin is inside our service area.** Tempting, but Google's terms specifically forbid using their coordinates to test against our own area boundaries, and our service area is decided by pincode today and works.
- **Replacing the pincode check at booking.** It works and it is free.
- **Any change to how access notes work.** They are already the right idea, and the technician already sees them the day before.

## Anyone on a slow phone, or who cannot see the map

A map is the heaviest thing we would ever put in the client app and the least accessible, so it is an addition to the form and never a gate in front of it.

- **Typing the address always works**, and always saves. Nobody is ever required to touch a map to give us their address.
- **The map only loads when someone opens the address form** and only if their connection supports it — never on app start-up. It is fetched from the supplier when needed, the same way the payment window already is, so it does not slow the app down for anyone else.
- **"Use my current location" is a single button** and needs no sight, no dragging and no map at all. For a client at home it is both the most accessible option and the most accurate one.
- **The existing address form already passes an automated WCAG 2.2 AA accessibility check** in our test suite, and anything added has to keep passing it.
- **Nothing is lost by declining.** A client who refuses the location permission, or whose phone cannot show the map, gets the same saved address as everybody else — and, from their first completed visit, the same free pin from the technician's phone.
