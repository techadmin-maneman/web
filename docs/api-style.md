# API style

How a route is named and what it answers, so that a new endpoint can be guessed from its resource. The rules marked
_checked_ are held by `test/node/tooling/api-style.test.ts` against the generated documents (`docs/openapi*.json`).
What breaks them today is listed in `test/node/tooling/api-style-baseline.ts`, which may only shrink: a route on that
list is put right when it is next touched (see [Changing a route](#changing-a-route)).

## Paths

- Each surface has its own host (the site, the client app, the console, the tech app), so a path never names its
  surface. _Checked._ The tech app's `/api/tech/…` paths are the one exception, and move together.
- A resource is named for what it is, in the words of [glossary.md](glossary.md): a client's visit is `visits`, a
  technician's is `jobs`. Collections are plural and hyphenated: `/api/blackouts`, `/api/stock/places/{id}`.
- What is searched for goes in a POST body, never a query string, so a number stays out of addresses and logs.

## Methods

| To                      | Ask                                                 | Answer                                                                   |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| Read                    | `GET`                                               | 200 with what was asked for. A GET never writes, but to the audit log    |
| Create                  | `POST` to the collection                            | 201 with the record made. _Checked_                                      |
| Change part of one      | `PATCH /{id}`                                       | 200 with the record as it now stands                                     |
| Remove                  | `DELETE /{id}`                                      | 204. _Checked:_ never `POST …/delete` or `…/remove`                      |
| Move one to a new state | `POST /{id}/{verb}`: `cancel`, `close`, `resolve`   | 204, or 200 with the record changed. Never a body of one flag. _Checked_ |
| Rule on one             | `POST /{id}/decision`, with `decision` and `reason` | As a change of state. _Checked:_ never `/decide` or `/ruling`            |
| Upload a file           | `PUT` to the address that names it                  | 204. _Checked:_ PUT carries a file, never JSON                           |

`GET /api/refer`, which makes a client's referral code the first time it is read, is the one GET that writes; the
test cannot see it, and names it.

## Bodies

- Fields are snake_case, and every object is strict: a field the document does not name is never sent.
- An instant is ISO 8601 in UTC; a day is India's date, `YYYY-MM-DD`; money is whole paise.
- A refusal is the error body of `src/http/errors.ts`: a stable code and the request ID, and the fields at fault.
- A code check answers `verified`, and `attempts_left` when the code was wrong. _Checked._

## Lists

- A list that pages takes `cursor` and answers `next_cursor`, null on the last page (`src/http/paging.ts`). The page
  size is the server's, named in the route's description, and the cursor is opaque: the caller sends back what it
  was given. _Checked:_ never `before`, `offset` or `page`.
- A list held to its first so many (a queue, a day's lines) answers `more` when there were more, and the console says
  so beneath it ("Showing the first 200").
- No list is read without a bound.

## Changing a route

- A path or field is added, never changed in place. A new name goes in beside the old, which stays as an alias marked
  `deprecated` in its route until nothing calls it.
- The console is released with the API, so a route only the console calls may change with it in one release.
- The client and tech apps are installed, and a phone can run an old copy for days. A route they call keeps its old
  path or field as an alias until the release that stopped calling it has been live for a month.
- No version goes in a path: the surfaces and the API release together, and an alias does what a version would.
- A route on the baseline is put right when it is next touched, with an alias where an app calls it, and its line
  comes off the baseline in the same change.
