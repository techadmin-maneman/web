// The console on a Care person's home screen (docs/decisions/0323-the-unanswered-lead-alert.md): an iPhone shows a
// push only from a web app added to its home screen, which `display: standalone` (packages/web-kit/pwa.ts) makes it.
// Its own short name, so a member of staff who is also a client can tell the two icons apart.

import type { PwaApp } from "../../packages/web-kit/pwa.ts";

export const OPS_APP: PwaApp = {
  name: "Mane Man Ops",
  shortName: "MM Ops",
  description: "Mane Man's console for its staff.",
  ground: "--ink",
};
