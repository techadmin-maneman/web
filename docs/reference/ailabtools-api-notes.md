<!--
Copied verbatim from C:\Users\X2\Side projects\AILabTool\docs\API_NOTES.md on 2026-09-21.
The source was last updated from live measurements on 2026-09-19. Do not edit this copy;
record departures in docs/decisions/0013-departures-from-the-ailabtools-harness.md.
-->

# AILabTools API Notes

All facts below were read from the live documentation on **2026-09-19**.
Every line is either sourced to a URL or explicitly marked `UNVERIFIED`.
Nothing here is inferred from client libraries or example blog posts.

> Convention: `UNVERIFIED` means "the docs do not state this". It is never a guess.

---

## 0. Corrections to the baseline I was given

| Baseline claim | Reality per docs | Source |
|---|---|---|
| Endpoint A takes `image` + `hair_style` | Endpoint A takes **`image_target`** (file) + **`hair_type`** (integer). There is no `hair_style` on A. | [A/api](https://www.ailabtools.com/doc/ai-portrait/effects/hairstyle-editor/api) |
| Endpoint A is async | Endpoint A is **synchronous** and returns a **base64 image** in `data.image`. No `task_id`. | same |
| Endpoint B fields are `task_type,image,hair_style,color,image_size` | Correct, **plus a required `auto` integer field (default `1`)**. | [B/api](https://www.ailabtools.com/doc/ai-portrait/effects/hairstyle-editor-pro/api) |
| `data { image }` is the universal response shape | Three different shapes. A: `data.image` = base64. B: `data.images` = **array of URLs**. C: `data.image` = **single URL**. | A/api, B/api, [C/api](https://www.ailabtools.com/docs/ai-portrait/effects/hairstyle-editor-premium/api) |
| Credits endpoint returns a balance object | `data` is an **array** of credit pools, each with its own `balance`. Must be summed. | [credits](https://www.ailabtools.com/doc/ai-common/querying-credits/api) |
| Resolution limit `< 4096x4096` | True for A and B. **C documents `200x200` to `4090x4090`** (4090, not 4096). B documents a `200x200` minimum. | A/api, B/api, C/api |

**Retirement warning.** The current docs page for Endpoint A carries a *service retirement notice* stating the
API will be discontinued and recommending users move to an alternative.
Source: <https://www.ailabtools.com/docs/ai-portrait/effects/hairstyle-editor> (read 2026-09-19).
Endpoint A is still implemented here for comparison, but it should not be chosen for anything long-lived.
**Update: measured 2026-09-19, A is already deactivated and returns 404 on every call. See section 7.1.**

---

## 1. Common

| Fact | Value | Source |
|---|---|---|
| Base URL | `https://www.ailabapi.com` | all api pages |
| Auth header | `ailabapi-api-key: <key>` on every request | all api pages |
| Async poll path | `GET /api/common/query-async-task-result?task_id=<id>` | [async](https://www.ailabtools.com/doc/ai-common/async-task-results/api) |
| `task_status` values | `0` queued, `1` processing, `2` success | async |
| Docs' recommended poll interval | "every 5 seconds" (this harness uses 3s per the brief) | async |
| Result retention | Response file URLs valid **24 hours**, then auto-deleted | async, C/api |
| Uploaded file retention | "No" retention, deleted immediately | C pricing page |
| Credits path | `GET /api/common/query-credits` | [credits](https://www.ailabtools.com/doc/ai-common/querying-credits/api) |
| Credits response | `data[]` array; per entry `unique_sign`, `name`, `balance` (float), `total`, `last_recharge_balance`, `balance_warning`, `first_buy_time`, `last_update_time` | credits |
| Credit unit price | `$0.0027` per credit at the standard rate | [A pricing](https://www.ailabtools.com/docs/ai-portrait/effects/hairstyle-editor) |
| Credit tiers | $6 = 2,000 credits through $2,500 = 1,000,000 credits | [C pricing](https://www.ailabtools.com/docs/ai-portrait/effects/hairstyle-editor-premium) |
| Public response fields | `request_id`, `log_id`, `error_code`, `error_msg`, `error_detail{status_code, code, code_message, message}` | all api pages |
| Full error-code table | **UNVERIFIED**: the docs describe the `error_detail` shape but publish no enumerated error-code table on these pages. | -- |

---

## 2. Endpoint A, Hairstyle Changer (basic)

Source: <https://www.ailabtools.com/doc/ai-portrait/effects/hairstyle-editor/api> (2026-09-19)
Pricing source: <https://www.ailabtools.com/docs/ai-portrait/effects/hairstyle-editor> (2026-09-19)

- **Path:** `POST /api/portrait/effects/hairstyle-editor`
- **Content-Type:** `multipart/form-data`
- **Sync/async:** **Synchronous.** Returns the image inline; no `task_id`.
- **Credit cost:** "Each successful API request consumes 12 credits (approx $0.0324)"
- **Reference image:** **Not supported** (no such field documented).

| Field | Req | Type | Default | Notes |
|---|---|---|---|---|
| `image_target` | YES | file | -- | JPEG, JPG, PNG, BMP |
| `hair_type` | NO | integer | `101` | catalog below |

**Full `hair_type` catalog (14 values, complete):**

| id | label | id | label |
|---|---|---|---|
| `101` | Bangs (default) | `603` | Short hair |
| `201` | Long hair | `801` | Blonde |
| `301` | Bangs with long hair | `901` | Straight hair |
| `401` | Medium hair increase | `1001` | Oil-free hair |
| `402` | Light hair increase | `1101` | **Hairline fill** |
| `403` | Heavy hair increase | `1201` | Smooth hair |
| `502` | Light curling | `1301` | **Fill hair gap** |
| `503` | Heavy curling | | |

**Constraints:** file <= 5 MB; resolution < 4096x4096px; `hair_type=603` additionally requires input < 2048x2048.
Degree of change is documented as "Fine-tune" (vs Pro's "Completely transform"); the basic tier is described as
"Supports 5 hairstyles" using deep learning, single output image, no colour control.

**Response:** `data.image` = base64 string.

---

## 3. Endpoint B, Hairstyle Changer Pro

Source: <https://www.ailabtools.com/doc/ai-portrait/effects/hairstyle-editor-pro/api> (2026-09-19)
Pricing source: <https://www.ailabtools.com/docs/ai-portrait/effects/hairstyle-editor-pro> (2026-09-19)

- **Path:** `POST /api/portrait/effects/hairstyle-editor-pro`
- **Content-Type:** `multipart/form-data`
- **Sync/async:** **Async.** Returns `task_id`; poll the common async endpoint.
- **Credit cost:** "10 credits (approx $0.0270)" per request. **RESOLVED by measurement (section 7.4):
  cost is flat, `image_size=4` still bills 10 credits.**
- **Processing time:** "~20s"
- **Reference image:** **Not supported.** The tier comparison table marks "Reference-based Hairstyles" as unsupported for Pro.
- **Model:** stable diffusion, "distinct results each time for the same hairstyle", so repeat calls are *not* deterministic.

| Field | Req | Type | Default | Values |
|---|---|---|---|---|
| `task_type` | YES | string | -- | `async` |
| `auto` | YES | integer | `1` | `1` = automatic mode |
| `image` | YES | file | -- | PNG, JPG, JPEG |
| `hair_style` | YES | string | -- | catalog below |
| `color` | NO | string | -- | colour enum below |
| `image_size` | NO | integer | `1` | `1`-`4`, number of result images |

> **Superseded by measurement.** The 22-value list below is from the OLD `/doc/` page. The new
> `/docs/` page publishes **101 male styles (39 named + `male_hairstyle_0001`-`0062`) and 139
> female**, identical to Premium's, and Pro accepts them: `Natural_Side-Part` and
> `male_hairstyle_0025` both returned `OK` on 2026-09-19. Use the 101-value list. See section 7.9.

**Male `hair_style` catalog per the old page (22):**
`BuzzCut`, `UnderCut`, `Pompadour`, `SlickBack`, `CurlyShag`, `WavyShag`, `FauxHawk`, `Spiky`, `CombOver`,
`HighTightFade`, `ManBun`, `Afro`, `LowFade`, `UndercutLongHair`, `TwoBlockHaircut`, `TexturedFringe`,
`BluntBowlCut`, `LongWavyCurtainBangs`, `MessyTousled`, `CornrowBraids`, `LongHairTiedUp`, `Middle-parted`

**Female `hair_style` catalog (29, complete):**
`ShortPixieWithShavedSides`, `ShortNeatBob`, `DoubleBun`, `Updo`, `Spiked`, `bowlCut`, `Chignon`, `PixieCut`,
`SlickedBack`, `LongCurly`, `CurlyBob`, `StackedCurlsInShortBob`, `SidePartCombOverHairstyleWithHighFade`,
`WavyFrenchBobVibesfrom1920`, `BobCut`, `ShortTwintails`, `ShortCurlyPixie`, `LongStraight`, `LongWavy`,
`FishtailBraid`, `TwinBraids`, `Ponytail`, `Dreadlocks`, `Cornrows`, `ShoulderLengthHair`, `LooseCurlyAfro`,
`LongTwintails`, `LongHimeCut`, `BoxBraids`

**`color` enum (21, complete):** `blonde`, `platinumBlonde`, `brown`, `lightBrown`, `blue`, `lightBlue`,
`purple`, `lightPurple`, `pink`, `black`, `white`, `grey`, `silver`, `red`, `orange`, `green`, `gradient`,
`multicolored`, `darkBlue`, `burgundy`, `darkGreen`

**Constraints:** PNG/JPG/JPEG; <= 5 MB; > 200x200px and < 4096x4096px; face proportion >= 10%;
face not obscured; front-facing within 30 degrees of rotation.

**Response:** submit gives `{request_id, log_id, error_code, error_msg, task_type, task_id}`;
poll gives `{error_code, error_msg, task_status, data:{images:[url, ...]}}`.

---

## 4. Endpoint C, Hairstyle Changer Premium (the "AI Hair Transplant" API)

The marketing page <https://www.ailabtools.com/hair-transplant> links its API docs to
`/docs/ai-portrait/effects/hairstyle-editor-premium`. So **"AI Hair Transplant" and
"Hairstyle Changer Premium" are the same endpoint**, and that is the one this project cares about.
Source: <https://www.ailabtools.com/docs/ai-portrait/effects/hairstyle-editor-premium/api> (2026-09-19)

- **Path:** `POST /api/portrait/effects/hairstyle-editor-premium`
- **Content-Type:** `multipart/form-data`
- **Sync/async:** **Async.** Returns `task_id`; poll the common async endpoint.
- **Credit cost:** "15 credits (approx $0.0405)" per request.
- **Processing time:** "~30-60s"
- **Reference image:** **YES, `image_template`** (binary). This is the only tier that supports it.
  The tier table marks both "Reference-based Hairstyles" and "Reference-based Hair Color" as supported.

| Field | Req | Type | Default | Notes |
|---|---|---|---|---|
| `image` | YES | file | -- | source portrait |
| `hair_style` | conditional | string | -- | one of `hair_style` / `image_template` required; **`hair_style` takes precedence if both are sent** |
| `image_template` | conditional | file | -- | reference hairstyle image, same constraints as `image` |
| `color` | NO | string | `original` | enum below |
| `task_type` | -- | -- | -- | **not documented for C**, no such field (unlike B) |
| `image_size` | -- | -- | -- | **not documented for C**, no such field (unlike B) |

**`color` enum for C (23):** `original`, `reference`, plus the 21 Pro colours listed above.

**Male `hair_style` catalog for C.** The page header says "95 presets" but the enumerated list contains 101
entries, so the docs are internally inconsistent on the count. Values as given:

`BuzzCut`, `UnderCut`, `Pompadour`, `SlickBack`, `CurlyShag`, `WavyShag`, `FauxHawk`, `Spiky`, `CombOver`,
`HighTightFade`, `ManBun`, `Afro`, `LowFade`, `UndercutLongHair`, `TwoBlockHaircut`, `TexturedFringe`,
`BluntBowlCut`, `LongWavyCurtainBangs`, `MessyTousled`, `CornrowBraids`, `LongHairTiedUp`, `Middle-parted`,
`ManGreased`, `WavyMiddlePart`, `Natural_Side-Part`, `Wolf_Crop`, `Wind-Tousled_Crop`, `Side-Parted_Textured`,
`FluffyMiddlePart`, `FreshSide-Parted`, `Smooth_Crop`, `Korean_Wavy_Crop`, `Comma_Hair`, `Side-Part_Crop`,
`Natural_Middle_Part`, `Chestnut`, `ChoppyBangs`, `StructuredWavyShag`, `TinfoilPerm`,
then `male_hairstyle_0001` through `male_hairstyle_0062` (62 sequential numbered presets, zero-padded to 4 digits).

**Female catalog for C:** documented as 98 presets, the named women's styles plus
`female_hairstyle_0001` through `female_hairstyle_0073`. Not enumerated here; out of scope for this project.

**Constraints:** JPEG/JPG/PNG; <= 5 MB; 200x200px to **4090x4090px**; face proportion >= 10%;
face not obscured; front-facing within 30 degrees of rotation.

**Response:** submit gives `{request_id, log_id, error_detail{...}, task_id}`; poll gives `data.image` = single URL.

---

## 5. Facts the docs do not give (UNVERIFIED)

1. **Enumerated error-code table** for any of the three endpoints. Only the `error_detail` *shape* is published.
2. ~~Whether `image_size` on B multiplies the credit cost.~~ **RESOLVED: it does not, see section 7.4.**
3. **Rate limits or concurrent-task ceiling.** Not published on any of these pages.
4. ~~Which host serves result image URLs.~~ **RESOLVED by measurement: `ailab-outputs.oss-accelerate.aliyuncs.com`
   (Alibaba Cloud OSS). Still undocumented, so treat it as subject to change. See section 7.10.**
5. **Behaviour on a Norwood IV-VI input specifically.** No endpoint documents a minimum existing-hair requirement.
   That is exactly what this harness exists to measure.
6. **Whether A's `1101` / `1301` fill types have a coverage ceiling.** Labels only, no description of limits.
7. **Premium's exact male catalog size** (page says 95, lists 101, see section 4).

---

## 6. Preset selection rationale (Norwood IV-VI)

Six presets were buildable from real catalog ids; see `presets.yaml`. Selection logic:

- **Endpoint A** contributes `1101` (Hairline fill) and `403` (Heavy hair increase), the only two entries in the
  whole A catalog that are semantically about *adding* hair rather than restyling it. `1301` (Fill hair gap) is a
  close third and ships as the commented-out seventh preset.
- **Endpoint B** contributes `TexturedFringe` (forward-weighted, disguises a receded hairline) and `CombOver`
  (the conventional conservative restoration look). Both are real ids from the 22-value male catalog.
- **Endpoint C** contributes `TexturedFringe` again (mirroring the B preset, so the Pro-vs-Premium model tier is
  the only variable between them) plus `BuzzCut`, the lowest-density plausible outcome and therefore the
  believability floor for a NW IV-VI scalp. C is the only tier built for reference-based transfer and is the
  hair-transplant product proper.
- A seventh preset using C's `image_template` reference transfer ships commented out in `presets.yaml`; it needs
  a reference photo on disk, so it cannot be enabled by default.

A is a fine-tune model while B and C completely re-render the hair region, so A-vs-B/C is the main axis of the
experiment: whether a NW IV-VI scalp needs generation (B/C) or only augmentation (A).

**Cost per full sweep:** 6 presets = 12 + 12 + 10 + 10 + 15 + 15 = **74 credits (approx $0.1998) per input photo**.

---

## 7. MEASURED behaviour (live calls, 2026-09-19)

Everything in this section is observed from real API responses, not from the docs. Where it
contradicts the docs, the measurement wins.

### 7.1 Endpoint A is dead

Every call returns:

```
HTTP 404   error_code=404   code=ERROR_AI_NOT_EXISTS
"AI does not exist or has been deactivated, please contact the platform."
```

This confirms the retirement notice in section 0 is already in force, not merely announced.
A's presets are commented out in `presets.yaml`; the CLI now defaults to `--endpoints B,C`.

### 7.2 Endpoint C validates the FILENAME, not the file contents

Sending JPEG bytes under a `.avif` filename gives:

```
HTTP 502  error_code=502   "AI service internal error ... - 500 - File type not supported"
```

The identical bytes sent as `probe.jpg` succeed. **Endpoint B is content-sniffing and does not
care about the name; C is extension-driven.** The client therefore names every multipart part
after the actual bytes (`_part()` in `app/client.py`) and sends a real `image/jpeg` or
`image/png` content type rather than `application/octet-stream`.

Note the misleading error: a *client* format problem is reported as a 502 "AI service internal
error", which reads like an outage. It is not.

### 7.3 Accepted formats differ per endpoint, and neither matches the docs exactly

| Endpoint | 422 message lists |
|---|---|
| B | "Only PNG, JPG, JPEG are supported." |
| C | "Only JPEG, JPG, PNG, WEBP are supported." (docs page omits WEBP) |

AVIF is rejected by both. Pre-flight re-encodes anything outside JPEG/PNG to JPEG q=92.

### 7.4 `image_size` does NOT multiply the credit cost (resolves UNVERIFIED #2)

Measured on B: `image_size=2` billed **10 credits**; `image_size=4` billed **10 credits**.
Pricing is flat per request.

**But do not raise it -- see section 7.12. The extra images are byte-identical duplicates.**

### 7.5 Endpoint B has no "keep the original colour" option and defaults to BLONDE

With `color` omitted, B returned blonde/light-brown hair on a black-haired, black-bearded
subject -- an obvious mismatch that alone made every B result unusable. Setting `color: black`
fixed it completely. C's `color` defaults to `original` and needs no help.

**This is the single most important parameter finding.** Any B preset must set `color` to match
the subject. It matters even more for black-haired subjects, which is most of the likely user base.

### 7.6 Measured cost and latency

| Endpoint | Billed | Latency observed | Docs claim |
|---|---|---|---|
| B | 10 credits flat (any `image_size`) | 17-49 s | "~20s" |
| C | 15 credits | 80-91 s | "~30-60s" |

C is roughly **2x slower than documented** and 4-5x slower than B. Failed calls bill 0 credits.

### 7.7 Identity preservation: B beats C

On a Norwood VII subject (harder than the NW IV-VI target), C visibly altered the face --
slimmer, younger, different bone structure -- on both TexturedFringe and CombOver. B left the
face essentially untouched and changed only the hair. For a hair-transplant "after" image the
customer must recognise themselves, so this outweighs C's higher fidelity hair rendering.

### 7.8 The style catalog is Western-centric, and browsable for free

The premium docs page embeds a preview image URL for every style:

```
https://ai-resource.ailabtools.com/hairstyle-changer-premium/doc/mens-hairstyles/<hair_style>.webp
https://ai-resource.ailabtools.com/hairstyle-changer-premium/doc/womens-hairstyles/<hair_style>.webp
```

Fetching these costs no credits, so the whole catalog can be browsed before spending anything.

Confirmed counts: **101 male** styles (39 named + `male_hairstyle_0001`-`0062`) and **139 female**.
The 101 matches the enum list; the page header's "95" is wrong.

**There is no Indian, South Asian, turban, patka or Sikh preset**, and all 101 male previews use
the same white model with wavy mid-brown European hair. The closest real ids for common Indian
men's cuts are `Natural_Side-Part`, `Side-Part_Crop`, `Side-Parted_Textured`, `FreshSide-Parted`,
`Spiky`, `UnderCut`, `TwoBlockHaircut`, `HighTightFade`, `LowFade`, `SlickBack`, `ManGreased`,
`CombOver`, `BuzzCut`, and `LongHairTiedUp` / `ManBun` for uncut hair. These ship commented out
in `presets.yaml`. Whether the model renders thick straight black Indian hair convincingly, as
opposed to European wave, is **UNVERIFIED and needs an actual Indian portrait to settle**.

### 7.9 Pro's real catalog is 101 male styles, not 22

The old `/doc/ai-portrait/effects/hairstyle-editor-pro/api` page lists 22 male styles. The new
`/docs/...` page ships a picker with **101 male + 139 female**, the same set Premium offers, each
with a preview image. Verified live on 2026-09-19 that Pro accepts ids absent from the old list:

| id | result |
|---|---|
| `Natural_Side-Part` (named, not in the old 22) | `OK`, 10 credits |
| `male_hairstyle_0025` (numbered preset) | `OK`, 10 credits |

So the old page is stale. `catalog.json` in this repo is scraped from the new page and is the
list the UI uses.

### 7.10 Result URLs, and losing a paid image

Result images are served from **`ailab-outputs.oss-accelerate.aliyuncs.com`**, an Alibaba Cloud
OSS accelerate endpoint. This is the only host besides `ailabapi.com` the harness ever contacts,
and it is contacted without the API key.

That host stalls occasionally. Observed 2026-09-19:

```
FAILED  LongHairTiedUp__blue (B)  145924ms  10 credits
        result download failed: ReadTimeout
```

The generation succeeded and **was billed**, but the image was lost because the download timed
out. Since the API bills on generation, not delivery, a download failure costs real money. The
client now uses a short per-attempt read timeout (45s) with 3 retries, and records every result
URL in the `result_urls` CSV column and in the UI, so a lost download can still be recovered by
hand inside the 24h validity window.

### 7.11 The colour swatches are all photos of one woman

Every one of the 21 `color` preview images is the same female model in a bob:
`.../hairstyle-changer-premium/doc/colors/<color>.webp`. That is an asset choice on AILabTools'
side and says nothing about the API: `color` is orthogonal to `hair_style` and applies to whatever
style is requested. For a men's tool the swatches are worse than useless, so the harness samples
the hair region out of each swatch and renders flat colour chips instead (`app/color.py`).

Sampled reference RGBs for the natural shades (median of the fringe band):

| colour | RGB | colour | RGB |
|---|---|---|---|
| black | 20, 19, 17 | grey | 114, 109, 105 |
| brown | 49, 37, 29 | silver | 172, 160, 150 |
| lightBrown | 129, 86, 55 | white | 217, 212, 208 |
| blonde | 186, 160, 136 | red | 113, 22, 17 |
| platinumBlonde | 185, 165, 149 | burgundy | 60, 19, 21 |

Note `blonde` and `platinumBlonde` are nearly identical as rendered, which is why automatic
detection cannot reliably separate them.

### 7.12 `image_size` returns duplicates, not variations

The docs describe `image_size` as "number of result images", 1-4. It does control how many
entries come back in `data.images`, and the cost stays flat at 10 credits. But the entries are
not alternatives.

Measured 2026-09-19 across **9 calls covering 6 styles** at `image_size` 2 and 4, with
`auto=1` and an explicit `color`:

| run | style | requested | files | distinct by md5 |
|---|---|---|---|---|
| 134615 / 134800 | TexturedFringe, CombOver, BuzzCut | 2 | 2 each | **1 each** |
| 135617 | TexturedFringe, CombOver, BuzzCut | 4 | 4 each | **1 each** |
| 141013 | Natural_Side-Part | 4 | 4 | **1** |
| 142820 | BuzzCut | 4 | 4 | **1** |
| 142837 | Spiky | 4 | 4 | **1** |

Not merely similar: **byte-identical**. And the cause is upstream, not a client bug. The
`result_urls` column shows the API returning the *same URL repeated N times*:

```
urls returned: 4 | distinct: 1
d46f1b9a-d506-40bc-94e0-ad715d6ee0c6_1789808369.png   (x4)
```

So `image_size` currently buys nothing but bandwidth. **Leave it at 1.** Both `presets.yaml`
and the UI now default to 1.

This also undercuts the docs' claim that Pro gives "distinct results each time for the same
hairstyle". Within one call it certainly does not. Whether *separate* calls with identical
parameters differ is a distinct question, and the harness's cache deliberately prevents
answering it for free -- use `--no-cache` to test.

**UNVERIFIED:** whether a non-default `auto` value unlocks real variation. The docs define
`auto` only as "1: Automatic mode" and never enumerate other values.
