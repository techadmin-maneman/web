// The technician app on a home screen (docs/decisions/0053-the-technician-app-offline.md). Technicians use any phone,
// iPhones among them. On an iPhone the home screen is not a convenience but the
// only way the store is safe: WebKit "currently grants a request [for persistent storage] based on heuristics like
// whether the website is opened as a Home Screen Web App", and a web app added to the home screen keeps "their own
// counter of days of use" rather than Safari's seven-day cap on script-writable storage. `display: standalone`, which
// the shared build gives every app (packages/web-kit/pwa.ts), is what tells the two apart.
//
// Its own short name, so a technician who is also a client can tell the two icons apart, and held upright: a turned
// phone in a gloved hand should not rearrange the job.

import type { PwaApp } from "../../packages/web-kit/pwa.ts";

export const TECH_APP: PwaApp = {
  name: "Mane Man technician",
  shortName: "MM Tech",
  description: "The day's jobs for Mane Man's technicians: check in, photograph and close each visit.",
  ground: "--ink-deep",
  orientation: "portrait",
};
