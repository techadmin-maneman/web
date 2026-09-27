// How the apps move between their pages without a reload. The Worker answers
// every path with the app, so a page can be opened directly; each app reads the
// path with usePath and turns it into its own routes (each app's route.ts).
//
// A link within an app changes the path in place, unless the click asks for
// something else -- a new tab, a new window, a download -- which is left to the
// browser (FEO-31).

import { useEffect, useState, type ReactNode } from "react";

/** The path shown, which keys each page so it opens at its top. */
export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onChange = () => {
      setPath(window.location.pathname);
    };
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
    };
  }, []);
  return path;
}

/** Moves to `path` as a link within the app does: a new entry in the history, and no reload. */
export function go(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** The parts of a click that say where the person wants the link opened. */
export interface Click {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Whether a click on a link within the app should change the page in place. A
 * click with Ctrl, Cmd, Shift or Alt held, or with any button but the main one,
 * asks for a new tab, a new window or a download, and is left to the browser.
 */
export const followsHere = (click: Click): boolean =>
  click.button === 0 && !click.metaKey && !click.ctrlKey && !click.shiftKey && !click.altKey;

/** A link within the app. `current` marks the page it names as the one shown, as navigation does. */
export function Link({
  to,
  className,
  current,
  label,
  children,
}: {
  to: string;
  className?: string;
  current?: boolean;
  /** Its name, where the words inside it are not enough: an icon alone, or a back arrow. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={to}
      aria-current={current === true ? "page" : undefined}
      aria-label={label}
      onClick={(event) => {
        if (!followsHere(event)) return;
        event.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}
