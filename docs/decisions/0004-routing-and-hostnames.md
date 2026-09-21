# 0004. Routing and hostnames

- Status: accepted
- Date: 2026-09-21

## Context

Two Workers share one origin: `mm-api` serves `/api/*`, `mm-site` everything else. Staging is `staging.maneman.in` behind Cloudflare Access and `noindex`; production is `maneman.in`.

## Decision

- `mm-api` routes: `staging.maneman.in/api/*` and `maneman.in/api/*`.
- `mm-site` routes: `staging.maneman.in/*` and `maneman.in/*`. Routes, not a Custom Domain: Cloudflare matches the most specific route, so `/api/*` reaches `mm-api` and the rest reaches `mm-site`. Custom Domains also do not support per-Worker API-token roles, which 0007 relies on.
- Both hostnames need a proxied DNS record with no origin behind it (`AAAA 100::`), created once at provisioning.
- `workers_dev` and `preview_urls` are `false` in every environment. A `*.workers.dev` hostname would bypass both the zone and Cloudflare Access.
- Staging is `noindex` three ways: `X-Robots-Tag` on every API response, `_headers` and `robots.txt` on the site, and a robots meta tag on the page.
- Routes are applied when an owner bootstraps an environment (`wrangler deploy`). CI only uploads versions and moves traffic between them (0006), which never changes routes.

## Consequences

- `www.maneman.in` is not routed. Whether it redirects to the apex is a launch decision for the front-end task.
- The Access application must cover `staging.maneman.in/*`, including `/api/*`. The smoke suite authenticates with an Access service token.
