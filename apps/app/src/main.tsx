import { takeSignInMark } from "@maneman/web-kit/access";
import { reportUncaughtErrors } from "@maneman/web-kit/client-errors";
import { keepUpToDate } from "@maneman/web-kit/sw-update";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { carriesLogin, mobileInLink, signInInLink } from "./login/linked-mobile.ts";
import { ErrorBoundary } from "./states/ErrorBoundary.tsx";
import "./styles/global.css";

reportUncaughtErrors();
takeSignInMark();

/**
 * The number or the sign-in the app was opened with, taken off the address at once so neither is left in the
 * browser's history.
 */
function takeLinkedLogin() {
  const { hash, pathname, search } = window.location;
  if (!carriesLogin(hash)) return { mobile: "", signIn: null };
  window.history.replaceState(window.history.state, "", `${pathname}${search}`);
  return { mobile: mobileInLink(hash), signIn: signInInLink(hash) };
}

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
const linked = takeLinkedLogin();
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App linkedMobile={linked.mobile} linkedSignIn={linked.signIn} />
    </ErrorBoundary>
  </StrictMode>,
);

// The service worker keeps the app and the last Home for offline use (apps/app/sw/sw.ts), and a
// new build waits for the app to take it (packages/web-kit/sw-update.ts). A build has one; Vite's
// development server does not.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  keepUpToDate().catch(() => {
    // Without it the app still works, online only.
  });
}
