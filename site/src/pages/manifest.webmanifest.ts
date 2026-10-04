// What "Add to Home screen" names and draws for the site: a bookmark with the brand's name, icon and ink. The site is
// no app, so it opens in the browser, as any page does.
import { business } from "../content/site.ts";
import { HOME_SCREEN_SIZES, token } from "../lib/brand-images.ts";

export function GET(): Response {
  const ink = token("--ink");
  const manifest = {
    name: business.name,
    short_name: business.name,
    start_url: "/",
    display: "browser",
    background_color: ink,
    theme_color: ink,
    icons: HOME_SCREEN_SIZES.map((size) => ({
      src: `/icon-${String(size)}.png`,
      sizes: `${String(size)}x${String(size)}`,
      type: "image/png",
    })),
  };
  return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
