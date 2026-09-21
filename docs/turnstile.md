# Turnstile

The booking form (and, from M3, the try-on) renders a Turnstile widget and
sends its token as `turnstile_token`. Site keys are public; the secrets are on
the Workers as `TURNSTILE_SECRET`.

| Environment | Widget                 | Site key                                   | Hostnames                      |
| ----------- | ---------------------- | ------------------------------------------ | ------------------------------ |
| production  | `mm-production`        | `0x4AAAAAAE-0bRotsEzMTpZV`                 | `maneman.in`, `www.maneman.in` |
| staging     | `mm-staging`           | `0x4AAAAAAE-0a-QSaClo_rF3`                 | `staging.maneman.in`           |
| local       | Cloudflare's test keys | `1x00000000000000000000AA` (always passes) | any                            |

Locally the Worker uses Cloudflare's always-pass test secret (`.dev.vars.example`),
which accepts the dummy token `XXXX.DUMMY.TOKEN.XXXX`. Production refuses to
start with a test secret.

Both widgets are in managed mode, in the Cloudflare account that holds
`maneman.in`: dashboard → Turnstile.
