// The home-screen icons the manifest names, icon-192.png and icon-512.png: built from the brand kit at build time.
import type { GetStaticPaths } from "astro";
import { HOME_SCREEN_SIZES, homeScreenIcon, type HomeScreenSize } from "../lib/brand-images.ts";

export const getStaticPaths = (() =>
  HOME_SCREEN_SIZES.map((size) => ({ params: { size: String(size) }, props: { size } }))) satisfies GetStaticPaths;

export async function GET({ props }: { props: { size: HomeScreenSize } }): Promise<Response> {
  return new Response(new Uint8Array(await homeScreenIcon(props.size)), { headers: { "Content-Type": "image/png" } });
}
