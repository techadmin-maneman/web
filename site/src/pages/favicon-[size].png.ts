// The browser tab's icons, favicon-16.png, favicon-32.png and favicon-48.png: built from the brand kit at build time.
import type { GetStaticPaths } from "astro";
import { FAVICON_SIZES, faviconImage, type FaviconSize } from "../lib/brand-images.ts";

export const getStaticPaths = (() =>
  FAVICON_SIZES.map((size) => ({ params: { size: String(size) }, props: { size } }))) satisfies GetStaticPaths;

export async function GET({ props }: { props: { size: FaviconSize } }): Promise<Response> {
  return new Response(new Uint8Array(await faviconImage(props.size)), { headers: { "Content-Type": "image/png" } });
}
