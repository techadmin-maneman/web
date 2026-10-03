// A page's data on its way, and a page whose data did not come. The design
// draws neither for this app, so they follow the client app's shapes on ink
// (packages/ui/States.tsx), in this app's words and sizes.

import { ErrorRef } from "@maneman/ui/ErrorRef";
import { Failed as SharedFailed, Loading as SharedLoading } from "@maneman/ui/States";
import { reference, session } from "../content.ts";
import styles from "./states.module.css";

export function Loading() {
  return <SharedLoading label={session.checking} ground="ink" />;
}

/** `requestId`: the failed call's, shown for the technician to quote; null when the API never answered. */
export function Failed({
  message,
  retry,
  onRetry,
  requestId = null,
}: {
  message: string;
  retry: string;
  onRetry: () => void;
  requestId?: string | null;
}) {
  const shown =
    requestId === null ? null : <ErrorRef requestId={requestId} words={reference} className={styles.reference} />;
  return (
    <SharedFailed
      message={message}
      retry={retry}
      onRetry={onRetry}
      button="outlineOnInk"
      className={styles.failed}
      messageClassName={styles.message}
      reference={shown}
    />
  );
}
