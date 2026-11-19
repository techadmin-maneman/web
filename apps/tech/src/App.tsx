// The technician app: the sign-in until there is a session, then the day's jobs, the session bound to this phone
// (docs/decisions/0052-technician-sessions.md). A 401 from any call wipes the phone and shows the sign-in. The
// session's lifecycle is ./lib/useSessionLifecycle.ts, and when the phone sends what it holds ./lib/useReplayTriggers.ts.

import { lazyScreen } from "@maneman/ui/lazyScreen";
import { Suspense, useEffect } from "react";
import { UpdateReady } from "@maneman/ui/UpdateReady";
import { classes } from "@maneman/ui/classes";
import { NoSignal, Stopped, StorageFull } from "./frame/Banners.tsx";
import { Interrupted } from "./frame/Interrupted.tsx";
import { SharePosition } from "./frame/SharePosition.tsx";
import { update } from "./content.ts";
import { useLanguage } from "./lang/index.ts";
import { alertsBack, guideBack } from "./lib/opened-from.ts";
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
import { TodayScreen } from "./today/TodayScreen.tsx";
import { WaitingScreen } from "./waiting/WaitingScreen.tsx";
import styles from "./app.module.css";
import light from "./frame/light.module.css";

/**
 * Every screen behind Today, loaded the first time it opens (docs/decisions/0284-the-first-screen-and-the-precache.md):
 * the first screen draws without the steps, the camera or the guides, and the service worker keeps every part.
 */
const jobScreens = () => import("./job-screens.ts");
const tabScreens = () => import("./tab-screens.ts");

/**
 * Both parts fetched as soon as the first screen has drawn, so every screen opens with no signal from then on, before the
 * service worker keeps them on a phone's first visit. One that cannot be fetched now is fetched when its screen opens.
 */
function useEveryScreen(): void {
  useEffect(() => {
    for (const part of [jobScreens, tabScreens]) {
      part().catch(() => undefined);
    }
  }, []);
}
const CaptureScreen = lazyScreen(() => jobScreens().then((module) => module.CaptureScreen));
const JobScreen = lazyScreen(() => jobScreens().then((module) => module.JobScreen));
const OptionsScreen = lazyScreen(() => jobScreens().then((module) => module.OptionsScreen));
const ClientHistoryScreen = lazyScreen(() => jobScreens().then((module) => module.ClientHistoryScreen));
const DoorScreen = lazyScreen(() => jobScreens().then((module) => module.DoorScreen));
const PlanScreen = lazyScreen(() => jobScreens().then((module) => module.PlanScreen));
const KitScreen = lazyScreen(() => tabScreens().then((module) => module.KitScreen));
const LeaveScreen = lazyScreen(() => tabScreens().then((module) => module.LeaveScreen));
const MeScreen = lazyScreen(() => tabScreens().then((module) => module.MeScreen));
const AlertsScreen = lazyScreen(() => tabScreens().then((module) => module.AlertsScreen));
const PreviewScreen = lazyScreen(() => tabScreens().then((module) => module.PreviewScreen));
const ScheduleScreen = lazyScreen(() => tabScreens().then((module) => module.ScheduleScreen));
const Checklist = lazyScreen(() => jobScreens().then((module) => module.Checklist));
const CloseOut = lazyScreen(() => jobScreens().then((module) => module.CloseOut));
const Consumables = lazyScreen(() => jobScreens().then((module) => module.Consumables));
const Outcome = lazyScreen(() => jobScreens().then((module) => module.Outcome));
const Piece = lazyScreen(() => jobScreens().then((module) => module.Piece));
const SignOff = lazyScreen(() => jobScreens().then((module) => module.SignOff));
const Profile = lazyScreen(() => jobScreens().then((module) => module.Profile));
const GuidesScreen = lazyScreen(() => tabScreens().then((module) => module.GuidesScreen));
const GuideScreen = lazyScreen(() => tabScreens().then((module) => module.GuideScreen));
const GuideTaskScreen = lazyScreen(() => tabScreens().then((module) => module.GuideTaskScreen));

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
        case "sign_off":
          return <SignOff id={route.id} />;
        case "outcome":
          return <Outcome id={route.id} />;
      }
  }
}

/** The screens once there is a session, each reading the one account of the outbox kept here. */
function SignedIn({ session, path }: { session: Session; path: string }) {
  useEveryScreen();
  const waiting = useOutboxSubscription();
  const route = routeOf(path);
  notePage(path);
  const tabbed = hasTabs(route.page);
  return (
    <SessionContext value={session}>
      <OutboxContext value={waiting}>
        {/* No signal, said once at the very top of every screen, as the prototype draws it. */}
        {session.offline && <NoSignal />}
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
              <ErrorBoundary key={path}>
                <Suspense fallback={<Loading />}>{pageFor(route)}</Suspense>
              </ErrorBoundary>
            </div>
            <Tabs page={route.page} />
          </>
        ) : (
          <ErrorBoundary key={path}>
            <Suspense fallback={<Loading />}>{pageFor(route)}</Suspense>
          </ErrorBoundary>
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
