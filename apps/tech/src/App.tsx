// The technician app: the sign-in until there is a session, then the day's
// jobs. Whether there is a session is the API's to say — the cookie is
// HttpOnly, and the app keeps no token — but the phone keeps enough to open in
// a basement with no signal, and the API is asked again as soon as there is any.
//
// The session is bound to this device (docs/decisions/0052-technician-sessions.md).
// A 401 from any call means it has ended, whether it ran out or ops revoked the
// device: whatever screen is showing, everything the phone holds is wiped
// before the sign-in is shown again, and a `device_revoked` code only changes
// what it says. A technician ops switched off keeps the work he has not sent
// (./store/set-aside.ts), which goes on once he signs in again.
//
// A store that has never held a session is a third case, and the one an iPhone
// makes: an app installed to the home screen has its own cookie jar, so the
// technician arrives signed out on a phone he signed in on an hour ago. The
// sign-in is told which of the three it is, so it can say so (ADR 0053).

import { useCallback, useEffect, useRef, useState } from "react";
import { api, DEVICE_REVOKED, onSessionEnded, TECHNICIAN_INACTIVE, type Me } from "./api.ts";
import { CaptureScreen } from "./camera/CaptureScreen.tsx";
import { Stopped } from "./components/Banners.tsx";
import { storage } from "./content.ts";
import { JobScreen } from "./job/JobScreen.tsx";
import { SignIn } from "./login/SignIn.tsx";
import { go, routeOf, usePath, type Route } from "./route.ts";
import { SessionContext, useOnline, type Out, type SignOut } from "./session.ts";
import { ErrorBoundary } from "./states/ErrorBoundary.tsx";
import { Checklist } from "./steps/Checklist.tsx";
import { CloseOut } from "./steps/CloseOut.tsx";
import { Consumables } from "./steps/Consumables.tsx";
import { Outcome } from "./steps/Outcome.tsx";
import { Piece } from "./steps/Piece.tsx";
import { Profile } from "./steps/Profile.tsx";
import { enrolled, enrolledAt, keepMe, keptMe } from "./store/device.ts";
import { onStorageFull } from "./store/db.ts";
import { replay } from "./store/outbox.ts";
import { askToKeep, type Keeping } from "./store/persist.ts";
import { leaveSignedOut, settleSetAside } from "./store/set-aside.ts";
import { TodayScreen } from "./today/TodayScreen.tsx";
import { WaitingScreen } from "./waiting/WaitingScreen.tsx";
import styles from "./app.module.css";

type State =
  | { readonly kind: "checking" }
  | { readonly kind: "out"; readonly why: Out }
  | { readonly kind: "in"; readonly me: Me; readonly offline: boolean };

function pageFor(route: Route) {
  switch (route.page) {
    case "today":
      return <TodayScreen />;
    case "waiting":
      return <WaitingScreen />;
    case "job":
      return <JobScreen id={route.id} />;
    case "done":
      return <CloseOut id={route.id} />;
    case "step":
      switch (route.step) {
        case "before_photos":
          return <CaptureScreen id={route.id} phase="before" />;
        case "after_photos":
          return <CaptureScreen id={route.id} phase="after" />;
        case "checklist":
          return <Checklist id={route.id} />;
        case "consumables":
          return <Consumables id={route.id} />;
        case "piece":
          return <Piece id={route.id} />;
        case "profile":
          return <Profile id={route.id} />;
        case "outcome":
          return <Outcome id={route.id} />;
      }
  }
}

/** Why the sign-in is showing once a session ends: what ops did, work kept, a session it had, or none. */
function whyOut(code: string | null, hadSession: boolean, workKept: boolean): Out {
  if (code === DEVICE_REVOKED) return "revoked";
  if (workKept) return "work-kept";
  if (code === TECHNICIAN_INACTIVE) return "switched-off";
  return hadSession ? "ended" : "fresh";
}

/** Whether the phone has just refused a write for want of room (./store/db.ts). */
function useStorageFull(): boolean {
  const [full, setFull] = useState(false);
  useEffect(() => onStorageFull(setFull), []);
  return full;
}

export function App() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [keeping, setKeeping] = useState<Keeping>("asking");
  const path = usePath();
  const online = useOnline();
  const full = useStorageFull();

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

  // Back on signal: ask the API again, which also replays everything the outbox
  // is holding. Only the return matters, so the check does not run in a circle
  // when the API is reachable and unhappy.
  const lostSignal = useRef(false);
  useEffect(() => {
    if (!online) {
      lostSignal.current = true;
      return;
    }
    if (!lostSignal.current) return;
    lostSignal.current = false;
    void check();
  }, [online, check]);

  /*
   * Every time the app comes to the front, the outbox is sent. iOS does not
   * fire `online` reliably, and a phone that found signal in a pocket has no
   * other moment to notice: the less time a job spends only on the phone, the
   * less of it an eviction can take (apps/tech/src/store/persist.ts).
   */
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === "visible") void replay();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

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

  switch (state.kind) {
    case "checking":
      return <div className={styles.checking} aria-busy="true" />;
    case "out":
      return <SignIn why={state.why} onSignedIn={() => void check()} />;
    case "in":
      return (
        <SessionContext
          value={{
            me: state.me,
            offline: state.offline || !online,
            // The phone answered, and the answer was not a promise to keep the outbox.
            atRisk: keeping === "refused" || keeping === "unknown",
            signOut,
          }}
        >
          {full && (
            <div className={styles.full} role="alert">
              <p className={styles.fullTitle}>{storage.title}</p>
              <p className={styles.fullBody}>{storage.body}</p>
            </div>
          )}
          {/* A job's work stopped reaching us, said above every screen; the waiting screen says it job by job. */}
          {routeOf(path).page !== "waiting" && <Stopped />}
          {/* Keyed by the path, so each screen opens at its top with its own data, and one that failed stays behind. */}
          <ErrorBoundary key={path}>{pageFor(routeOf(path))}</ErrorBoundary>
        </SessionContext>
      );
  }
}
