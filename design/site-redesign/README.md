# Site redesign prototype, 17 November 2026

The approved prototype of the public site, from the design canvas https://claude.ai/artifact/XRXoLk736jQHLb2hVMqcfN. The brief that builds it is `docs/prompts/site-redesign.md`.

- `boards/`: the 24 artboards in the canvas's `.dc.html` format. `Main` and `Phone*` are 390 × 844; `Laptop*` are 1440 × 900. Each is interactive in the canvas: the home pages' sliders, toggles and questions, the whole `/book` and `/try` flows, and every guide, city and stop page inside its board.
- `screens/`: full-page renders of every board and state with the real assets in place, `Phone-*` at 390 px and `Laptop-*` at 1440 px. Rendered outside the canvas, so a video shows its poster.

## Images

The boards point their images at the canvas's storage (`/_blob/<id>`), which does not load here. Each stands for a file already in the repo:

| Blob | File |
|---|---|
| `46c99c5eb0be46270893d5352e07bb7c` | `design/brand/lockup-navy.svg` |
| `b973a775e3f46aa5ea5548b5a149c5fd` | `design/brand/lockup-white.svg` |
| `7130bf7a4c2f38082622061f6cfaa682` | `site/src/assets/fit-film.mp4` |
| `bc87db6d919f08c22c0932d213f1737a` | `site/src/assets/fit-film-phone.mp4` |
| `16cd1a46342a9abc6eb6b51cd94ca1d3` | `site/src/assets/fit-film-poster.jpg (a frame of the film)` |
| `12e6ac892d293817cff2a6d95a220451` | `site/src/assets/fit-film-poster.jpg (the phone cut's poster, as built)` |
| `a61f447e2f699745f59ad83d99a48b3e` | `site/src/assets/result-2-before.jpg` |
| `9815d97bc5d84b0fbae65f5ac30d85e0` | `site/src/assets/result-2-after.jpg` |
| `a5492dcc8a58cdd102717ad0b2414525` | `site/src/assets/norwood-3.jpg` |
| `bbab40e5c65579e47942dd15aba0f368` | `site/src/assets/norwood-4.jpg` |
| `42bda878273d884f5adf41aa981869b5` | `site/src/assets/norwood-5.jpg` |
| `83b08d225cf5f12f13718335d7d1a361` | `site/src/assets/norwood-6.jpg` |
| `4a2ba88c85e96be053da77fbefde5362` | `site/src/assets/norwood-7.jpg` |
| `a07b75b76ded983aa1ee549560968fe0` | `site/src/assets/norwood-restored.jpg` |
| `ec91a2c2f8571d957ec002fff1a7e49c` | `site/src/assets/tryon-before.jpg` |
| `e95078326f2527d0d4f8c838bc12afc1` | `site/src/assets/tryon-after.jpg` |
| `639c2a63f11b7d0d6540cbeca2c04a5e` | `site/src/assets/step-consultation.jpg` |
| `9163b1cbe05919d0f57a68586e3af776` | `site/src/assets/step-first-fit.jpg` |
| `f4b4d4e26ae533e08364cff24ae8a856` | `site/src/assets/step-service.jpg` |

The guides' photographs, the try-on's six looks and the results' other three pairs are drawn in the boards as stand-ins; the build uses `content/guides.ts`, `look-*.jpg` and all four `resultPairs`. Lines starting "Prototype:" in the boards are test controls, not site copy.
