// The first thing a keyboard reaches: a link past the navigation to the page's own content, out of sight until it has
// the focus.

import type { ReactNode } from "react";
import styles from "./skip-link.module.css";

export function SkipLink({ onSkip, children }: { readonly onSkip: () => void; readonly children: ReactNode }) {
  return (
    <a
      className={styles.skip}
      href="#content"
      onClick={(event) => {
        event.preventDefault();
        onSkip();
      }}
    >
      {children}
    </a>
  );
}
