// Whether the app is running from the home screen rather than in a browser tab.
//
// It matters on an iPhone, where an installed web app is a separate thing from
// Safari: its own cookie jar, its own IndexedDB and its own service worker. A
// technician who installs the app is therefore signed out and has to sign in
// once more, and the sign-in says so rather than letting him think his account
// has gone (apps/tech/src/login/SignIn.tsx).
//
// `display-mode: standalone` is the standard test and is what iOS 16.4 and
// later answer; `navigator.standalone` is Apple's own flag, and the only one
// older iPhones have.

interface AppleStandalone {
  readonly standalone?: boolean;
}

export function installed(): boolean {
  if ((navigator as AppleStandalone).standalone === true) return true;
  return window.matchMedia("(display-mode: standalone)").matches;
}
