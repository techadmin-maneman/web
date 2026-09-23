// The technician app: the sign-in until there is a session, then the day's
// jobs. Whether there is a session is the API's to say — the cookie is
// HttpOnly, and the app keeps no token — but the phone keeps enough to open in
// a basement with no signal, and the API is asked again as soon as there is any.
//
// The session is bound to this device (docs/decisions/0029-sessions.md). A 401
// means it has ended, whether it ran out or ops revoked the device: either way
// everything the phone holds is wiped before the sign-in is shown again.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api, DEVICE_REVOKED, type Me } from "./api.ts";
import { CaptureScreen } from "./camera/CaptureScreen.tsx";
import { JobScreen } from "./job/JobScreen.tsx";
import { SignIn } from "./login/SignIn.tsx";
import { go, routeOf, usePath, type Route } from "./route.ts";
import { SessionContext, useOnline } from "./session.ts";
import { enrolled, keepMe, keptMe } from "./store/device.ts";
import { wipe } from "./store/db.ts";
import { replay } from "./store/outbox.ts";
import { TodayScreen } from "./today/TodayScreen.tsx";
import { WaitingScreen } from "./waiting/WaitingScreen.tsx";
import styles from "./app.module.css";

type State =
  | { readonly kind: "checking" }
  | { readonly kind: "out"; readonly revoked: boolean }
  | { readonly kind: "in"; readonly me: Me; readonly offline: boolean };

function pageFor(route: Route) {
  switch (route.page) {
    case "today":
      return <TodayScreen />;
    case "waiting":
      return <WaitingScreen />;
    case "job":
      return <JobScreen id={route.id} />;
    case "capture":
      return <CaptureScreen id={route.id} />;
  }
}

export function App() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const path = usePath();
  const online = useOnline();

  const check = useCallback(async () => {
    const answer = await api.me();
    if (answer.ok) {
      await keepMe(answer.body);
      await enrolled();
      setState({ kind: "in", me: answer.body, offline: false });
      void replay();
      return;
    }
    // The session has ended, or the device was revoked: nothing of ours stays on this phone.
    if (answer.status === 401) {
      await wipe();
      setState({ kind: "out", revoked: answer.code === DEVICE_REVOKED });
      return;
    }
    // No signal, or the API is having a bad minute: the phone works from what it holds.
    const kept = await keptMe();
    setState(kept === null ? { kind: "out", revoked: false } : { kind: "in", me: kept, offline: true });
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

  const signOut = useCallback(async () => {
    await api.logout();
    await wipe();
    go("/");
    setState({ kind: "out", revoked: false });
  }, []);

  switch (state.kind) {
    case "checking":
      return <div className={styles.checking} aria-busy="true" />;
    case "out":
      return <SignIn revoked={state.revoked} onSignedIn={() => void check()} />;
    case "in":
      return (
        <SessionContext value={{ me: state.me, offline: state.offline || !online, signOut: () => void signOut() }}>
          {/* Keyed by the path, so each screen opens at its top with its own data. */}
          <Fragment key={path}>{pageFor(routeOf(path))}</Fragment>
        </SessionContext>
      );
  }
}
