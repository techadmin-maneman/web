// The technician app: the sign-in until there is a session, then the day's
// jobs. Whether there is a session is the API's to say — the cookie is
// HttpOnly, and the app keeps no token — but the phone keeps enough to open in
// a basement with no signal, and the API is asked again as soon as there is any.
//
// The session is bound to this device (docs/decisions/0052-technician-sessions.md).
// A 401 from any call means it has ended, whether it ran out or ops revoked the
// device: whatever screen is showing, everything the phone holds is wiped
// before the sign-in is shown again, and a `device_revoked` code only changes
// what it says. A technician ops switched off keeps the work they have not sent
// (./store/set-aside.ts), which goes on once they sign in again.
//
// A store that has never held a session is a third case, and the one an iPhone
// makes: an app installed to the home screen has its own cookie jar, so the
// technician arrives signed out on a phone they signed in on an hour ago. The
// sign-in is told which of the three it is, so it can say so (ADR 0053).
//
// The session's lifecycle is ./lib/useSessionLifecycle.ts, and the moments the
// phone sends what it holds ./lib/useReplayTriggers.ts.

import { CaptureScreen } from "./camera/CaptureScreen.tsx";
import { Stopped, StorageFull } from "./components/Banners.tsx";
import { JobScreen } from "./job/JobScreen.tsx";
import { OutboxContext, useOutboxSubscription } from "./lib/useOutbox.ts";
import { useReplayTriggers } from "./lib/useReplayTriggers.ts";
import { useSessionLifecycle } from "./lib/useSessionLifecycle.ts";
import { SignIn } from "./login/SignIn.tsx";
import { routeOf, usePath, type Route } from "./route.ts";
import { SessionContext, useOnline, type Session } from "./session.ts";
import { ErrorBoundary } from "./states/ErrorBoundary.tsx";
import { Checklist } from "./steps/Checklist.tsx";
import { CloseOut } from "./steps/CloseOut.tsx";
import { Consumables } from "./steps/Consumables.tsx";
import { Outcome } from "./steps/Outcome.tsx";
import { Piece } from "./steps/Piece.tsx";
import { Profile } from "./steps/Profile.tsx";
import { TodayScreen } from "./today/TodayScreen.tsx";
import { WaitingScreen } from "./waiting/WaitingScreen.tsx";
import styles from "./app.module.css";

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

/** The screens once there is a session, each reading the one account of the outbox kept here. */
function SignedIn({ session, path }: { session: Session; path: string }) {
  const waiting = useOutboxSubscription();
  const route = routeOf(path);
  return (
    <SessionContext value={session}>
      <OutboxContext value={waiting}>
        <StorageFull />
        {/* A job's work stopped reaching us, said above every screen; the waiting screen says it job by job. */}
        {route.page !== "waiting" && <Stopped />}
        {/* Keyed by the path, so each screen opens at its top with its own data, and one that failed stays behind. */}
        <ErrorBoundary key={path}>{pageFor(route)}</ErrorBoundary>
      </OutboxContext>
    </SessionContext>
  );
}

export function App() {
  const { state, keeping, check, signOut } = useSessionLifecycle();
  const path = usePath();
  const online = useOnline();
  useReplayTriggers(online, check);

  switch (state.kind) {
    case "checking":
      return <div className={styles.checking} aria-busy="true" />;
    case "out":
      return <SignIn why={state.why} onSignedIn={() => void check()} />;
    case "in": {
      const session: Session = {
        me: state.me,
        offline: state.offline || !online,
        // The phone answered, and the answer was not a promise to keep the outbox.
        atRisk: keeping === "refused" || keeping === "unknown",
        signOut,
      };
      return <SignedIn session={session} path={path} />;
    }
  }
}
