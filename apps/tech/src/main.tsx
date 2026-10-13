import { takeSignInMark } from "@maneman/web-kit/access";
import { reportUncaughtErrors } from "@maneman/web-kit/client-errors";
import { keepUpToDate } from "@maneman/web-kit/sw-update";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./states/ErrorBoundary.tsx";
import "./styles/global.css";

reportUncaughtErrors();
takeSignInMark();

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// The service worker keeps the shell and today's jobs, so a phone in a basement
// can close the app and reopen it (apps/tech/sw/sw.ts), and a new build waits for
// the app to take it (packages/web-kit/sw-update.ts). A build has one; Vite's
// development server does not.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  keepUpToDate().catch(() => {
    // Without it the app still works while it stays open, on its own store.
  });
}
