// /favicon.ico, which browsers and crawlers ask for whatever a page links: the tab's three icons in one file.
import { faviconIco } from "../lib/brand-images.ts";

export async function GET(): Promise<Response> {
  return new Response(new Uint8Array(await faviconIco()), { headers: { "Content-Type": "image/x-icon" } });
}
