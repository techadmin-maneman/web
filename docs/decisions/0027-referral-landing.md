# 0027. The referral landing: a Worker beside the site's assets

- Status: accepted
- Date: 2026-09-22

## Context

A client shares their invite as a link: `maneman.in/r/ABC123`. Two things have to be right about it.

**The preview.** WhatsApp fetches the page and reads its Open Graph tags. Its crawler runs no JavaScript, so whatever the preview shows has to be in the HTML that comes back — the referrer's first name, if they agreed to be named, and their own card, if they have one. A card that is revoked must stop appearing in new shares, which means the image's address has to carry the card's version (ADR 0048).

**The page itself.** The friend sees who invited them, our prices, how it works, and a pincode box that decides what the page becomes: a consultation form where we come, a waitlist where we do not.

`mm-site` was assets only: a static Astro build served by Workers static assets, with every binding on `mm-api` (the config check enforced it). Neither of two obvious routes works:

- **Serve `/r/*` from `mm-api`.** It would have to reproduce the page's markup, styles and fonts, which live in the Astro build and are reachable only through the assets binding.
- **Fetch the built page from `mm-api` over the internet.** Staging's host sits behind Cloudflare Access, which refuses a request without a service token; a host fetching its own host is exactly that request.

## Decision

`mm-site` gains one Worker beside its assets, `site/src/worker.ts`.

- `run_worker_first: ["/r/*"]` sends those paths to the Worker; everything else is served straight from the assets, as before. **Amended 26 September 2026 ([ADR 0073](0073-prices-from-the-price-book.md)):** it also sends `/` and `/book`, the other pages that show a price, and the Worker writes the price book's figures into all three.
- The Worker fetches the built page through its `ASSETS` binding and reads the invite through a **service binding** to `mm-api` (`API`), which needs no network hop and so is not subject to Access.
- `HTMLRewriter` rewrites the `og:*` and `twitter:*` tags from the invite, and writes the invite itself onto `#invite` as `data-invite`, so the island shows the referrer's name without a second request.
- The page is one Astro page, `site/src/pages/r/index.astro`, built as `r.html`. Every code renders it.
- The preview image is `mm-api`'s `GET /api/og/:code.jpg?v=<version>`, which serves the referrer's card while it is live and redirects to the site's house card otherwise.

`scripts/lib/wrangler-config-check.ts` allows exactly this much and no more: the entry file, the assets binding, the `run_worker_first` paths, and one service binding named `API` pointing at that environment's `mm-api`. Any other binding on `mm-site` is still a failure.

## Consequences

- **The preview is right on the first share,** and a revoked card stops appearing in new ones, because the version is in the image's address.
- **The page is not indexed.** An invite belongs to one person and its address holds their code, so `r.html` carries `noindex` and is left out of the sitemap.
- **`mm-site` is no longer purely static.** Its deploy now ships code, and `site/src/worker.ts` is checked under the Workers runtime rather than the browser (`site/tsconfig.worker.json`), because the site's own TypeScript targets the DOM.
- **Local and the browser tests need the same routing.** `scripts/lib/static-server.ts` maps every `/r/:code` to `r.html`, as `run_worker_first` does behind Cloudflare. The invite is not rewritten there, so the island falls back to fetching `GET /api/r/:code` — which is also what happens if the Worker ever fails to reach `mm-api`.
- **An unknown code still works.** The API answers `state: "unknown"`, the page drops the offer line and says so, and the consultation is still free.
- The Open Graph image is a JPEG, not the prompt's `.png`: it is a photograph, and it has to stay under WhatsApp's 300 KB.
