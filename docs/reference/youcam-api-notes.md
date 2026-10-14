# YouCam hair-transfer V2.1: the facts this build relies on

From the owner's handoff (`Side projects\AILabTool\docs\prompts\youcam-handoff\switch-to-youcam.md`, 14 October 2026) and its harness (`app/providers/youcam.py`), which tested the live API; the docs are https://docs.perfectcorp.com/reference/ai_hairstyle.md, read 11 October 2026. "Measured" marks the harness's own runs. The adapter is `src/providers/image/youcam.ts`; the decision is ADR 0201.

## 1. Calls

| Step       | Call                                                                                                           | Answer                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth       | `Authorization: Bearer <YOUCAM_API_KEY>`, a static key, to `https://yce-api-01.makeupar.com` only              | 401 `InvalidAccessToken`, `InvalidApiKey`, `InactiveApiKey`, `ExpiredApiKey`                                                                                          |
| Upload URL | `POST /s2s/v2.0/file`, `{"files":[{"content_type":"image/jpg","file_name":"selfie.jpg","file_size":<bytes>}]}` | `data.files[0].file_id`, and `data.files[0].requests[0]`: `{method: "PUT", url, headers}`                                                                             |
| Upload     | `PUT` the bytes to that `url` with exactly those headers and **no** key: it is a signed storage URL            | 200                                                                                                                                                                   |
| Task       | `POST /s2s/v2.1/task/hair-transfer`, `{"src_file_id", "ref_file_url", "hair_color": "src"}`                    | `data.task_id`                                                                                                                                                        |
| Poll       | `GET /s2s/v2.1/task/hair-transfer/<task_id>`                                                                   | `data.task_status`: `running`, `success` or `error`; on success `data.results.url` (an object, not a list); on error `data.error`, the code, and `data.error_message` |
| Result     | `GET` the result URL, without the key, at once: it expires after **2 hours**                                   | the image                                                                                                                                                             |
| Balance    | `GET /s2s/v1.0/client/credit`                                                                                  | `results[].amount_dec` (or `data.results[]`), summed                                                                                                                  |

`hair_color` picks only the source's colour or the reference's; `src` keeps the visitor's own. Hair-transfer documents no webhook, so it is polled.

## 2. Limits

- **The photograph:** a JPEG only; at most 1024 px on the long side; under 10 MB. A face at least 128 px wide, one face, the whole face, the shoulders in frame, and a head pose within pitch ±10°, yaw ±45° and roll ±15°.
- **The rate:** 250 requests per 300 s, per address and per key, shared by every caller.
- **Retention:** YouCam keeps uploaded files for 30 days.

## 3. Cost and speed (measured)

- 2 units a render, for every look; a refused call costs nothing. About $0.055 a unit pay-as-you-go (unconfirmed), so about $0.11 a render.
- About 15 s a render end to end with 10 s polling: a mean of 14.8 s over 12 renders with the supplied references. Every task had finished by the first 10 s poll.
- With our own adapter, polling every 2 s and the references served from maneman.in: 8 to 9 s a render end to end, 2 units each, six of six OK for one test photograph (14 October 2026).
- With the six references, 18 of 18 renders were OK across three test photographs, and the face below the hairline was left essentially untouched. `error_hair_too_short` and `error_bald_image` never came, even for a shaved head.

## 4. Errors

| YouCam code                                                                                         | What it means here                                             |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `error_no_shoulder`                                                                                 | The shoulders are out of frame                                 |
| `error_large_face_angle`, `error_face_pose`, `error_pose`                                           | The face is turned from the camera                             |
| `error_no_face`, `error_insufficient_landmarks`                                                     | No face it can read                                            |
| `error_multiple_people`                                                                             | More than one person                                           |
| `exceed_max_filesize`, `error_exceed_max_image_size`, `error_decode_image`, `error_unsupport_ratio` | A photograph our preparation should never have sent            |
| `error_hair_too_short`, `error_bald_image`                                                          | YouCam will not style the head: it would turn away our clients |
| `error_nsfw_content_detected`                                                                       | A photograph it refuses outright                               |
| `error_inference`, `unknown_internal_error`                                                         | Its model failed; worth one more render                        |
| HTTP 400 `CreditInsufficiency`                                                                      | Out of units                                                   |
| HTTP 429                                                                                            | Over the rate; try again, backing off                          |

## 5. The references

One synthetic, AI-generated man (not a real person), the same face in all six, each a JPEG 1024 px on the long side, final and tested: `data/tryon-refs-v1.json` lists each file's size and sha256. Each full photograph has a small generator mark on the T-shirt, bottom right; what visitors see is the 512 × 512 head-and-shoulders crop, which stops above it. Blunt fringes in a reference came back helmet-like in testing; a replacement keeps the same man, a frontal pose, the shoulders visible and soft, broken fringes, and goes under a new version.
