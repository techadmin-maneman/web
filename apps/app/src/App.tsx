// The client app: the login until there is a session, then Home and its tabs.
// Whether there is a session is the API's to say: the cookie is HttpOnly, and
// the app keeps no token of its own. A 401 from any call means the session has
// ended, wherever the client is: the kept Home is forgotten and the login
// shown on the same page, saying why. Offline, Home is the last one the
// service worker kept (board B3), until the connection is back.
//
// While the API is asked, the page shows board B3's loading. Offline with no
// Home kept, a phone that signed out opens on the login; any other client
// sees board B3's error, since their visit may still be booked.

import { useCallback, useEffect, useState } from "react";
import { api, forgetHome, keptHome, onSessionEnded, type Me } from "./api.ts";
import { titles } from "./content.ts";
import { HomeScreen } from "./home/HomeScreen.tsx";
import { ReplacementScreen } from "./home/ReplacementScreen.tsx";
import { focusIfLost } from "@maneman/ui/arrival";
import { nameInTitle } from "./lib/arrival.ts";
import { forgetSignedOut, rememberSignedOut, signedOutHere } from "./lib/signed-out.ts";
import { ReferScreen } from "./refer/ReferScreen.tsx";
import { TrackerScreen } from "./refer/TrackerScreen.tsx";
import { Login } from "./login/Login.tsx";
import { EntryScreen } from "./payments/EntryScreen.tsx";
import { PaymentsScreen } from "./payments/PaymentsScreen.tsx";
import { CompareScreen } from "./photos/CompareScreen.tsx";
import { PhotosScreen } from "./photos/PhotosScreen.tsx";
import { ProfileScreen } from "./profile/ProfileScreen.tsx";
import { go, routeOf, usePath, type Route } from "./route.ts";
import { SessionContext } from "./session.ts";
import { ErrorBoundary } from "./states/ErrorBoundary.tsx";
import { LoadFailed } from "./states/LoadFailed.tsx";
import { Loading } from "./states/Loading.tsx";
import { VisitScreen } from "./visits/VisitScreen.tsx";
import { VisitsScreen } from "./visits/VisitsScreen.tsx";
import styles from "./app.module.css";

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

/** Whether a Home the phone kept shows a visit, so board B3's error can say it is still booked. */
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
  }, [refreshSoon]);

  // The page's ground follows the screen: ink for the login, paper for everything board B3 draws and once in.
  useEffect(() => {
    document.body.dataset.ground = session.kind === "out" ? "ink" : "paper";
  }, [session.kind]);

  // Each page is named in the browser's title, and its heading takes the focus the tap that opened it left behind.
  useEffect(() => {
    if (!signedIn) return;
    nameInTitle(titles[routeOf(path).page]);
    focusIfLost(document.querySelector("h1"));
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
          {/* Keyed by the path, so each page opens at its top with its own data, and one that failed stays behind. */}
          <ErrorBoundary key={path}>{pageFor(routeOf(path), () => void refresh())}</ErrorBoundary>
        </SessionContext>
      );
  }
}
