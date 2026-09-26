// What a panel shows while its data comes, and when it does not. The ops
// boards draw neither, so these follow the client app's (board B3,
// packages/ui/States.tsx): the shape of a label and a card, then one line and
// a way to try again, at a panel's padding.

import { Failed, Loading as SharedLoading } from "@maneman/ui/States";
import { states } from "../content.ts";
import styles from "./states.module.css";

export function Loading() {
  return <SharedLoading label={states.loading} className={styles.loading} />;
}

export function PanelFailed({ onRetry }: { onRetry: () => void }) {
  return <Failed message={states.failed} retry={states.retry} onRetry={onRetry} className={styles.failed} />;
}
