// What every signed-in screen needs from App: who is signed in, whether the
// phone has signal, and a way to end the session, which wipes everything the
// phone holds (docs/decisions/0029-sessions.md).

import { createContext, useContext, useEffect, useState } from "react";
import type { Me } from "./api.ts";

/** Why the sign-in is showing: this store never held a session, its session ended, or ops revoked the phone. */
export type Out = "fresh" | "ended" | "revoked";

export interface Session {
  readonly me: Me;
  readonly offline: boolean;
  /** The phone would not promise to keep the outbox, so unsent work can be evicted (./store/persist.ts). */
  readonly atRisk: boolean;
  readonly signOut: () => void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession is for screens inside the signed-in app");
  return session;
}

/** Whether the phone says it has a connection. A call that fails tells the truth sooner; this is the hint. */
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
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
