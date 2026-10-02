// What every signed-in screen needs from App: who is signed in, whether the
// phone has signal, and a way to end the session, which wipes everything the
// phone holds (docs/decisions/0029-sessions.md).

import { createContext, useContext, useEffect, useState } from "react";
import { onReach, type Me } from "./api.ts";

/**
 * Why the sign-in is showing: this store never held a session, its session ended, ops revoked the phone, or ops
 * switched the technician off, with or without work of his kept on the phone.
 */
export type Out = "fresh" | "ended" | "revoked" | "switched-off" | "work-kept";

/**
 * How a sign-out went. Only the API can end the session, so with no signal it
 * stays open, and the phone keeps everything it holds rather than wipe itself
 * and come back signed in the moment the signal does.
 */
export type SignOut = "signed-out" | "still-signed-in";

export interface Session {
  readonly me: Me;
  readonly offline: boolean;
  /** The phone would not promise to keep the outbox, so unsent work can be evicted (./store/persist.ts). */
  readonly atRisk: boolean;
  readonly signOut: () => Promise<SignOut>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession is for screens inside the signed-in app");
  return session;
}

/**
 * Whether the phone can reach us. The phone's own word is a hint: it knows
 * whether there is a network, not whether anything answers on it. So every
 * call to the API corrects it, either way (./api.ts).
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => {
      setOnline(true);
    };
    const down = () => {
      setOnline(false);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const stopHearing = onReach(setOnline);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      stopHearing();
    };
  }, []);
  return online;
}
