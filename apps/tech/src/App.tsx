// The technician app: the sign-in until there is a session, then the day's jobs, the session bound to this phone
// (docs/decisions/0052-technician-sessions.md). A 401 from any call wipes the phone and shows the sign-in. The
// session's lifecycle is ./lib/useSessionLifecycle.ts, and when the phone sends what it holds ./lib/useReplayTriggers.ts.

import { CaptureScreen } from "./camera/CaptureScreen.tsx";
import { UpdateReady } from "@maneman/ui/UpdateReady";
import { classes } from "@maneman/ui/classes";
import { Stopped, StorageFull } from "./frame/Banners.tsx";
import { Interrupted } from "./frame/Interrupted.tsx";
import { SharePosition } from "./frame/SharePosition.tsx";
import { update } from "./content.ts";
import { JobScreen } from "./job/JobScreen.tsx";
import { OptionsScreen } from "./job/OptionsScreen.tsx";
import { ClientHistoryScreen } from "./job/ClientHistoryScreen.tsx";
import { DoorScreen } from "./job/DoorScreen.tsx";
import { PlanScreen } from "./visit/PlanScreen.tsx";
import { KitScreen } from "./kit/KitScreen.tsx";
import { LeaveScreen } from "./me/LeaveScreen.tsx";
import { MeScreen } from "./me/MeScreen.tsx";
import { GuideScreen, GuidesScreen, GuideTaskScreen } from "./guides/GuidesScreen.tsx";
import { AlertsScreen } from "./alerts/AlertsScreen.tsx";
import { useLanguage } from "./lang/language.ts";
import { alertsBack, guideBack } from "./lib/opened-from.ts";
import { PreviewScreen } from "./schedule/PreviewScreen.tsx";
import { ScheduleScreen } from "./schedule/ScheduleScreen.tsx";
import { OutboxContext, useOutboxSubscription } from "./lib/useOutbox.ts";
import { useReplayTriggers } from "./lib/useReplayTriggers.ts";
import { useSessionLifecycle } from "./lib/useSessionLifecycle.ts";
import { SignIn } from "./login/SignIn.tsx";
import { notePage } from "./lib/opened-from.ts";
import { routeOf, usePath, type Route } from "./route.ts";
import { SessionContext, useOnline, type Session } from "./session.ts";
import { ErrorBoundary } from "./frame/ErrorBoundary.tsx";
import { drawnLight, hasTabs, Tabs } from "./frame/Tabs.tsx";
import { Loading } from "./frame/States.tsx";
import { Checklist } from "./steps/Checklist.tsx";
import { CloseOut } from "./steps/CloseOut.tsx";
import { Consumables } from "./steps/Consumables.tsx";
import { Outcome } from "./steps/Outcome.tsx";
import { Piece } from "./steps/Piece.tsx";
import { Profile } from "./steps/Profile.tsx";
import { TodayScreen } from "./today/TodayScreen.tsx";
import { WaitingScreen } from "./waiting/WaitingScreen.tsx";
import styles from "./app.module.css";
import light from "./frame/light.module.css";

function pageFor(route: Route) {
  switch (route.page) {
    case "today":
      return <TodayScreen />;
    case "waiting":
      return <WaitingScreen />;
    case "kit":
      return <KitScreen />;
    case "week":
      return <ScheduleScreen date={route.date} />;
    case "preview":
      return <PreviewScreen date={route.date} id={route.id} />;
    case "guides":
      return <GuidesScreen />;
    case "guide":
      return <GuideScreen type={route.type} back={guideBack()} />;
    case "guideTask":
      return <GuideTaskScreen type={route.type} task={route.task} />;
    case "leave":
      return <LeaveScreen />;
    case "me":
      return <MeScreen />;
    case "alerts":
      return <AlertsScreen back={alertsBack()} />;
    case "job":
      return <JobScreen id={route.id} />;
    case "options":
      return <OptionsScreen id={route.id} />;
    case "history":
      return <ClientHistoryScreen id={route.id} />;
    case "door":
      return <DoorScreen id={route.id} />;
    case "plan":
      return <PlanScreen id={route.id} />;
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
  notePage(path);
  const tabbed = hasTabs(route.page);
  return (
    <SessionContext value={session}>
      <OutboxContext value={waiting}>
        <StorageFull />
        <UpdateReady copy={update} resting={route.page === "today"} onInk={!drawnLight(route.page)} />
        {/* A job's work stopped reaching us, said above every screen; the waiting screen says it job by job. */}
        {route.page !== "waiting" && <Stopped />}
        {/* A job cancelled or given away under the phone, said once over any screen but the one that says it job by
            job (ADR 0246). */}
        {route.page !== "waiting" && <Interrupted />}
        {/* Where the technician is, from a visit's check-in to its close (ADR 0248). */}
        <SharePosition />
        {/* Keyed by the path, so each screen opens at its top with its own data, and one that failed stays behind. */}
        {tabbed ? (
          <>
            <div className={drawnLight(route.page) ? classes(styles.tabbed, light.ground) : styles.tabbed}>
              <ErrorBoundary key={path}>{pageFor(route)}</ErrorBoundary>
            </div>
            <Tabs page={route.page} />
          </>
        ) : (
          <ErrorBoundary key={path}>{pageFor(route)}</ErrorBoundary>
        )}
      </OutboxContext>
    </SessionContext>
  );
}

export function App() {
  // Every screen draws again in a language chosen, keeping its place (./lang/words.ts).
  useLanguage();
  const { state, keeping, check, signOut } = useSessionLifecycle();
  const path = usePath();
  const online = useOnline();
  useReplayTriggers(online, check);

  switch (state.kind) {
    case "checking":
      return (
        <div className={styles.checking}>
          <Loading />
        </div>
      );
    case "out":
      // The sign-in's one main landmark, so its heading and the code's status are inside one.
      return (
        <main className={styles.out}>
          <SignIn why={state.why} onSignedIn={check} />
        </main>
      );
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
