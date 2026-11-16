// What a form just did, said in one place on every page: a note at the foot of the window, read as a status, which
// goes by itself after a few seconds. Only for a plain confirmation, "Saved" or "Recorded"; a message the reader must
// act on or copy, as a payment link or a code just made, stays beside its form (./InlineMessage.tsx).
//
// The phone apps draw it the screen's width less 12 px each side, above the tab bar or the action bar, with an icon
// before the words, for 2.6 seconds (`fullWidth`; docs/prompts/client-redesign.md, W10). How far above the foot it
// sits is the page's --toast-lift, which the app sets for its bars.

import { ICONS } from "@maneman/brand/icons";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.tsx";
import styles from "./toast.module.css";

/** How long a toast stays before it goes: the console's, and the phone apps' full-width one. */
const SHOWN_MS = 6000;
const SHOWN_FULL_MS = 2600;

/**
 * The place every toast is drawn, made on first use, so two at once stack rather than overlap: in the drawer open over
 * the page where there is one, since a modal dialog leaves the page beneath it unseen and inert, else in the page.
 */
function region(full: boolean): HTMLElement {
  const host = document.querySelector<HTMLElement>("dialog[open]") ?? document.body;
  const kind = full ? "full" : "note";
  const there = host.querySelector<HTMLElement>(`:scope > [data-toasts="${kind}"]`);
  if (there !== null) return there;
  const made = document.createElement("div");
  made.dataset.toasts = kind;
  made.className = (full ? styles.fullRegion : styles.region) ?? "";
  host.append(made);
  return made;
}

export function Toast({
  children,
  fullWidth = false,
  icon = ICONS.tick,
}: {
  readonly children: ReactNode;
  /** The phone apps' toast: the screen's width, an icon first, 2.6 seconds. */
  readonly fullWidth?: boolean;
  /** The icon before the words, a path from the brand's set; a tick unless said. Full width only. */
  readonly icon?: string;
}) {
  const [shown, setShown] = useState(true);
  // Found once what it follows has drawn: a save that closes its drawer says so on the page, not in the drawer going.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost(region(fullWidth));
  }, [fullWidth]);
  useEffect(() => {
    setShown(true);
    const gone = setTimeout(
      () => {
        setShown(false);
      },
      fullWidth ? SHOWN_FULL_MS : SHOWN_MS,
    );
    return () => {
      clearTimeout(gone);
    };
  }, [children, fullWidth]);
  if (!shown || host === null) return null;
  return createPortal(
    fullWidth ? (
      <p className={styles.full} role="status">
        <Icon d={icon} size="sm" />
        <span>{children}</span>
      </p>
    ) : (
      <p className={styles.toast} role="status">
        {children}
      </p>
    ),
    host,
  );
}
