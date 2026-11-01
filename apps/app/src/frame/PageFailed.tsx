// A page whose data did not come: one line, "Try again", and a way to message us. The design draws this for Home
// only; the other pages say it more plainly. Offline, the line says the page loads once the connection is back, and it
// then does.

import { ButtonLink } from "@maneman/ui/Button";
import { Failed } from "@maneman/ui/States";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { useEffect, useRef } from "react";
import { errors, states, whatsapp } from "../content.ts";
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
    <Failed
      message={offline ? offlineLine : errors.load}
      retry={errors.retry}
      onRetry={onRetry}
      button="primary"
      polite={offline}
      className={styles.pageFailed}
      retryClassName={styles.retry}
      also={
        offline ? null : (
          <ButtonLink variant="outline" size="small" href={whatsappChat(whatsapp.number)} rel="noopener">
            {errors.message}
          </ButtonLink>
        )
      }
    />
  );
}
