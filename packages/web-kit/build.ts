/**
 * The build this page runs, as its index.html names it (`<meta name="mm-version">`, written by each app's
 * vite.config.ts), so the API's logs can tell a page left open on an old build; null where a page has none.
 */
export function pageBuild(): string | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLMetaElement>('meta[name="mm-version"]')?.content.slice(0, 40) ?? null;
}
