// The card shown when a page is shared: built from the brand kit at build time.
import { openGraphImage } from "../lib/brand-images.ts";

export async function GET(): Promise<Response> {
  return new Response(new Uint8Array(await openGraphImage()), { headers: { "Content-Type": "image/png" } });
}
