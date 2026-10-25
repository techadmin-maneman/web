// What a form just did, said in one place on every page: a note at the foot of the window, read as a status, which
// goes by itself after a few seconds. Only for a plain confirmation, "Saved" or "Recorded"; a message the reader must
// act on or copy, as a payment link or a code just made, stays beside its form (./InlineMessage.tsx).

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./toast.module.css";

/** How long a toast stays before it goes. */
const SHOWN_MS = 6000;

/**
 * The place every toast is drawn, made on first use, so two at once stack rather than overlap: in the drawer open over
 * the page where there is one, since a modal dialog leaves the page beneath it unseen and inert, else in the page.
 */
function region(): HTMLElement {
  const host = document.querySelector<HTMLElement>("dialog[open]") ?? document.body;
  const there = host.querySelector<HTMLElement>(":scope > [data-toasts]");
  if (there !== null) return there;
  const made = document.createElement("div");
  made.dataset.toasts = "";
  made.className = styles.region ?? "";
  host.append(made);
  return made;
}

export function Toast({ children }: { readonly children: ReactNode }) {
  const [shown, setShown] = useState(true);
  // Found once what it follows has drawn: a save that closes its drawer says so on the page, not in the drawer going.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost(region());
  }, []);
  useEffect(() => {
    setShown(true);
    const gone = setTimeout(() => {
      setShown(false);
    }, SHOWN_MS);
    return () => {
      clearTimeout(gone);
    };
  }, [children]);
  if (!shown || host === null) return null;
  return createPortal(
    <p className={styles.toast} role="status">
      {children}
    </p>,
    host,
  );
}
