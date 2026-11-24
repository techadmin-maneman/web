import { lazyScreen } from "@maneman/ui/lazyScreen";
import { reportUncaughtErrors } from "@maneman/web-kit/client-errors";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyTheme, keptTheme } from "./lib/theme.ts";
import { AppBoundary } from "./frame/ErrorBoundary.tsx";
import { ActionTips } from "@maneman/ui/ActionTips";
import { IconActions } from "@maneman/ui/icon-actions";
import "./styles/global.css";

reportUncaughtErrors();
// The theme chosen in this browser, before anything is drawn.
applyTheme(keptTheme());

// The kit (./kit/KitScreen.tsx) is built into local builds alone: elsewhere the condition is false when the build
// writes it, so its import is dropped with it.
const KitScreen =
  import.meta.env.MM_ENV === "local"
    ? lazyScreen(() => import("./kit/KitScreen.tsx").then((module) => module.KitScreen))
    : null;

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
// Every action in the console is its icon, its words its name and its hover label
// (docs/decisions/0316-every-console-action-an-icon.md).
createRoot(root).render(
  <StrictMode>
    <IconActions.Provider value>
      <AppBoundary>
        {KitScreen !== null && window.location.pathname === "/_kit" ? (
          <Suspense fallback={null}>
            <KitScreen />
          </Suspense>
        ) : (
          <App />
        )}
      </AppBoundary>
      <ActionTips />
    </IconActions.Provider>
  </StrictMode>,
);
