// The client app: the login until there is a session, then Home and its tabs.
// Whether there is a session is the API's to say: the cookie is HttpOnly, and
// the app keeps no token of its own. Offline, Home is the last one the service
// worker kept (board B3), until the connection is back.

import { Fragment, useCallback, useEffect, useState } from "react";
import { api, forgetHome, keptHome, type Me } from "./api.ts";
import { HomeScreen } from "./home/HomeScreen.tsx";
import { ReferScreen } from "./home/TabScreens.tsx";
import { Login } from "./login/Login.tsx";
import { EntryScreen } from "./payments/EntryScreen.tsx";
import { PaymentsScreen } from "./payments/PaymentsScreen.tsx";
import { CompareScreen } from "./photos/CompareScreen.tsx";
import { PhotosScreen } from "./photos/PhotosScreen.tsx";
import { ProfileScreen } from "./profile/ProfileScreen.tsx";
import { go, routeOf, usePath, type Route } from "./route.ts";
import { SessionContext } from "./session.ts";
import { LoadFailed } from "./states/LoadFailed.tsx";
import { VisitScreen } from "./visits/VisitScreen.tsx";
import { VisitsScreen } from "./visits/VisitsScreen.tsx";
import styles from "./app.module.css";

type Session =
  | { readonly kind: "checking" }
  | { readonly kind: "out" }
  | { readonly kind: "failed"; readonly booked: boolean }
  | { readonly kind: "in"; readonly me: Me; readonly offline: boolean };

function pageFor(route: Route, onLogout: () => void, onChanged: () => void) {
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
    case "profile":
      return <ProfileScreen onLogout={onLogout} onChanged={onChanged} />;
  }
}

/** Whether a Home the phone kept shows a visit, so board B3's error can say it is still booked. */
async function stillBooked(): Promise<boolean> {
  const kept = await keptHome().catch(() => null);
  return kept !== null && (kept.next_visit !== null || kept.consultation !== null);
}

export function App() {
  const [session, setSession] = useState<Session>({ kind: "checking" });
  const path = usePath();

  const check = useCallback(async () => {
    setSession({ kind: "checking" });
    const answer = await api.me();
    if (answer.ok) setSession({ kind: "in", me: answer.body, offline: answer.cached });
    else if (answer.status === 401) {
      await forgetHome();
      setSession({ kind: "out" });
    } else setSession({ kind: "failed", booked: await stillBooked() });
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

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

  useEffect(() => {
    const lost = () => {
      setSession((now) => (now.kind === "in" ? { ...now, offline: true } : now));
    };
    // A connection is often not usable the moment it returns, so Home is tried a few times.
    const back = async () => {
      for (const wait of [0, 1_000, 3_000, 10_000]) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        if (await refresh()) return;
      }
    };
    window.addEventListener("offline", lost);
    const onBack = () => void back();
    window.addEventListener("online", onBack);
    return () => {
      window.removeEventListener("offline", lost);
      window.removeEventListener("online", onBack);
    };
  }, [refresh]);

  // The page's ground follows the screen: ink for the login, paper once in, and for board B3's error.
  useEffect(() => {
    document.body.dataset.ground = session.kind === "in" || session.kind === "failed" ? "paper" : "ink";
  }, [session.kind]);

  const logout = useCallback(async () => {
    await forgetHome();
    await api.logout();
    go("/");
    setSession({ kind: "out" });
  }, []);

  switch (session.kind) {
    case "checking":
      return <div className={styles.checking} aria-busy="true" />;
    case "failed":
      return <LoadFailed booked={session.booked} onRetry={() => void check()} />;
    case "out":
      return <Login onSignedIn={() => void check()} />;
    case "in":
      return (
        <SessionContext value={{ me: session.me, offline: session.offline, refresh: () => void refresh() }}>
          {/* Keyed by the path, so each page opens at its top with its own data. */}
          <Fragment key={path}>
            {pageFor(
              routeOf(path),
              () => void logout(),
              () => void refresh(),
            )}
          </Fragment>
        </SessionContext>
      );
  }
}
