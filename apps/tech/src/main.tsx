import { dataChanged } from "@maneman/ui/useLoad";
import { lazyScreen } from "@maneman/ui/lazyScreen";
import { takeSignInMark } from "@maneman/web-kit/access";
import { reportUncaughtErrors } from "@maneman/web-kit/client-errors";
import { keepUpToDate } from "@maneman/web-kit/sw-update";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./frame/ErrorBoundary.tsx";
import "./styles/global.css";

reportUncaughtErrors();
takeSignInMark();

// The parts page (./parts/PartsScreen.tsx) is built into local builds alone: elsewhere the condition is false when the
// build writes it, so its import is dropped with it.
const PartsScreen =
  import.meta.env.MM_ENV === "local"
    ? lazyScreen(() => import("./parts/PartsScreen.tsx").then((module) => module.PartsScreen))
    : null;

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      {PartsScreen !== null && window.location.pathname === "/_parts" ? (
        <Suspense fallback={null}>
          <PartsScreen />
        </Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </StrictMode>,
);

// The service worker keeps the shell, so a phone in a basement can close the app
// and reopen it on the day its store kept (apps/tech/sw/sw.ts), and a new build waits for
// the app to take it (packages/web-kit/sw-update.ts). A build has one; Vite's
// development server does not.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  keepUpToDate().catch(() => {
    // Without it the app still works while it stays open, on its own store.
  });
  // A push the worker showed: everything read again, the alerts with it (docs/decisions/0250-guides-and-alerts.md).
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (
      typeof event.data === "object" &&
      event.data !== null &&
      "kind" in event.data &&
      event.data.kind === "mm-alerts"
    ) {
      dataChanged();
    }
  });
}
