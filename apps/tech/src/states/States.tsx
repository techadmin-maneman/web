// A page's data on its way, and a page whose data did not come. The design
// draws neither for this app, so they follow the client app's shapes on ink
// (packages/ui/States.tsx), in this app's words and sizes.

import { Failed as SharedFailed, Loading as SharedLoading } from "@maneman/ui/States";
import { session } from "../content.ts";
import styles from "./states.module.css";

export function Loading() {
  return <SharedLoading label={session.checking} ground="ink" />;
}

export function Failed({ message, retry, onRetry }: { message: string; retry: string; onRetry: () => void }) {
  return (
    <SharedFailed
      message={message}
      retry={retry}
      onRetry={onRetry}
      button="outlineOnInk"
      className={styles.failed}
      messageClassName={styles.message}
    />
  );
}
