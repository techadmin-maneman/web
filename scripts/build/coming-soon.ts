// The page maneman.in serves until the site goes live there (PRODUCTION_LIVE, site/src/lib/flags.ts), built into
// site/dist/production in place of the site: the brand, a line, and WhatsApp to be told when it opens. It carries the
// site's own security headers and is never indexed. The try-on's reference photographs go with it, since staging's
// try-on asks YouCam to fetch them from production's host (src/config/presets.ts).

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { colourOf } from "@maneman/brand/colours";
import { MARK, WORDMARK } from "@maneman/brand/marks";
import { WHATSAPP_NUMBER, whatsappChat } from "@maneman/web-kit/whatsapp";
import { comingSoon } from "../../site/src/content/coming-soon.ts";
import { contentSecurityPolicy, headersFile, robotsFile, securityTxt } from "../../site/src/lib/static-files.ts";

const FONTS = "node_modules/@fontsource";
const tokens = readFileSync("packages/brand/tokens.css", "utf8");
const colour = (name: string) => colourOf(name, tokens);

/** The page's one stylesheet, a file of its own so the policy needs no hash for it. */
const STYLES = `@font-face{font-family:"EB Garamond";src:url(/fonts/serif.woff2) format("woff2");font-display:swap}
@font-face{font-family:"Instrument Sans";src:url(/fonts/sans.woff2) format("woff2");font-display:swap}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:${colour("--ink")};color:${colour("--paper")}}
body{font:17px/1.6 "Instrument Sans",system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:32px 16px}
main{max-width:560px;text-align:center}
.brand{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:48px}
.brand svg{fill:${colour("--gilt")}}
.brand .word{fill:${colour("--paper")}}
h1{font:400 clamp(32px,6vw,48px)/1.15 "EB Garamond",serif;margin:0}
p{margin:16px 0 0;color:${colour("--ink-muted")}}
a.action{display:inline-flex;align-items:center;min-height:48px;margin-top:32px;padding:0 24px;border:1px solid ${colour("--paper")};color:${colour("--paper")};text-decoration:none}
a.action:hover{background:${colour("--paper")};color:${colour("--ink")}}
a:focus-visible{outline:2px solid ${colour("--paper")};outline-offset:3px}
`;

/** A page in the holding look: the brand, then what it says. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="mm-worker" content="mm-site" />
    <meta name="mm-environment" content="production" />
    <meta name="theme-color" content="${colour("--ink")}" />
    <title>${title}</title>
    <link rel="stylesheet" href="/coming-soon.css" />
  </head>
  <body>
    <main>
      <div class="brand">
        <svg viewBox="${MARK.viewBox}" width="44" height="48" aria-hidden="true"><path d="${MARK.d}"></path></svg>
        <svg class="word" viewBox="${WORDMARK.viewBox}" width="160" height="23" role="img" aria-label="Mane Man"><path d="${WORDMARK.d}"></path></svg>
      </div>
      ${body}
    </main>
  </body>
</html>
`;
}

/** Writes the page and everything beside it into `out`, production's build folder unless a test gives its own. */
export function buildComingSoon(out = "site/dist/production"): void {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(`${out}/fonts`, { recursive: true });
  const waitlist = whatsappChat(WHATSAPP_NUMBER, comingSoon.waitlistMessage);
  writeFileSync(
    `${out}/index.html`,
    page(
      comingSoon.title,
      `<h1>${comingSoon.heading}</h1>
      <p>${comingSoon.body}</p>
      <a class="action" href="${waitlist}">${comingSoon.waitlist}</a>`,
    ),
  );
  writeFileSync(
    `${out}/404.html`,
    page(comingSoon.title, `<h1>${comingSoon.notFound}</h1>\n      <a class="action" href="/">${comingSoon.home}</a>`),
  );
  writeFileSync(`${out}/coming-soon.css`, STYLES);
  cpSync(`${FONTS}/eb-garamond/files/eb-garamond-latin-400-normal.woff2`, `${out}/fonts/serif.woff2`);
  cpSync(`${FONTS}/instrument-sans/files/instrument-sans-latin-400-normal.woff2`, `${out}/fonts/sans.woff2`);
  cpSync("site/public/refs", `${out}/refs`, { recursive: true });
  const csp = contentSecurityPolicy({ scripts: [], styles: [] }, { ga4: null, googleAds: null, metaPixel: null });
  writeFileSync(`${out}/_headers`, headersFile(false, csp));
  writeFileSync(`${out}/robots.txt`, robotsFile(false));
  mkdirSync(`${out}/.well-known`, { recursive: true });
  writeFileSync(`${out}/.well-known/security.txt`, securityTxt(new Date()));
}
