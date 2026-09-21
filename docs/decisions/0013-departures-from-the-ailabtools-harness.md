# 0013. Departures from the AILabTools harness

- Status: accepted
- Date: 2026-09-21

## Context

The AILabTools integration at `C:\Users\X2\Side projects\AILabTool` was tested against the live API on 19 September 2026. It was read, not modified, before any M3 code was written:

- `docs/API_NOTES.md`, copied verbatim to `docs/reference/ailabtools-api-notes.md`;
- `app/client.py`, `cloudflare/src/index.js` and `presets.yaml`;
- `catalog.json`, copied to `data/ailabtools-catalog.json`;
- `cloudflare/public/index.html`, described in `docs/reference/README.md` for the front-end task.

None of its secrets, photographs or `.wrangler/` state were opened. The test photos here are synthetic headers with no picture (`test/worker/tryon-fixtures.ts`).

The prompt asks for a record of every place this build departs from the harness, and why.

## What is kept

The measured facts of section 7 of the API notes are kept, each in `src/providers/ailabtools.ts`:

- Endpoint A is never called (7.1).
- Pro is the default endpoint, because it keeps the face (7.7).
- Every Pro call sends a colour (7.5).
- Each endpoint gets its own form: Pro takes `task_type=async`, `auto=1` and `image_size=1`; Premium takes none of them (3, 4, 7.12).
- Pro's result is read from `data.images[0]`, Premium's from `data.image` (0).
- The image part is named after its bytes, as in the harness's `_part()` (7.2).
- The credits pools are summed (0).
- `task_status === 2` means done (1).
- Results are downloaded without the API key, three tries at 20 seconds each, and labelled by their magic bytes (7.10).
- The API key is scrubbed from every stored or logged string.

## Departures

| #   | Harness                                                                                                   | Here                                                                                                                                                                                                                                     | Why                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The browser polls `/api/status` with the provider's `task_id`.                                            | The render consumer polls from a queue, one poll per delivery, retrying with a delay of 5 s for 30 s, then 10 s. The browser sees only our job ID and a state.                                                                           | Required by the prompt. A claim must work before the result is ready, so the server has to own the render.                                           |
| 2   | A shared password gates the API.                                                                          | Turnstile on the upload link, per-address and per-number rate limits, and global daily ceilings.                                                                                                                                         | Required by the prompt. A password shared with every customer is not a control.                                                                      |
| 3   | Results are cached in R2 by photo and parameters, with no expiry, and served to any request that matches. | No cache. An identical request is answered with the job that already exists for the same photo, look and colour, within that visitor's session. Results are deleted after `RESULT_RETENTION_DAYS`, photos an hour after their last look. | One person's render must never be served to another, and the photo notice promises deletion within thirty days.                                      |
| 4   | Each run is logged as CSV rows in R2.                                                                     | D1 `events` and the structured logger.                                                                                                                                                                                                   | Required by the prompt. R2 is billable, and a CSV log is personal data kept forever.                                                                 |
| 5   | One file.                                                                                                 | `src/providers/image.ts` (the interface), `ailabtools.ts` (the adapter), `ailabtools-stub.ts` (a fake API that the real adapter talks to).                                                                                               | Required by the prompt. The stub replays the documented shapes, so tests exercise the real parsing.                                                  |
| 6   | The Worker labels every part `portrait.jpg`, `image/jpeg`.                                                | Named and typed from the bytes, as the Python client does.                                                                                                                                                                               | Premium checks the extension (7.2); the Worker only called Pro, which does not.                                                                      |
| 7   | Polls every 3 s, backing off with jitter to 15 s.                                                         | 5 s, then 10 s after 30 s, as the prompt says; the API docs recommend 5 s. After 3 minutes it slows to once a minute and gives up at 15 minutes, not the prompt's 180 s.                                                                 | Each poll is a queue operation (docs/decisions/0009). A Premium render on staging took 6½ minutes and was billed while it ran (docs/decisions/0015). |
| 8   | A failed download leaves the URL in the CSV for recovery by hand.                                         | The URL and its 24-hour expiry are stored before downloading. The queue retries three times, then the sweeper retries until the URL expires; only then does the job fail, with an alert.                                                 | Required by the prompt: a billed image must not be lost, and must never be rendered again.                                                           |
| 9   | Pre-flight re-encodes anything that is not JPEG or PNG (Pillow, or the browser).                          | The browser still re-encodes. The API refuses anything that is not a JPEG or PNG by its bytes, over 5 MB, or outside 200 to 4090 px, and does not re-encode.                                                                             | Workers has no image library on the free plan, and the prompt limits uploads to JPEG and PNG.                                                        |
| 10  | Errors are passed through as `error_msg`.                                                                 | Classified by HTTP status and message into `photo_invalid_file`, `photo_unreadable` or `render_failed`, and marked transient or needing an alert. The scrubbed detail is stored on the job.                                              | There is no published error table (5). The customer's page needs a stable code, and ops need to know when to act.                                    |
| 11  | Credits are read before and after each call, to measure the cost.                                         | An hourly check against `AILAB_CREDIT_FLOOR`. The per-call cost is the measured table (Pro 10, Premium 15).                                                                                                                              | Two extra API calls per render buy nothing in production. An exhausted balance is what must not go unnoticed.                                        |
| 12  | The browser's detector falls back to `black` when it cannot read the hair.                                | `unknown`, routed by `UNKNOWN_COLOR_ROUTE`: Premium with `original` by default, or Pro with `black`.                                                                                                                                     | Required by the prompt. The route taken is recorded on the job.                                                                                      |
| 13  | Six presets compare Pro and Premium on three styles.                                                      | Six customer-facing looks from the design, all on Pro, with placeholder styles from the catalog.                                                                                                                                         | The harness's presets were an experiment. The bake-off will choose the real styles.                                                                  |
| 14  | The photo is posted straight to the Worker with the generate call.                                        | `POST /api/tryon/upload-url` records the consent and returns a one-time link; `PUT /api/tryon/upload/:job_id` stores the photo.                                                                                                          | The prompt's presigned R2 link could be replayed until it expires, and each replay is a billed R2 write (docs/decisions/0014-try-on-api.md).         |

## Consequences

- Refresh `docs/reference/` from the harness whenever it records a new measurement, and revisit this table.
- The harness's `inputs/`, `out/`, `cache/` and `refs/` hold photographs of real people. They must never be used as test data here.
