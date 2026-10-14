// A screen names itself in the browser's title as it opens (WCAG 2.4.2), for every front end alike.

import { useEffect } from "react";

/**
 * Puts `title` in the browser's title while the screen is drawn; null leaves it to a screen inside this one. `gone`
 * is the title once the screen has gone, where the app gives its own name back.
 */
export function useScreenTitle(title: string | null, gone?: string): void {
  useEffect(() => {
    if (title === null) return;
    document.title = title;
    if (gone === undefined) return;
    return () => {
      document.title = gone;
    };
  }, [title, gone]);
}
