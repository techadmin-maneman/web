// How far from the address the technician checked in, against the radius in force then, as the Payments design writes it:
// "240 m · over 200 m fence", over it in the ink the panel keeps for what argues against the charge.

import { noShows } from "../content.ts";
import styles from "./no-shows.module.css";

/** `letIn`: ops let him check in past the fence for this visit, with their reason; null when they did not. */
export function Distance({
  metres,
  radius,
  letIn = null,
}: {
  metres: number | null;
  radius: number;
  letIn?: { readonly reason: string | null } | null;
}) {
  const copy = noShows.queue;
  // Never a number when none was measured: a missing distance is not 0 m, and this fact helps decide whether to
  // charge a client (ADR 0036).
  if (metres === null) return <span className={styles.unmeasured}>{copy.unmeasured}</span>;
  const words = copy.distance(metres, radius);
  const shown = metres > radius ? <span className={styles.over}>{words}</span> : <>{words}</>;
  if (letIn === null) return shown;
  return (
    <>
      {shown} · {copy.letIn(letIn.reason)}
    </>
  );
}
