# Reference material

Copied from the AILabTools harness at `C:\Users\X2\Side projects\AILabTool`, which was tested against the live API on 19 September 2026. CI cannot see that path, so everything the build and tests depend on lives here.

| File                                                                       | Copied from         | Used by                                                                                              |
| -------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| [`ailabtools-api-notes.md`](ailabtools-api-notes.md)                       | `docs/API_NOTES.md` | `src/providers/ailabtools.ts` and its stub. Section 7 holds the measured facts, which beat the docs. |
| [`../../data/ailabtools-catalog.json`](../../data/ailabtools-catalog.json) | `catalog.json`      | `src/config/presets.ts`: a test fails if a preset names a style that is not in the male catalog.     |

Both are verbatim and excluded from Prettier. To refresh them, copy the files again and review the diff. Where this build departs from the harness, and why, is in `docs/decisions/0013-departures-from-the-ailabtools-harness.md`.

## For the front-end task: the browser-side code

The harness does three things in the browser, in `cloudflare/public/index.html` (the `preflight` and `detect` functions). They were not ported with the backend, which was all this repository held at M3; the public site's try-on now does them in `site/src/lib/photo.ts` and `hair-colour.ts` (`docs/frontend.md`).

- **Resize and re-encode.** The photo is scaled to at most 4090 px on the long side and re-encoded as JPEG at quality 0.92, shrinking by 15% until it is under 5 MB. The API refuses anything larger, or anything that is not JPEG or PNG.
- **Hair colour detection.** Skin tone locates the head, texture proves a region is hair, and the median colour is matched in LAB space to the natural shades. The reference RGB values are in section 7.11 of the API notes.
- **One change for this build.** The harness falls back to `black` when it cannot read the hair. `POST /api/tryon/generate` wants `unknown` in that case, so the server can route it by `UNKNOWN_COLOR_ROUTE`.

The harness's `app/color.py` is the Python original of the detector.
