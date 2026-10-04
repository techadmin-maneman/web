# Turnstile

Every form a stranger can send renders a Turnstile widget (`packages/web-kit/turnstile.ts`) and sends its token
as `turnstile_token`, which mm-api checks against the environment's secret, `TURNSTILE_SECRET`, before anything
else is read or counted. Site keys are public.

| Form                                              | Route                                                 | Widget                |
| ------------------------------------------------- | ----------------------------------------------------- | --------------------- |
| The site's booking form, `/book`                  | `POST /api/consultation`                              | the site's            |
| The site's waitlist, for a pincode not served yet | `POST /api/waitlist`                                  | the site's            |
| An invite's booking form, `/r/:code`              | `POST /api/r/{code}/consultation`                     | the site's            |
| An invite's waitlist                              | `POST /api/r/{code}/waitlist`                         | the site's            |
| The number check before a one visit or a try-on   | `POST /api/number-code`                               | the site's            |
| The try-on's upload                               | `POST /api/tryon/upload-url`                          | the site's            |
| The client app's login                            | `POST /api/auth/otp`, so strangers cannot spend codes | the app's (see below) |

| Environment | Widget                 | Site key                                   | Hostnames                                          |
| ----------- | ---------------------- | ------------------------------------------ | -------------------------------------------------- |
| production  | `mm-production`        | `0x4AAAAAAE-0bRotsEzMTpZV`                 | `maneman.in`, `www.maneman.in`; `app.maneman.in`\* |
| staging     | `mm-staging`           | `0x4AAAAAAE-0a-QSaClo_rF3`                 | `staging.maneman.in`                               |
| local       | Cloudflare's test keys | `1x00000000000000000000AA` (always passes) | any                                                |

\* To add before the client app goes live in production (`docs/go-live.md`,
section 4). The app on staging uses the always-pass test key, as a local run
does: staging's API accepts its dummy token, and `mm-staging` does not list
`app-staging.maneman.in`.

Locally the Worker uses Cloudflare's always-pass test secret (`.dev.vars.example`),
which accepts the dummy token `XXXX.DUMMY.TOKEN.XXXX`. Production refuses to
start with a test secret.

A token Cloudflare passes is still refused if it was solved on a page not listed for the
environment (`TURNSTILE_HOSTS`, `src/config/environments.ts`; staging also takes `app-staging.maneman.in`).
The Worker logs `turnstile_wrong_host` with the hostname. A local run checks no hostname.

Both widgets are in managed mode, in the Cloudflare account that holds
`maneman.in`: dashboard → Turnstile.
