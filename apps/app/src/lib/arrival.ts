// What happens as a screen, or a sheet's step, opens, so that someone who
// cannot see it change is told it has (WCAG 2.4.2 and 2.4.3): the browser's
// title names the screen, and its heading takes the focus that the tap which
// changed it has left on nothing.

import { app } from "../content.ts";

/** "Visits · Mane Man". */
export function nameInTitle(screen: string): void {
  document.title = `${screen} · ${app.name}`;
}

/**
 * Moves focus to `heading` when focus is on nothing: the control that changed
 * the screen has gone with the last one. A screen that has put focus in a
 * field of its own, such as the code's, keeps it there.
 */
export function focusIfLost(heading: HTMLElement | null): void {
  const lost = document.activeElement === null || document.activeElement === document.body;
  if (!lost || heading === null) return;
  // A heading takes focus only when asked; -1 keeps it out of the tab order.
  heading.tabIndex = -1;
  heading.focus();
}
