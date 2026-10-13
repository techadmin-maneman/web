import { lazyScreen } from "@maneman/ui/lazyScreen";
import { reportUncaughtErrors } from "@maneman/web-kit/client-errors";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { AppBoundary } from "./states/ErrorBoundary.tsx";
import "./styles/global.css";

reportUncaughtErrors();

// The kit (./kit/KitScreen.tsx) is built into local builds alone: elsewhere the condition is false when the build
// writes it, so its import is dropped with it.
const KitScreen =
  import.meta.env.MM_ENV === "local"
    ? lazyScreen(() => import("./kit/KitScreen.tsx").then((module) => module.KitScreen))
    : null;

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <AppBoundary>
      {KitScreen !== null && window.location.pathname === "/_kit" ? (
        <Suspense fallback={null}>
          <KitScreen />
        </Suspense>
      ) : (
        <App />
      )}
    </AppBoundary>
  </StrictMode>,
);
