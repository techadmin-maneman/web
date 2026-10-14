// Beneath the Supply plan's lines (docs/decisions/0182-the-events-calendar.md): the forecast it was drafted from, one
// city at a time, and the events calendar the next forecast reads.

import { useLoad } from "@maneman/ui/useLoad";
import { Loading, PanelFailed } from "../states/States.tsx";
import { EventsPanel } from "./DemandEvents.tsx";
import { ForecastPanel } from "./Forecast.tsx";
import { supplyPlanApi } from "./supply-plan-api.ts";

const loadCalendar = () => supplyPlanApi.demandEvents();

export function Planning() {
  const [loaded, retry] = useLoad(loadCalendar);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  return (
    <>
      <ForecastPanel cities={loaded.value.cities} />
      <EventsPanel calendar={loaded.value} />
    </>
  );
}
