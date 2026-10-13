// The ops console's tabs (the client page's, and Settings after it): a row of words,
// the chosen one in the text's ink over an ink rule. Each tab is a link the app
// draws with its own link component, given the tab's look:
//
//   <Tabs label={copy.tabs}>
//     <OpsLink className={TAB} to={path} current={chosen}>{name}</OpsLink>
//   </Tabs>

import type { ButtonHTMLAttributes, ReactNode } from "react";
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

/** A tab that changes what is shown in place, rather than going to a page: the chosen one is `current`. */
export function TabButton({
  current,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { readonly current: boolean }) {
  return (
    <button
      {...rest}
      type="button"
      className={classes(styles.tab, styles.tabButton, className)}
      aria-current={current ? "true" : undefined}
    />
  );
}
