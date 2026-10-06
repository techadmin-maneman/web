// The ops console's tabs (the client page's, and Settings after it): a row of words,
// the chosen one in the text's ink over an ink rule. Each tab is a link the app
// draws with its own link component, given the tab's look:
//
//   <Tabs label={copy.tabs}>
//     <OpsLink className={TAB} to={path} current={chosen}>{name}</OpsLink>
//   </Tabs>

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./tabs.module.css";

export function Tabs({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <nav className={classes(styles.tabs, className)} aria-label={label}>
      {children}
    </nav>
  );
}

/** One tab's look; the chosen tab carries aria-current="page". */
export const TAB = styles.tab;
