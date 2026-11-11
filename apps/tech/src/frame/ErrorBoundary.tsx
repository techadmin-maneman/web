// What stands in for a screen that failed to draw (packages/ui/ErrorBoundary.tsx):
// a technician at a door has no way to see why the page went blank, so this
// says so, and offers a reload. The reload loses nothing: the outbox and the
// frames are in IndexedDB, not in the page (apps/tech/src/store/outbox.ts).
// It is drawn in the new look, on paper (docs/decisions/0246-closed-and-sent-back.md).

import { ErrorBoundary as SharedBoundary } from "@maneman/ui/ErrorBoundary";
import { reportRenderError } from "@maneman/web-kit/client-errors";
import type { ReactNode } from "react";
import { broken as copy } from "../content.ts";
import { Failed } from "./States.tsx";
import styles from "./error-boundary.module.css";

function Broken() {
  return (
    <main className={styles.broken} data-look="light">
      <Failed
        message={copy.message}
        retry={copy.reload}
        onPaper
        onRetry={() => {
          window.location.reload();
        }}
      />
    </main>
  );
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <SharedBoundary fallback={<Broken />} onError={reportRenderError}>
      {children}
    </SharedBoundary>
  );
}
