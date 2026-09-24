// The technician app: the sign-in until there is a session, then the day's
// jobs. Whether there is a session is the API's to say — the cookie is
// HttpOnly, and the app keeps no token — but the phone keeps enough to open in
// a basement with no signal, and the API is asked again as soon as there is any.
//
// The session is bound to this device (docs/decisions/0052-technician-sessions.md).
// A 401 means it has ended, whether it ran out or ops revoked the device:
// either way everything the phone holds is wiped before the sign-in is shown
// again, and a `device_revoked` code only changes what it says.
//
// A store that has never held a session is a third case, and the one an iPhone
// makes: an app installed to the home screen has its own cookie jar, so the
// technician arrives signed out on a phone he signed in on an hour ago. The
// sign-in is told which of the three it is, so it can say so (ADR 0053).

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api, DEVICE_REVOKED, type Me } from "./api.ts";
import { CaptureScreen } from "./camera/CaptureScreen.tsx";
import { JobScreen } from "./job/JobScreen.tsx";
import { SignIn } from "./login/SignIn.tsx";
import { go, routeOf, usePath, type Route } from "./route.ts";
import { SessionContext, useOnline, type Out } from "./session.ts";
import { Checklist } from "./steps/Checklist.tsx";
import { CloseOut } from "./steps/CloseOut.tsx";
import { Consumables } from "./steps/Consumables.tsx";
import { Outcome } from "./steps/Outcome.tsx";
import { Piece } from "./steps/Piece.tsx";
import { enrolled, enrolledAt, keepMe, keptMe } from "./store/device.ts";
import { wipe } from "./store/db.ts";
import { replay } from "./store/outbox.ts";
import { askToKeep, type Keeping } from "./store/persist.ts";
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
        case "outcome":
          return <Outcome id={route.id} />;
      }
  }
}

export function App() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [keeping, setKeeping] = useState<Keeping>("asking");
  const path = usePath();
  const online = useOnline();

  const check = useCallback(async () => {
    const answer = await api.me();
    if (answer.ok) {
      await keepMe(answer.body);
      await enrolled();
      void askToKeep().then(setKeeping);
      setState({ kind: "in", me: answer.body, offline: false });
      void replay();
      return;
    }
    // The session has ended, or the device was revoked: nothing of ours stays on this phone.
    if (answer.status === 401) {
      // Read before the wipe, since the wipe takes the answer with it.
      const had = (await enrolledAt()) !== null;
      await wipe();
      setState({ kind: "out", why: answer.code === DEVICE_REVOKED ? "revoked" : had ? "ended" : "fresh" });
      return;
    }
    // No signal, or the API is having a bad minute: the phone works from what it holds.
    const kept = await keptMe();
    if (kept === null) {
      setState({ kind: "out", why: "fresh" });
      return;
    }
    void askToKeep().then(setKeeping);
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

  const signOut = useCallback(async () => {
    await api.logout();
    await wipe();
    setKeeping("asking");
    go("/");
    setState({ kind: "out", why: "ended" });
  }, []);

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
            signOut: () => void signOut(),
          }}
        >
          {/* Keyed by the path, so each screen opens at its top with its own data. */}
          <Fragment key={path}>{pageFor(routeOf(path))}</Fragment>
        </SessionContext>
      );
  }
}
