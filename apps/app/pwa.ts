// The client app on a home screen and in a tab (docs/decisions/0043-client-app.md): its names, and the ink its icons
// and bar are drawn on. The build that makes them is shared with the technician app (packages/web-kit/pwa.ts).

import type { PwaApp } from "../../packages/web-kit/pwa.ts";

export const CLIENT_APP: PwaApp = {
  name: "Mane Man",
  shortName: "Mane Man",
  description: "Your visits, photographs and payments with Mane Man.",
  ground: "--ink",
};
