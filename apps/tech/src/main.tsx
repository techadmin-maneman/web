import { reportUncaughtErrors } from "@maneman/web-kit/client-errors";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./states/ErrorBoundary.tsx";
import "./styles/global.css";

reportUncaughtErrors();

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
// can close the app and reopen it (apps/tech/sw/sw.ts). A build has one; Vite's
// development server does not.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Without it the app still works while it stays open, on its own store.
  });
}
