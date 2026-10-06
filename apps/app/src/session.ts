// What every signed-in page needs from App: who is signed in, whether what it
// shows is the last update the phone kept (the offline state), a way to
// fetch Home again after a change, such as a booking, and a way to log out.

import { createContext, useContext } from "react";
import type { Me } from "./api.ts";

interface Session {
  readonly me: Me;
  readonly offline: boolean;
  readonly refresh: () => void;
  /** Ends the session with the API's word for it: false when the API did not answer, and the client is still in. */
  readonly logOut: () => Promise<boolean>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession is for pages inside the signed-in app");
  return session;
}
