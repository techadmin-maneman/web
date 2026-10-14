// The client app: the login until there is a session, then Home and its tabs.
// Whether there is a session is the API's to say: the cookie is HttpOnly, and
// the app keeps no token of its own. A 401 from any call means the session has
// ended, wherever the client is: the kept Home is forgotten and the login
// shown on the same page, saying why. Offline, Home is the last one the
// service worker kept, until the connection is back.
//
// While the API is asked, the page shows the loading state. Offline with no
// Home kept, a phone that signed out opens on the login; any other client
// sees the error state, since their visit may still be booked.

import { Suspense, useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { api, forgetHome, keptHome, onSessionEnded, type Me } from "./api.ts";
import { titles, update } from "./content.ts";
import { HomeScreen } from "./home/HomeScreen.tsx";
import { focusIfLost } from "@maneman/ui/arrival";
import { UpdateReady } from "@maneman/ui/UpdateReady";
import { lazyScreen } from "@maneman/ui/lazyScreen";
import { titled } from "./lib/arrival.ts";
import { useScreenTitle } from "@maneman/ui/useScreenTitle";
import { forgetSignedOut, rememberSignedOut, signedOutHere } from "./lib/signed-out.ts";
import { ReplacementScreen } from "./home/ReplacementScreen.tsx";
import { TrackerScreen } from "./refer/TrackerScreen.tsx";
import { EntryScreen } from "./payments/EntryScreen.tsx";
import { PaymentsScreen } from "./payments/PaymentsScreen.tsx";
import { PhotosScreen } from "./photos/PhotosScreen.tsx";
import { VisitScreen } from "./visits/VisitScreen.tsx";
import { VisitsScreen } from "./visits/VisitsScreen.tsx";
import { Login } from "./login/Login.tsx";
import { go, routeOf, usePath, type Route } from "./route.ts";
import { SessionContext } from "./session.ts";
import { ErrorBoundary } from "./states/ErrorBoundary.tsx";
import { LoadFailed } from "./states/LoadFailed.tsx";
import { Loading } from "./states/Loading.tsx";
import styles from "./app.module.css";

// The pages opened least, and the heaviest, load when first opened; the service worker keeps them, so they open
// offline too. Every other page comes with Home: split, they would cost more to fetch than they save.
const ReferScreen = lazyScreen(() => import("./refer/ReferScreen.tsx").then((module) => module.ReferScreen));
const CompareScreen = lazyScreen(() => import("./photos/CompareScreen.tsx").then((module) => module.CompareScreen));
const ProfileScreen = lazyScreen(() => import("./profile/ProfileScreen.tsx").then((module) => module.ProfileScreen));

type Session =
  | { readonly kind: "checking" }
  /** `ended`: the session ended while the app was open, rather than never having begun here. */
  | { readonly kind: "out"; readonly ended: boolean }
  | { readonly kind: "failed"; readonly booked: boolean }
  | { readonly kind: "in"; readonly me: Me; readonly offline: boolean };

function pageFor(route: Route, onChanged: () => void) {
  switch (route.page) {
    case "home":
      return <HomeScreen />;
    case "visits":
      return <VisitsScreen />;
    case "visit":
      return <VisitScreen id={route.id} />;
    case "photos":
      return <PhotosScreen />;
    case "compare":
      return <CompareScreen />;
    case "payments":
      return <PaymentsScreen />;
    case "entry":
      return <EntryScreen id={route.id} />;
    case "refer":
      return <ReferScreen />;
    case "fitted":
      return <TrackerScreen />;
    case "profile":
      return <ProfileScreen onChanged={onChanged} />;
    case "replacement":
      return <ReplacementScreen />;
  }
}

/** Whether a Home the phone kept shows a visit, so the error state can say it is still booked. */
async function stillBooked(): Promise<boolean> {
  const kept = await keptHome().catch(() => null);
  return kept !== null && (kept.next_visit !== null || kept.consultation !== null);
}

/** Waits `ms` milliseconds. */
const pause = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** `linkedMobile`: the number the site's booking confirmation opened the app with, for the login; or "". */
/** Offline, the session says so; back online, Home is asked for again. */
function useConnection(setSession: Dispatch<SetStateAction<Session>>, refreshSoon: () => Promise<void>) {
  useEffect(() => {
    const lost = () => {
      setSession((now) => (now.kind === "in" ? { ...now, offline: true } : now));
    };
    const back = () => void refreshSoon();
    window.addEventListener("offline", lost);
    window.addEventListener("online", back);
    return () => {
      window.removeEventListener("offline", lost);
      window.removeEventListener("online", back);
    };
  }, [setSession, refreshSoon]);
}

export function App({ linkedMobile }: { linkedMobile: string }) {
  const [session, setSession] = useState<Session>({ kind: "checking" });
  const path = usePath();

  /**
   * Home fetched again without the blank wait: after the profile changes it, or when the connection is
   * back. True if the answer came fresh from the API.
   */
  const refresh = useCallback(async () => {
    const answer = await api.me();
    if (answer.ok) {
      setSession((now) => (now.kind === "in" ? { kind: "in", me: answer.body, offline: answer.cached } : now));
    }
    return answer.ok && !answer.cached;
  }, []);

  /** A connection is often not usable the moment it returns, so Home is tried a few times. */
  const refreshSoon = useCallback(async () => {
    for (const wait of [0, 1_000, 3_000, 10_000]) {
      await pause(wait);
      if (await refresh()) return;
    }
  }, [refresh]);

  const check = useCallback(async () => {
    setSession({ kind: "checking" });
    const answer = await api.me();
    if (answer.ok) {
      if (!answer.cached) forgetSignedOut();
      setSession({ kind: "in", me: answer.body, offline: answer.cached });
      // The kept Home on a phone that says it is online: a signal too weak to answer in time, so try again.
      if (answer.cached && navigator.onLine) void refreshSoon();
    } else if (answer.status === 401) {
      await forgetHome();
      rememberSignedOut();
      setSession({ kind: "out", ended: false });
    } else if (answer.code === "offline" && signedOutHere()) {
      setSession({ kind: "out", ended: false });
    } else setSession({ kind: "failed", booked: await stillBooked() });
  }, [refreshSoon]);

  useEffect(() => {
    void check();
  }, [check]);

  // Signed in, a 401 from any call ends the session: the screens go first, then the kept Home.
  const signedIn = session.kind === "in";
  useEffect(() => {
    if (!signedIn) return;
    return onSessionEnded(() => {
      setSession({ kind: "out", ended: true });
      rememberSignedOut();
      void forgetHome();
    });
  }, [signedIn]);

  useConnection(setSession, refreshSoon);

  // The page's ground follows the screen: ink for the login, paper for everything the states screen draws and once in.
  useEffect(() => {
    document.body.dataset.ground = session.kind === "out" ? "ink" : "paper";
  }, [session.kind]);

  // Each page is named in the browser's title, and its heading takes the focus the tap that opened it left behind. The
  // login names its own steps.
  useScreenTitle(signedIn ? titled(titles[routeOf(path).page]) : null);
  useEffect(() => {
    if (signedIn) focusIfLost(document.querySelector("h1"));
  }, [path, signedIn]);

  /** Only the API can end the session: with no answer from it, the client is still logged in, and is told so. */
  const logOut = useCallback(async () => {
    const answer = await api.logout();
    if (!answer.ok && answer.status !== 401) return false;
    await forgetHome();
    rememberSignedOut();
    go("/");
    setSession({ kind: "out", ended: false });
    return true;
  }, []);

  switch (session.kind) {
    case "checking":
      return (
        <main className={styles.checking}>
          <Loading />
        </main>
      );
    case "failed":
      return <LoadFailed booked={session.booked} onRetry={() => void check()} />;
    case "out":
      return <Login ended={session.ended} linkedMobile={linkedMobile} onSignedIn={() => void check()} />;
    case "in":
      return (
        <SessionContext value={{ me: session.me, offline: session.offline, refresh: () => void refresh(), logOut }}>
          <UpdateReady copy={update} resting={routeOf(path).page === "home"} />
          {/* Keyed by the path, so each page opens at its top with its own data, and one that failed stays behind. */}
          <ErrorBoundary key={path}>
            <Suspense fallback={<Loading />}>{pageFor(routeOf(path), () => void refresh())}</Suspense>
          </ErrorBoundary>
        </SessionContext>
      );
  }
}
