// A page whose data did not come: one line and "Try again". The design draws
// this for Home only (board B3); the other pages say it more plainly. Offline,
// the line says the page loads once the connection is back, and it then does.

import { Button } from "@maneman/ui/Button";
import { useEffect, useRef } from "react";
import { errors, states } from "../content.ts";
import { useSession } from "../session.ts";
import styles from "./states.module.css";

/** Calls `onBack` once the app, offline, has heard from the API again. */
function useBackOnline(offline: boolean, onBack: () => void): void {
  const wasOffline = useRef(offline);
  useEffect(() => {
    if (wasOffline.current && !offline) onBack();
    wasOffline.current = offline;
  }, [offline, onBack]);
}

export function PageFailed({ onRetry, offlineLine = states.waiting }: { onRetry: () => void; offlineLine?: string }) {
  const { offline } = useSession();
  useBackOnline(offline, onRetry);
  return (
    <div className={styles.pageFailed} role={offline ? "status" : "alert"}>
      <p>{offline ? offlineLine : errors.load}</p>
      <Button variant="primary" size="small" className={styles.retry} onClick={onRetry}>
        {errors.retry}
      </Button>
    </div>
  );
}
