// The ops console's tabs (the client page's, and Settings after it): a row of words,
// the chosen one in the text's ink over an ink rule. Each tab is a link the app
// draws with its own link component, given the tab's look:
//
//   <Tabs label={copy.tabs}>
//     <OpsLink className={TAB} to={path} current={chosen}>{name}</OpsLink>
//   </Tabs>

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./tabs.module.css";

/** Which ends of a row too long for its room run on past its edges. */
type More = "start" | "end" | "both";

function moreOf(row: HTMLElement): More | undefined {
  const before = row.scrollLeft > 1;
  const after = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
  if (before && after) return "both";
  if (before) return "start";
  return after ? "end" : undefined;
}

/**
 * A row too long for its room: the open tab kept in view as the row is drawn, its room changes and its tabs come once
 * the grants are read, and which ends run on, for the fade that says so. A scroll of the row's own is left where it is.
 */
function useRunsOn() {
  const row = useRef<HTMLElement>(null);
  const [more, setMore] = useState<More | undefined>(undefined);
  useEffect(() => {
    const shown = row.current;
    if (shown === null) return;
    const measure = () => {
      setMore(moreOf(shown));
    };
    const settle = () => {
      const open = shown.querySelector("[aria-current]");
      const past = open === null ? 0 : open.getBoundingClientRect().right - shown.getBoundingClientRect().right;
      if (past > 0) shown.scrollLeft += past + shown.clientWidth / 4;
      measure();
    };
    settle();
    shown.addEventListener("scroll", measure, { passive: true });
    const resized = new ResizeObserver(settle);
    resized.observe(shown);
    const changed = new MutationObserver(settle);
    changed.observe(shown, { childList: true, subtree: true, attributeFilter: ["aria-current"] });
    return () => {
      shown.removeEventListener("scroll", measure);
      resized.disconnect();
      changed.disconnect();
    };
  }, []);
  return [row, more] as const;
}

export function Tabs({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const [row, more] = useRunsOn();
  return (
    <nav ref={row} className={classes(styles.tabs, className)} aria-label={label} data-more={more}>
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
