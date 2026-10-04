// Whether the technician is signed in, and what ends it (../App.tsx says why each case is as it is).
//
// Only the API can say there is a session. With no answer from it the phone works from what it holds; a 401 from any
// call ends the session, whatever screen is showing.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, DEVICE_REVOKED, onSessionEnded, TECHNICIAN_INACTIVE, type Me } from "../api.ts";
import { go } from "../route.ts";
import type { Out, SignOut } from "../session.ts";
import { enrolled, enrolledAt, keepMe, keptMe } from "../store/device.ts";
import { replay } from "../store/outbox.ts";
import { askToKeep, type Keeping } from "../store/persist.ts";
import { leaveSignedOut, settleSetAside } from "../store/set-aside.ts";

export type SessionState =
  | { readonly kind: "checking" }
  | { readonly kind: "out"; readonly why: Out }
  | { readonly kind: "in"; readonly me: Me; readonly offline: boolean };

export interface Lifecycle {
  readonly state: SessionState;
  /** Whether the phone promised to keep what it holds (../store/persist.ts). */
  readonly keeping: Keeping;
  /** Asks the API whether there is a session, and replays the outbox when there is. */
  readonly check: () => Promise<void>;
  readonly signOut: () => Promise<SignOut>;
}

/** Why the sign-in is showing once a session ends: what ops did, work kept, a session it had, or none. */
function whyOut(code: string | null, hadSession: boolean, workKept: boolean): Out {
  if (code === DEVICE_REVOKED) return "revoked";
  if (workKept) return "work-kept";
  if (code === TECHNICIAN_INACTIVE) return "switched-off";
  return hadSession ? "ended" : "fresh";
}

export function useSessionLifecycle(): Lifecycle {
  const [state, setState] = useState<SessionState>({ kind: "checking" });
  const [keeping, setKeeping] = useState<Keeping>("asking");

  /*
   * The session has ended: nothing of ours stays on this phone, but for a
   * switched-off technician's unsent work. The screens go first, so nothing of a
   * client's shows while the wipe runs. Several calls can meet the same 401 at
   * once, and they share the one ending.
   */
  const ending = useRef<Promise<void> | null>(null);
  const end = useCallback((code: string | null): Promise<void> => {
    ending.current ??= (async () => {
      setState({ kind: "checking" });
      // Read before the wipe, since the wipe takes the answer with it.
      const had = (await enrolledAt().catch(() => null)) !== null;
      const workKept = await leaveSignedOut(code);
      setKeeping("asking");
      go("/");
      setState({ kind: "out", why: whyOut(code, had, workKept) });
    })().finally(() => {
      ending.current = null;
    });
    return ending.current;
  }, []);

  const signedOut = state.kind === "out";
  useEffect(() => {
    if (signedOut) return;
    return onSessionEnded((code) => void end(code));
  }, [signedOut, end]);

  const check = useCallback(async () => {
    const answer = await api.me();
    if (answer.ok) {
      // Work kept while he was switched off goes on only if it is his.
      await settleSetAside(answer.body.id).catch(() => undefined);
      // Kept so the next basement opens signed in; a phone with no room to keep it opens all the same.
      await keepMe(answer.body).catch(() => undefined);
      await enrolled().catch(() => undefined);
      void askToKeep().then(setKeeping, () => undefined);
      setState({ kind: "in", me: answer.body, offline: false });
      void replay();
      return;
    }
    // The 401 has already ended the session (`end` above).
    if (answer.status === 401) return;
    // No signal, or the API is having a bad minute: the phone works from what it holds.
    const kept = await keptMe().catch(() => null);
    if (kept === null) {
      setState({ kind: "out", why: "fresh" });
      return;
    }
    void askToKeep().then(setKeeping, () => undefined);
    setState({ kind: "in", me: kept, offline: true });
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  /**
   * Only the API can end the session. With no answer from it the session is
   * still open, and wiping the phone would only lose what it has not sent.
   * A 401 means it had already ended, and `end` has begun.
   */
  const signOut = useCallback(async (): Promise<SignOut> => {
    const answer = await api.logout();
    if (!answer.ok && answer.status !== 401) return "still-signed-in";
    await end(null);
    return "signed-out";
  }, [end]);

  return { state, keeping, check, signOut };
}
