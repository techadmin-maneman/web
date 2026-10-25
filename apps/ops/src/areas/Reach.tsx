// A city's reach under Areas › Served (docs/decisions/0223-reach-from-home.md): its pincodes and its technicians' reach
// from home as one map, the served pincodes no reach takes in, and each technician's reach as a way to choose its
// pincodes, which the bar above then serves, schedules or pauses.

import { Button } from "@maneman/ui/Button";
import { Fieldset } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { useCallback, useEffect, useState } from "react";
import type { CityReach } from "../api.ts";
import { areas } from "../content.ts";
import form from "../components/forms.module.css";
import { useAccess } from "../lib/access.ts";
import shared from "./areas.module.css";
import { areasApi } from "./areas-api.ts";
import { LaunchList } from "./Launches.tsx";
import { RecentLaunches } from "./Demand.tsx";

const copy = areas.reach;

/** The city's picture, as an address the image can show; null until it comes, or where there is none. */
function useAreaMap(city: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    let made: string | null = null;
    setUrl(null);
    void areasApi.areaMap(city).then((answer) => {
      if (!current || !answer.ok) return;
      made = URL.createObjectURL(answer.body);
      setUrl(made);
    });
    return () => {
      current = false;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [city]);
  return url;
}

/** The served pincodes no reach takes in, each with the nearest technician, and the way to choose them all. */
function Unreached({ reach, onChoose }: { reach: CityReach; onChoose: (pincodes: ReadonlySet<string>) => void }) {
  const names = new Map(reach.technicians.map((each) => [each.id, each.name]));
  const unreached = reach.pincodes.filter((each) => each.served && each.reached === false);
  if (reach.pincodes.every((each) => each.reached === null)) return <p className={shared.note}>{copy.unmeasured}</p>;
  if (unreached.length === 0) return <p className={shared.note}>{copy.allReached}</p>;
  return (
    <div className={shared.readiness}>
      <p className={shared.readinessTitle}>{copy.outOfReach(unreached.length)}</p>
      <ul className={shared.checks}>
        {unreached.map((each) => {
          const nearest = each.nearest;
          const name = nearest === null ? undefined : names.get(nearest.technician_id);
          const said = nearest === null || name === undefined ? null : copy.nearest(name, nearest.minutes);
          return (
            <li key={each.pincode} className={shared.missing}>
              {copy.unreached(each.pincode, each.area, said)}
            </li>
          );
        })}
      </ul>
      <div className={shared.actions}>
        <Button
          variant="outline"
          size="small"
          narrow
          onClick={() => {
            onChoose(new Set(unreached.map((each) => each.pincode)));
          }}
        >
          {copy.chooseUnreached}
        </Button>
      </div>
    </div>
  );
}

/** Each technician with a home, how far they go, how many pincodes that takes in, and the way to choose them. */
function Within({ reach, onChoose }: { reach: CityReach; onChoose: (pincodes: ReadonlySet<string>) => void }) {
  const homed = reach.technicians.filter((each) => each.home !== null);
  if (homed.length === 0) return null;
  return (
    <ul className={shared.launchList}>
      {homed.map((technician) => {
        const theirs = reach.pincodes.filter((each) => each.reached_by.includes(technician.id));
        return (
          <li key={technician.id} className={shared.launchItem}>
            <p className={shared.launchLine}>{copy.within(technician.name, technician.reach_min, theirs.length)}</p>
            <Button
              variant="outline"
              size="small"
              narrow
              aria-label={copy.chooseWithin(technician.name)}
              disabled={theirs.length === 0}
              onClick={() => {
                onChoose(new Set(theirs.map((each) => each.pincode)));
              }}
            >
              {copy.choose}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function Reach({ city, onChoose }: { city: string; onChoose: (pincodes: ReadonlySet<string>) => void }) {
  const load = useCallback(() => areasApi.reach(city), [city]);
  const [loaded] = useLoad(load);
  const map = useAreaMap(city);
  return (
    <Fieldset className={form.group} legend={copy.title} legendLook="title">
      {map !== null && <img className={shared.areaMap} src={map} alt={copy.mapAlt(city)} width={640} height={400} />}
      {map !== null && <p className={shared.note}>{copy.key}</p>}
      {loaded.state === "loaded" && <Unreached reach={loaded.value} onChoose={onChoose} />}
      {loaded.state === "loaded" && <Within reach={loaded.value} onChoose={onChoose} />}
    </Fieldset>
  );
}

/** What Served shows of the city beneath its table: its reach, where the person may read it, and every launch. */
export function CityTools({ city, onChoose }: { city: string; onChoose: (pincodes: ReadonlySet<string>) => void }) {
  const mayRead = useAccess().mayCall("GET /api/service-area/reach");
  return (
    <>
      {mayRead && city !== "" && <Reach city={city} onChoose={onChoose} />}
      <LaunchList />
      <RecentLaunches />
    </>
  );
}
