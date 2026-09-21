// The home-screen icon iPhones ask for: built from the brand kit at build time.
import { appleTouchIcon } from "../lib/brand-images.ts";

export async function GET(): Promise<Response> {
  return new Response(new Uint8Array(await appleTouchIcon()), { headers: { "Content-Type": "image/png" } });
}
