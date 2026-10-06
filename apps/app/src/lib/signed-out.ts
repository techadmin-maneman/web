// Whether this phone's client logged out, or saw their session end, and has
// not signed in since. Offline, the app cannot ask the API whether there is a
// session; a phone that knows it signed out opens on the login rather than
// on the error state, which is for a client who is still in. It
// records no one and nothing about them, only that the phone is signed out.

const KEY = "mm-app-signed-out";

/** The storage, or null where the browser refuses it, as a private window may. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function rememberSignedOut(): void {
  try {
    storage()?.setItem(KEY, "1");
  } catch {
    // A phone that cannot remember it shows the error state offline, as before.
  }
}

export function forgetSignedOut(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing was remembered.
  }
}

export function signedOutHere(): boolean {
  try {
    const kept = storage();
    return kept !== null && kept.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
