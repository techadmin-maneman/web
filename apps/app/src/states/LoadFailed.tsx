// The error state: the app could not load, with a way to try again and
// a way to reach us. When the phone kept a Home with a visit on it, the visit
// is still booked, and the screen says so.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { states, whatsapp } from "../content.ts";
import { titled } from "../lib/arrival.ts";
import { useScreenTitle } from "@maneman/ui/useScreenTitle";
import shared from "./states.module.css";
import styles from "./load-failed.module.css";

export function LoadFailed({ booked, onRetry }: { booked: boolean; onRetry: () => void }) {
  const copy = states.error;
  useScreenTitle(titled(copy.title));
  return (
    <main className={shared.failed}>
      <div role="alert">
        <h1 className={shared.title}>{copy.title}</h1>
        {booked && <p className={styles.booked}>{copy.booked}</p>}
      </div>
      <div className={shared.actions}>
        <Button variant="primary" size="small" className={shared.retry} onClick={onRetry}>
          {copy.retry}
        </Button>
        <ButtonLink
          variant="outline"
          size="small"
          className={shared.message}
          href={whatsappChat(whatsapp.number)}
          rel="noopener"
        >
          {copy.message}
        </ButtonLink>
      </div>
    </main>
  );
}
