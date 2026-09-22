# Phase 2 design — source files

Exported from Claude Design on 21 Sep 2026 (`Missing logo and pricing.zip`). Read-only. Do not edit these files; raise disagreements in a PR or an ADR.

| File | What it is | Build status |
|---|---|---|
| `Client App.dc.html` | Phase 2 · 1 of 4. Spec boards A–G for the client app (login, home, visits, photos, payments, refer, profile), plus icons, motion and open questions | **Build.** Source of truth for `mm-app` |
| `Referral and Waitlist.dc.html` | Phase 2 · 2 of 4. The 1200×630 referral card, Android and iOS chat previews, WhatsApp message copy, and the `/r/:code` landing page (mobile and 1440 desktop) | **Build.** Source of truth for the referral card and landing |
| `Technician App.dc.html` | Phase 2 · 3 of 4. Today, job detail, in-job steps, the client-not-home evidence chain, contrast and gloved-use rules | **Build**, as a front end over Zoho FSM. Source of truth for `mm-tech` |
| `Ops Console.dc.html` | Phase 2 · 4 of 4. Dispatch board (A), client page with pieces, photographs and consents (B), referrals and waitlist (C) | **Build all sections**, as a front end over Zoho FSM. Source of truth for `mm-ops` |
| `Phase 2 Prototype.dc.html` | A clickable prototype joining the four surfaces | **Flow and timer reference only.** Where it differs from a spec board, the spec board wins |
| `support.js` | The Claude Design prototype runtime. Byte-identical to `design/support.js` | Needed only to render the design files |
| `assets/` | The four images these files reference: `ba-before.jpg`, `ba-after.jpg`, `hair-texture.jpg`, `membrane-on-skin.jpg` | Placeholders. Not for production |

Brand files, tokens and fonts come from `design/brand/` and the shared tokens package, not from here.

## Rendering these files for fidelity checks

Use the same method as `docs/fidelity/README.md`. Each file loads React 18.3.1, ReactDOM 18.3.1 and `@babel/standalone` 7.29.0 from unpkg, and fonts from Google. Route those requests to local npm copies and self-hosted fonts in Playwright.

The spec boards are drawn at fixed widths: phone frames at 390 px, and the ops console at 1440 px shown at 1000 px. Compare the built screens against the frames, not against the whole board.

## Known defects in the files, already ruled on in the Phase 2 prompts

- The Prototype's *See the public site* links point to `./Mane Man Site.dc.html` (Phase 1 v1), which is deliberately not in the repo. Ignore them; the Phase 1 design is `design/Mane Man Site v2.dc.html`.
- The referral code `RM4417` reuses the last four digits of the example client's mobile number. Real codes are random.
- Prices, windows and service area differ from the Phase 1 site. Prices and serviceability come from the price book and the pincode table, never from these files.
