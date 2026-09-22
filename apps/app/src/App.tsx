// The client app: the login until there is a session, then Home and its tabs.
// Whether there is a session is the API's to say: the cookie is HttpOnly, and
// the app keeps no token of its own.

import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api.ts";
import { errors } from "./content.ts";
import { HomeScreen } from "./home/HomeScreen.tsx";
import { Shell } from "./home/Shell.tsx";
import { EmptyScreen, VisitsScreen } from "./home/TabScreens.tsx";
import { Login } from "./login/Login.tsx";
import { ProfileScreen } from "./profile/ProfileScreen.tsx";
import { go, usePage, type Page } from "./route.ts";
import styles from "./app.module.css";

type Session =
  | { readonly kind: "checking" }
  | { readonly kind: "out" }
  | { readonly kind: "failed" }
  | { readonly kind: "in"; readonly me: Me };

function pageFor(page: Page, me: Me, onLogout: () => void, onChanged: () => void) {
  switch (page) {
    case "/":
      return <HomeScreen me={me} />;
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
    if (answer.ok) setSession({ kind: "in", me: answer.body });
    else setSession(answer.status === 401 ? { kind: "out" } : { kind: "failed" });
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  /** After the profile changes what Home shows, such as the address: fetched again, without the blank wait. */
  const refresh = useCallback(async () => {
    const answer = await api.me();
    if (answer.ok) setSession({ kind: "in", me: answer.body });
  }, []);

  // The page's ground follows the screen: ink for the login, paper once in.
  useEffect(() => {
    document.body.dataset.ground = session.kind === "in" ? "paper" : "ink";
  }, [session.kind]);

  const logout = useCallback(async () => {
    await api.logout();
    go("/");
    setSession({ kind: "out" });
  }, []);

  switch (session.kind) {
    case "checking":
      return <div className={styles.checking} aria-busy="true" />;
    case "failed":
      return (
        <div className={styles.failed} role="alert">
          <p>{errors.load}</p>
          <button className={styles.retry} type="button" onClick={() => void check()}>
            {errors.retry}
          </button>
        </div>
      );
    case "out":
      return <Login onSignedIn={() => void check()} />;
    case "in":
      return (
        <Shell page={page} initials={session.me.initials} {...(page === "/profile" ? { name: session.me.name } : {})}>
          {pageFor(
            page,
            session.me,
            () => void logout(),
            () => void refresh(),
          )}
        </Shell>
      );
  }
}
