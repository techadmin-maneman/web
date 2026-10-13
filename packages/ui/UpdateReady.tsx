// The line above every screen of an app once a new build of it is waiting (packages/web-kit/sw-update.ts), with the
// button that loads it. It stays out of the way: the app takes the build by itself at its next quiet moment, which
// `atRest` names, signed in on its first screen.

import { applyUpdate, atRest, onUpdateReady, updateReady } from "@maneman/web-kit/sw-update";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "./Button.tsx";
import { classes } from "./classes.ts";
import styles from "./update-ready.module.css";

export function UpdateReady({
  copy,
  resting,
  onInk = false,
}: {
  readonly copy: { readonly line: string; readonly action: string };
  /** Whether loading the app again here loses nothing. */
  readonly resting: boolean;
  /** On the technician app's ink, where the client app's screens are paper. */
  readonly onInk?: boolean;
}) {
  const ready = useSyncExternalStore(onUpdateReady, updateReady);
  useEffect(() => {
    atRest(resting);
    return () => {
      atRest(false);
    };
  }, [resting]);
  if (!ready) return null;
  return (
    <div className={classes(styles.ready, onInk && styles.onInk)} role="status">
      <p className={styles.line}>{copy.line}</p>
      <Button variant={onInk ? "outlineOnInk" : "outline"} size="small" onClick={applyUpdate}>
        {copy.action}
      </Button>
    </div>
  );
}
