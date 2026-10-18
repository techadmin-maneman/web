// Admin › Cities (docs/decisions/0198-cities-as-data.md): our cities, each with its state for GST and its zone; the
// rules and prices a city sets apart from the national ones; and the GST registrations a state's visits are supplied
// from. Each value changes where it reads (docs/decisions/0212-editing-in-place.md), and the page reads itself again
// after it.

import { useLiveLoad } from "@maneman/ui/useLoad";
import { Loading, PanelFailed } from "../states/States.tsx";
import form from "../components/forms.module.css";
import { CityList } from "./CityList.tsx";
import { CityPrices } from "./CityPrices.tsx";
import { Registrations } from "./Registrations.tsx";
import { citiesApi } from "./cities-api.ts";

const loadCities = () => citiesApi.cities();

/** Read again every ten minutes while open, and after every change. */
const EVERY_MS = 10 * 60_000;

export function CitiesScreen() {
  const { loaded, reread, retry } = useLiveLoad(loadCities, EVERY_MS);
  return (
    <div className={form.screen}>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <>
          <CityList cities={loaded.value} reread={reread} />
          <CityPrices cities={loaded.value} reread={reread} />
          <Registrations cities={loaded.value} reread={reread} />
        </>
      )}
    </div>
  );
}
