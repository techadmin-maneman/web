// Beside the Supply plan's lines (docs/decisions/0182-the-events-calendar.md): the forecast it was drafted from, one
// city at a time, at their side on a wide desk as the redesign draws it; and beneath them the events calendar the
// next forecast reads.

import { useLoad } from "@maneman/ui/useLoad";
import type { ReactNode } from "react";
import styles from "./supply-plan.module.css";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { EventsPanel } from "./DemandEvents.tsx";
import { ForecastPanel } from "./Forecast.tsx";
import { supplyPlanApi } from "./supply-plan-api.ts";

const loadCalendar = () => supplyPlanApi.demandEvents();

export function Planning({ lines }: { readonly lines: ReactNode }) {
  const [loaded, retry] = useLoad(loadCalendar);
  return (
    <>
      <div className={styles.beside}>
        <div className={styles.lines}>{lines}</div>
        {loaded.state === "loading" && <PanelLoading />}
        {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
        {loaded.state === "loaded" && <ForecastPanel cities={loaded.value.cities} />}
      </div>
      {loaded.state === "loaded" && <EventsPanel calendar={loaded.value} />}
    </>
  );
}
