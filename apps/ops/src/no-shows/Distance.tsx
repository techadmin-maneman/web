// How far from the address the technician checked in, against the radius in force then, as board D1 writes it:
// "240 m · over 200 m fence", over it in the ink the panel keeps for what argues against the charge.

import { noShows } from "../content.ts";
import styles from "./no-shows.module.css";

export function Distance({ metres, radius }: { metres: number | null; radius: number }) {
  const copy = noShows.queue;
  // Never a number when none was measured: a missing distance is not 0 m, and this fact helps decide whether to
  // charge a client (ADR 0036).
  if (metres === null) return <span className={styles.unmeasured}>{copy.unmeasured}</span>;
  const words = copy.distance(metres, radius);
  return metres > radius ? <span className={styles.over}>{words}</span> : <>{words}</>;
}
