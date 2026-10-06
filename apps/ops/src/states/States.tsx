// What a panel shows while its data comes, and when it does not. The ops
// designs draw neither, so these follow the client app's (packages/ui/States.tsx): the shape of a label and a card, then one line and
// a way to try again, at a panel's padding.

import { ErrorRef } from "@maneman/ui/ErrorRef";
import { Failed, Loading as SharedLoading } from "@maneman/ui/States";
import { states } from "../content.ts";
import styles from "./states.module.css";

export function Loading() {
  return <SharedLoading label={states.loading} className={styles.loading} />;
}

/** `requestId`: the failed call's, shown for ops to quote; null when the API never answered. */
export function PanelFailed({ onRetry, requestId }: { onRetry: () => void; requestId: string | null }) {
  const reference = requestId === null ? null : <ErrorRef requestId={requestId} words={states.ref} />;
  return (
    <Failed
      message={states.failed}
      retry={states.retry}
      onRetry={onRetry}
      className={styles.failed}
      reference={reference}
    />
  );
}
