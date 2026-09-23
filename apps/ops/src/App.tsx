// The ops console. There is no login here: Cloudflare Access decides who
// reaches the host, and mm-api checks its token on every call and records the
// identity (docs/decisions/0031-access-and-audit.md). The console therefore
// opens straight on a section.

import { Fragment } from "react";
import { ClientScreen } from "./clients/ClientScreen.tsx";
import { FindClientScreen } from "./clients/FindClientScreen.tsx";
import { NoShowsScreen } from "./no-shows/NoShowsScreen.tsx";
import { ReferralsScreen } from "./referrals/ReferralsScreen.tsx";
import { keyOf, routeOf, usePath, type Route } from "./route.ts";
import { TechniciansScreen } from "./technicians/TechniciansScreen.tsx";
import { WaitlistScreen } from "./waitlist/WaitlistScreen.tsx";

function Page({ route }: { route: Route }) {
  if (route.page === "waitlist") return <WaitlistScreen />;
  if (route.page === "referrals") return <ReferralsScreen />;
  if (route.page === "no-shows") return <NoShowsScreen />;
  if (route.page === "technicians") return <TechniciansScreen />;
  if (route.clientId === null) return <FindClientScreen />;
  return <ClientScreen clientId={route.clientId} tab={route.tab} />;
}

export function App() {
  const route = routeOf(usePath());
  // Keyed by the path, so each section opens at its top with its own data.
  return (
    <Fragment key={keyOf(route)}>
      <Page route={route} />
    </Fragment>
  );
}
