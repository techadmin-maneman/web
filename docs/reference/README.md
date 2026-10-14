# Reference material

From the try-on harness at `C:\Users\X2\Side projects\AILabTool`, which tested the providers against their live APIs. CI cannot see that path, so everything the build and tests depend on lives here.

| File                                                             | From                                                              | Used by                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`youcam-api-notes.md`](youcam-api-notes.md)                     | the YouCam handoff and `app/providers/youcam.py`                  | `src/providers/image/youcam.ts` and its stub (ADR 0201)                                  |
| [`../../data/tryon-refs-v1.json`](../../data/tryon-refs-v1.json) | `docs/prompts/youcam-handoff/youcam-refs/manifest.json`, verbatim | `src/config/presets.ts`: a test holds each reference photograph to its size and sha256   |
| [`ailabtools-api-notes.md`](ailabtools-api-notes.md)             | `docs/API_NOTES.md`, verbatim                                     | nothing now: AILabTools made the looks until ADR 0201, and the earlier decisions cite it |

The verbatim copies are excluded from Prettier. To refresh one, copy the file again and review the diff. Where this build departs from the harness, and why, is in `docs/decisions/0013-departures-from-the-ailabtools-harness.md`.

## For the front-end task: the browser-side code

The harness does three things in the browser, in `cloudflare/public/index.html` (the `preflight` and `detect` functions). They were not ported with the backend, which was all this repository held at M3; the public site's try-on now does them in `site/src/lib/photo.ts` and `hair-colour.ts` (`docs/site.md`).

- **Resize and re-encode.** The photo is scaled to at most 4090 px on the long side and re-encoded as JPEG at quality 0.92, shrinking by 15% until it is under 5 MB. The API refuses anything larger, or anything that is not JPEG or PNG.
- **Hair colour detection.** Skin tone locates the head, texture proves a region is hair, and the median colour is matched in LAB space to the natural shades. The reference RGB values are in section 7.11 of the API notes.
- **One change for this build.** The harness falls back to `black` when it cannot read the hair. `POST /api/tryon/generate` wants `unknown` in that case, so the server can route it by `UNKNOWN_COLOR_ROUTE`.

The harness's `app/color.py` is the Python original of the detector.
