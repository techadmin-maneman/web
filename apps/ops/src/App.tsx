// The ops console. There is no login here: Cloudflare Access decides who
// reaches the host, and mm-api checks its token on every call and records the
// identity (docs/decisions/0031-access-and-audit.md). The console therefore
// opens straight on a section.

import { Fragment } from "react";
import { ReferralsScreen } from "./referrals/ReferralsScreen.tsx";
import { routeOf, usePath } from "./route.ts";
import { WaitlistScreen } from "./waitlist/WaitlistScreen.tsx";

export function App() {
  const path = usePath();
  const route = routeOf(path);
  // Keyed by the path, so each section opens at its top with its own data.
  return <Fragment key={route.page}>{route.page === "waitlist" ? <WaitlistScreen /> : <ReferralsScreen />}</Fragment>;
}
