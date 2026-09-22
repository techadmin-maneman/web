// The client app: the login until there is a session, then Home and its tabs.
// Whether there is a session is the API's to say: the cookie is HttpOnly, and
// the app keeps no token of its own. Offline, Home is the last one the service
// worker kept (board B3), until the connection is back.

import { useCallback, useEffect, useState } from "react";
import { api, forgetHome, type Me } from "./api.ts";
import { HomeScreen } from "./home/HomeScreen.tsx";
import { Shell } from "./home/Shell.tsx";
import { EmptyScreen, VisitsScreen } from "./home/TabScreens.tsx";
import { Login } from "./login/Login.tsx";
import { ProfileScreen } from "./profile/ProfileScreen.tsx";
import { go, usePage, type Page } from "./route.ts";
import { LoadFailed } from "./states/LoadFailed.tsx";
import styles from "./app.module.css";

type Session =
  | { readonly kind: "checking" }
  | { readonly kind: "out" }
  | { readonly kind: "failed" }
  | { readonly kind: "in"; readonly me: Me; readonly offline: boolean };

function pageFor(page: Page, me: Me, offline: boolean, onLogout: () => void, onChanged: () => void) {
  switch (page) {
    case "/":
      return <HomeScreen me={me} offline={offline} />;
    case "/visits":
      return <VisitsScreen me={me} />;
    case "/photos":
      return <EmptyScreen which="photos" />;
    case "/payments":
      return <EmptyScreen which="payments" />;
    case "/refer":
      return <EmptyScreen which="refer" />;
    case "/profile":
      return <ProfileScreen onLogout={onLogout} onChanged={onChanged} />;
  }
}

export function App() {
  const [session, setSession] = useState<Session>({ kind: "checking" });
  const page = usePage();

  const check = useCallback(async () => {
    setSession({ kind: "checking" });
    const answer = await api.me();
    if (answer.ok) setSession({ kind: "in", me: answer.body, offline: answer.cached });
    else if (answer.status === 401) {
      await forgetHome();
      setSession({ kind: "out" });
    } else setSession({ kind: "failed" });
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  /** Home fetched again without the blank wait: after the profile changes it, or when the connection is back. */
  const refresh = useCallback(async () => {
    const answer = await api.me();
    if (answer.ok) setSession({ kind: "in", me: answer.body, offline: answer.cached });
  }, []);

  useEffect(() => {
    const lost = () => {
      setSession((now) => (now.kind === "in" ? { ...now, offline: true } : now));
    };
    const back = () => void refresh();
    window.addEventListener("offline", lost);
    window.addEventListener("online", back);
    return () => {
      window.removeEventListener("offline", lost);
      window.removeEventListener("online", back);
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
      return <LoadFailed onRetry={() => void check()} />;
    case "out":
      return <Login onSignedIn={() => void check()} />;
    case "in":
      return (
        <Shell
          page={page}
          initials={session.me.initials}
          offline={session.offline}
          {...(page === "/profile" ? { name: session.me.name } : {})}
        >
          {pageFor(
            page,
            session.me,
            session.offline,
            () => void logout(),
            () => void refresh(),
          )}
        </Shell>
      );
  }
}
