// On staging, Cloudflare Access stands in front of both apps (docs/provisioning.md, step 11), and its sign-in runs out.
// A call it then turns away is sent to its login page (./api.ts, `onAccessLapsed`). A reload would sign in again, but
// each app's service worker answers every page from its copy, so the page never reaches Access. The app sends it there
// itself, marked so the worker lets it through to the network (./sw-requests.ts). Production's apps have no Access in
// front of them, and never meet any of this.

/** The mark on a page's address that sends it past the service worker, named the same in ./sw-requests.ts. */
const SIGN_IN_AGAIN = "signin";

/** Whether this page has been sent once already, or came back from Access: a sign-in that did not take cannot loop. */
let sent = false;

/** `href` marked to go past the service worker, and so through Access's sign-in. */
export function markedForSignIn(href: string): string {
  const url = new URL(href);
  url.searchParams.set(SIGN_IN_AGAIN, "");
  return url.href;
}

/** `href` without the mark, or null when it carried none. */
export function unmarked(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(SIGN_IN_AGAIN)) return null;
  url.searchParams.delete(SIGN_IN_AGAIN);
  return url.href;
}

/** Takes the mark off the address the app opened at, if Access sent it back with one. Called once, as the app starts. */
export function takeSignInMark(): void {
  const back = unmarked(window.location.href);
  if (back === null) return;
  sent = true;
  window.history.replaceState(window.history.state, "", back);
}

/** Sends the page through Access's sign-in, once, and never from a page that has just come back from it. */
export function signInAgain(): void {
  if (sent) return;
  sent = true;
  window.location.assign(markedForSignIn(window.location.href));
}
