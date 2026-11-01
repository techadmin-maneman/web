// What stands in for a page that failed to draw (packages/ui/ErrorBoundary.tsx). React leaves the console blank when
// a render throws, navigation and all: a page's failure keeps the navigation and offers a reload, and one round the
// whole console, for a failure in the frame itself, offers a reload and the way in again.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { ErrorBoundary } from "@maneman/ui/ErrorBoundary";
import { reportRenderError } from "@maneman/web-kit/client-errors";
import type { ReactNode } from "react";
import { broken } from "../content.ts";
import shared from "./states.module.css";
import styles from "./error-boundary.module.css";

const reload = () => {
  window.location.reload();
};

function Broken({ home }: { home: boolean }) {
  return (
    <div className={shared.failed}>
      <p role="alert">{broken.message}</p>
      <div className={styles.actions}>
        <Button variant="primary" size="small" onClick={reload}>
          {broken.reload}
        </Button>
        {home && (
          <ButtonLink variant="outline" size="small" href="/">
            {broken.home}
          </ButtonLink>
        )}
      </div>
    </div>
  );
}

/** Round one page, inside the frame and keyed by its path, so a failure stays behind when ops move on. */
export function PageBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary fallback={<Broken home={false} />} onError={reportRenderError}>
      {children}
    </ErrorBoundary>
  );
}

/** Round the whole console. */
export function AppBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary fallback={<Broken home />} onError={reportRenderError}>
      {children}
    </ErrorBoundary>
  );
}
