// What stands in for a screen that failed to draw. React leaves the page blank
// when a render throws, and a technician at a door has no way to see why: this
// says so, and offers a reload. The reload loses nothing — the outbox and the
// frames are in IndexedDB, not in the page (apps/tech/src/store/outbox.ts).
//
// App puts one round each screen and main.tsx one round App itself. React has
// no hook for this, so it is the app's one class.

import { Component, type ReactNode } from "react";
import { broken as copy } from "../content.ts";
import { Failed } from "./States.tsx";
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
      <main className={styles.broken}>
        <Failed
          message={copy.message}
          retry={copy.reload}
          onRetry={() => {
            window.location.reload();
          }}
        />
      </main>
    );
  }
}
