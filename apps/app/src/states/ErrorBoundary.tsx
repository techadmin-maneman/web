// What stands in for a page that failed to draw. React leaves the screen blank
// when a render throws, and a client has no way to see why: this says so, and
// offers a reload and Home. Nothing is lost by either, since the app keeps
// nothing but Home on the phone.
//
// App puts one round each page and main.tsx one round App itself. React has no
// hook for this, so it is the app's one class.

import { Component, type ReactNode } from "react";
import { broken } from "../content.ts";
import styles from "./states.module.css";

interface Props {
  readonly children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className={styles.failed}>
        <div role="alert">
          <h1 className={styles.title}>{broken.message}</h1>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.retry}
            type="button"
            onClick={() => {
              window.location.reload();
            }}
          >
            {broken.reload}
          </button>
          {/* A whole page load, so a failure round App itself is left behind too. */}
          <a className={styles.message} href="/">
            {broken.home}
          </a>
        </div>
      </main>
    );
  }
}
