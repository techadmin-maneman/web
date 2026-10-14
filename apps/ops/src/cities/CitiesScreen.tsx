// Admin › Cities (docs/decisions/0198-cities-as-data.md): our cities, each with its state for GST and its zone; the
// rules and prices a city sets apart from the national ones; and the GST registrations a state's visits are supplied
// from. Each change is checked before it is sent, and the page reads itself again after it.

import { useLiveLoad } from "@maneman/ui/useLoad";
import { client } from "../api.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "../components/forms.module.css";
import { CityList } from "./CityList.tsx";
import { CityPrices } from "./CityPrices.tsx";
import { CityRules } from "./CityRules.tsx";
import { Registrations } from "./Registrations.tsx";

const loadCities = () => client.get("/api/cities");

/** Read again every ten minutes while open, and after every change. */
const EVERY_MS = 10 * 60_000;

export function CitiesScreen() {
  const { loaded, refresh, retry } = useLiveLoad(loadCities, EVERY_MS);
  return (
    <>
      <div className={styles.screen}>
        {loaded.state === "loading" && <Loading />}
        {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
        {loaded.state === "loaded" && (
          <>
            <CityList cities={loaded.value} onSaved={refresh} />
            <CityRules cities={loaded.value} onSaved={refresh} />
            <CityPrices cities={loaded.value} onSaved={refresh} />
            <Registrations cities={loaded.value} onSaved={refresh} />
          </>
        )}
      </div>
    </>
  );
}
