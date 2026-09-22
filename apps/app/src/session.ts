// What every signed-in page needs from App: who is signed in, and whether
// what it shows is the last update the phone kept (board B3's offline state).

import { createContext, useContext } from "react";
import type { Me } from "./api.ts";

export interface Session {
  readonly me: Me;
  readonly offline: boolean;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession is for pages inside the signed-in app");
  return session;
}
