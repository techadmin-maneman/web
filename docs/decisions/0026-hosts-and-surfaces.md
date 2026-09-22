# 0026. Hosts and surfaces

- Status: accepted
- Date: 2026-09-22

## Context

Phase 2 adds three sites next to the public one: the client app, the ops console and the technician app. Each needs its own API routes, and each is used by a different group of people:

- **the client app:** clients, signed in by a code;
- **the ops console:** staff, through Cloudflare Access;
- **the technician app:** technicians, on an enrolled phone.

All of them are served by `mm-api`, since the Free plan leaves no room for a Worker per API (ADR 0009). A client's session must never reach an ops route, and an ops route must not exist on the client's host at all.

The owner chose the staging hosts on 22 September 2026: `app-staging.maneman.in`, `ops-staging.maneman.in` and `tech-staging.maneman.in`. They sit one level below the zone because the free Universal SSL certificate covers `*.maneman.in` and not `*.staging.maneman.in`.

## Decision

**Four surfaces, one app each.** `src/config/environments.ts` names the surfaces:

- `public`: the Phase 1 site;
- `client`: the client app;
- `ops`: the ops console;
- `tech`: the technician app.

`SURFACE_HOSTS` gives each surface's host in staging and production. `createApp(config, deps, surface)` builds one `OpenAPIHono` per surface, with only that surface's routes (`SURFACE_ROUTES` in `src/app.ts`).

**The host picks the app.** `byHost` in `src/http/surfaces.ts` sends each request to the app for its host. A route therefore answers only on its own surface's host; on any other host it is a `404`. A host the environment does not serve gets a bare `404 not_found` that never reaches an app, such as the other environment's host or a host that only points at us.

- **Locally**, `app.localhost`, `ops.localhost` and `tech.localhost` are the client, ops and technician surfaces. Chromium, which the browser tests use, and Firefox resolve them to the loopback address without any setup. Every other host is the public site, so `localhost:8787` and the tests work as before.

**Surfaces are switched on one at a time.** `ENABLED_SURFACES` lists the surfaces each environment serves. Today staging and production serve `public` alone. A surface is switched on only once three things exist:

- its DNS record (`AAAA 100::`, as in ADR 0004);
- its Access application;
- its route.

The config check requires the routes to match exactly: one `<host>/api/*` route in `mm-api` for each switched-on surface, and no others. A surface cannot be switched on without its route, or routed while it is switched off. As in ADR 0004, a new route is applied by the owner's `wrangler deploy`, because CI never changes routes.

**Writes on the Phase 2 surfaces need their own Origin.** Every `*.maneman.in` host counts as the same site, so a `SameSite=Lax` cookie alone would let a page on one surface post to another surface's API. On the `client`, `ops` and `tech` surfaces, `requireSameOrigin` (`src/http/origin.ts`) refuses any request other than `GET`, `HEAD` or `OPTIONS` unless its `Origin` is the request's own. A refused request gets `403 forbidden_origin` and logs `cross_origin_write_refused`. The public site keeps its Phase 1 guards, Turnstile on the forms and a signed token on each upload, and gets no Origin check in this change.

**Logs name the surface.** Every line an app writes carries `surface`, so a request can be traced to the app that served it.

## Consequences

- **Phase 1 is unchanged.** The public app has the same routes, and `docs/openapi.json` is regenerated only for the new error code. Each Phase 2 surface gets its own OpenAPI document with its first routes (P2-M1).
- **Smoke on the new hosts waits for the owner.** Before a staging surface can be switched on, the owner has to create its DNS record, its Access application and its CI service token. Until then its tests run locally, on the `.localhost` hosts.
- **Webhooks from Razorpay, Zoho FSM and Evolution** arrive at `/api/hooks/*` on the public host. On staging that path needs an Access bypass, which the owner has yet to create. They carry no Origin; each one is authenticated by its own signature or secret.
- **Tests:**
  - `test/worker/surfaces.test.ts`: the host map; each surface's health check; every public route answering `404` on the other hosts; the bare `404` for a host the environment does not serve.
  - `test/worker/origin.test.ts`: writes from the surface's own origin, from no origin, from another surface, over `http` and from an opaque origin.
  - `test/node/wrangler-config-check.test.ts`: refuses a route for a surface that is switched off.
