// A page whose thing the API does not have for this client: a visit or a payment that is not theirs, or no
// longer exists. Trying again would change nothing, so the page says so and offers the way back.

import { AppLink } from "../home/Shell.tsx";
import styles from "./states.module.css";

export function NotFound({ message, back, to }: { message: string; back: string; to: string }) {
  return (
    <div className={styles.pageFailed} role="alert">
      <p>{message}</p>
      <AppLink className={styles.message} to={to}>
        {back}
      </AppLink>
    </div>
  );
}
