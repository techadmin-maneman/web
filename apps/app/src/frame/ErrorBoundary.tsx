// What stands in for a page that failed to draw (packages/ui/ErrorBoundary.tsx).
// React leaves the screen blank when a render throws, and a client has no way
// to see why: this says so, and offers a reload and Home. Nothing is lost by
// either, since the app keeps nothing but Home on the phone.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { ErrorBoundary as SharedBoundary } from "@maneman/ui/ErrorBoundary";
import { reportRenderError } from "@maneman/web-kit/client-errors";
import type { ReactNode } from "react";
import { broken } from "../content.ts";
import styles from "./states.module.css";

function Broken() {
  return (
    <main className={styles.failed}>
      <div role="alert">
        <h1 className={styles.title}>{broken.message}</h1>
      </div>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="small"
          className={styles.retry}
          onClick={() => {
            window.location.reload();
          }}
        >
          {broken.reload}
        </Button>
        {/* A whole page load, so a failure round App itself is left behind too. */}
        <ButtonLink variant="outline" size="small" className={styles.message} href="/">
          {broken.home}
        </ButtonLink>
      </div>
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
