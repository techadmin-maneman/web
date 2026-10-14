// A day on the road, opened from a column's head (ADR 0120): the map of each technician's route in their colour, and
// beneath it each one's visits in order with the drive between each two, a drive longer than the gap called out.

import { Drawer } from "@maneman/ui/Drawer";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { useEffect, useState } from "react";
import { type DispatchDay } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import { dispatchApi } from "./dispatch-api.ts";

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "loaded"; readonly day: DispatchDay };

type Technician = DispatchDay["technicians"][number];

/** The day's picture, as an address the image can show; null until it comes, or when there is none. */
function useDayMap(date: string, city: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    let made: string | null = null;
    void dispatchApi.dayMap(date, city).then((answer) => {
      if (!current || !answer.ok) return;
      made = URL.createObjectURL(answer.body);
      setUrl(made);
    });
    return () => {
      current = false;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [date, city]);
  return url;
}

function TechnicianRoute({ technician }: { technician: Technician }) {
  const copy = dispatch.routes;
  return (
    <section className={styles.route}>
      <h3 className={styles.routeName}>
        {/* Its colour as the map draws it, by an SVG's fill: the policy allows no inline style. */}
        <svg className={styles.swatch} viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="5" fill={`#${technician.colour}`} />
        </svg>
        {technician.name}
      </h3>
      <ol className={styles.stops}>
        {technician.stops.map((stop) => {
          const leg = technician.legs.find((each) => each.to === stop.appointment_id);
          const what = [stop.sector, stop.type === null ? null : dispatch.types[stop.type], stop.client]
            .filter((part): part is string => typeof part === "string")
            .join(" · ");
          return (
            <li key={stop.appointment_id}>
              {leg !== undefined && (
                <p className={leg.fits ? styles.leg : styles.legTight}>
                  {leg.fits ? copy.drive(leg.minutes, leg.km) : copy.tight(leg.minutes, leg.gap_minutes)}
                </p>
              )}
              <p className={styles.stop}>
                <span className={styles.stopTime}>{indiaClock(stop.starts_at)}</span> {what}
                {!stop.located && <span className={styles.noPin}> · {copy.noPin}</span>}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function DayRoutes({ date, city, onClose }: { date: string; city: string | null; onClose: () => void }) {
  const copy = dispatch.routes;
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const map = useDayMap(date, city);
  const day = shortDate(date);

  useEffect(() => {
    let current = true;
    void dispatchApi.dispatchDay(date, city).then((answer) => {
      if (current) setLoaded(answer.ok ? { state: "loaded", day: answer.body } : { state: "failed" });
    });
    return () => {
      current = false;
    };
  }, [date, city]);

  return (
    <Drawer titleId="day-routes-title" title={copy.title(day)} canClose onDismiss={onClose}>
      {map !== null && <img className={styles.routeMap} src={map} alt={copy.mapAlt(day)} width={640} height={400} />}
      {loaded.state === "loading" && <p className={styles.untoldLine}>{copy.loading}</p>}
      {loaded.state === "failed" && <p className={styles.untoldLine}>{copy.failed}</p>}
      {loaded.state === "loaded" && (
        <>
          {loaded.day.drive_times !== "shown" && (
            <p className={styles.untoldLine}>{copy.driveTimes[loaded.day.drive_times]}</p>
          )}
          {loaded.day.technicians.length === 0 && <p className={styles.untoldLine}>{copy.none}</p>}
          {loaded.day.technicians.map((technician) => (
            <TechnicianRoute key={technician.technician_id} technician={technician} />
          ))}
        </>
      )}
    </Drawer>
  );
}
