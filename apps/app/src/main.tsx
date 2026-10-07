import { takeSignInMark } from "@maneman/web-kit/access";
import { reportUncaughtErrors } from "@maneman/web-kit/client-errors";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { carriesMobile, mobileInLink } from "./login/linked-mobile.ts";
import { ErrorBoundary } from "./states/ErrorBoundary.tsx";
import "./styles/global.css";

reportUncaughtErrors();
takeSignInMark();

/** The number the app was opened with, taken off the address at once so it is not left in the browser's history. */
function takeLinkedMobile(): string {
  const { hash, pathname, search } = window.location;
  if (!carriesMobile(hash)) return "";
  window.history.replaceState(window.history.state, "", `${pathname}${search}`);
  return mobileInLink(hash);
}

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
const linkedMobile = takeLinkedMobile();
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App linkedMobile={linkedMobile} />
    </ErrorBoundary>
  </StrictMode>,
);

// The service worker keeps the app and the last Home for offline use (apps/app/sw/sw.ts). A build
// has one; Vite's development server does not.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Without it the app still works, online only.
  });
}
