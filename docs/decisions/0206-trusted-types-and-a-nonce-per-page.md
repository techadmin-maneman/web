# 0206. Trusted Types enforced, and a nonce on every page

- Status: accepted
- Date: 2026-10-15
- Topic: The site
- Amends [0023](0023-launch-hardening.md), section 1 on Trusted Types and section 2 on Cloudflare's injected script

## Context

ADR 0023 left Trusted Types in a report-only policy until the reports said what Turnstile's and the analytics tags' scripts would need. It also turned Cloudflare's edge scripts off for the zone, because a static policy cannot allow a script whose contents change with every request. If one is switched back on, `npm run smoke:csp` says so after the next deploy, but until then every page refuses it.

On 15 October 2026 staging's pages were opened in Chromium with Trusted Types enforced. Every page loaded and hydrated without a refusal: Astro's islands and Preact write no HTML or script text. Turnstile rendered and passed with Cloudflare's test key once its loader's address came through a policy. The HTML Turnstile writes goes into its own frame, which has its own policy.

## Decision

- **Trusted Types are enforced.** `require-trusted-types-for 'script'` is part of the site's enforced policy (`site/src/lib/static-files.ts`), and the report-only policy is gone.
  - Turnstile's and the analytics tags' loaders take a script's address from `scriptAddress` (`packages/web-kit/trusted-scripts.ts`), whose policy accepts the site's own origin and the hosts in `SCRIPT_ORIGINS` and nothing else.
  - A default policy, made at the same moment, does the same for a script a tag adds of its own.
  - Neither policy makes HTML or script text, so nothing can write either into a page as a string.
  - A test holds the policy's script hosts to `SCRIPT_ORIGINS`.
- **Every page goes through the site's Worker**, which gives the page's policy a nonce of the request's own in `script-src` (`site/src/worker.ts`).
  - Cloudflare reads a nonce from the policy header and puts it on any script it adds at its edge, so a JavaScript detection or beacon switched back on for the zone still runs. The edge scripts stay off all the same (provisioning, step 14), and `smoke:csp` still fails on any refusal.
  - `run_worker_first` names every page. A test fails when a page is added without it.
  - The 404 answer to an address no page has is still the assets' own, without a nonce.
  - The page's own inline scripts keep their hashes; the nonce is only for what Cloudflare adds.
- **The cost** is one Worker request per page view on the pages the Worker did not already answer. That is within Workers Paid's allowance (ADR 0112).

## Consequences

- A script on a page that writes HTML as a string now fails in the browser, and is reported to `POST /api/csp-reports`. An analytics tag switched on later must load under these policies. If it needs more, its refusals show in staging's `smoke:csp` and in the reports before it reaches production.
- The client app's login uses the same loader. The apps' policies do not enforce Trusted Types, so `scriptAddress` makes no difference there beyond refusing a host not in the list.
