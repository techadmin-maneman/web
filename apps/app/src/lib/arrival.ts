// A screen names itself in the browser's title as it opens (WCAG 2.4.2). Its heading takes the focus the last
// screen left on nothing with focusIfLost (@maneman/ui/arrival).

import { app } from "../content.ts";

/** "Visits · Mane Man". */
export function nameInTitle(screen: string): void {
  document.title = `${screen} · ${app.name}`;
}
