// This phone's subscription, given to the API again once a session where notifications are allowed, so pushes keep
// reaching it after the client signs in again or the browser renews its address
// (docs/decisions/0255-client-alerts-and-push.md). The key to subscribe with comes with the inbox, read once a session.

import { useEffect } from "react";
import { api } from "../api.ts";
import { keepSubscription, notificationsHere } from "./push.ts";

let keptThisSession = false;
let keyThisSession: Promise<string | null> | null = null;

/** The API's key for this phone's pushes, read once a session; null where it has none, or it could not be read. */
export function pushKeyNow(): Promise<string | null> {
  keyThisSession ??= api.alerts().then(
    (read) => {
      if (read.ok) return read.body.push_key;
      keyThisSession = null;
      return null;
    },
    () => {
      keyThisSession = null;
      return null;
    },
  );
  return keyThisSession;
}

async function keep(): Promise<void> {
  const key = await pushKeyNow();
  if (key === null || !(await keepSubscription(key))) keptThisSession = false;
}

export function useKeptPush(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) {
      keptThisSession = false;
      keyThisSession = null;
      return;
    }
    if (keptThisSession || notificationsHere() !== "on") return;
    keptThisSession = true;
    void keep().catch(() => {
      keptThisSession = false;
    });
  }, [signedIn]);
}
