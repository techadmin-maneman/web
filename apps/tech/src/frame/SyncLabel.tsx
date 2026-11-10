// Whether the phone's work has reached us, at the head of a screen in the new look: synced, how much is still to
// upload, or offline with how much is saved on the phone.

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { classes } from "@maneman/ui/classes";
import { today as copy } from "../content.ts";
import { photoSets } from "../lib/sets.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useSession } from "../session.ts";
import styles from "./light.module.css";

/**
 * How much of the phone's work has not reached us: every write still on it, waiting or stopped by the API, and each
 * photo set not sent; and how many of the writes the API stopped.
 */
export function useUnsent(): { readonly unsent: number; readonly stopped: number } {
  const waiting = useOutbox();
  const stopped = waiting.events.filter((event) => event.state !== "waiting").length;
  return { unsent: waiting.events.length + photoSets(waiting.frames, waiting.events).length, stopped };
}

export function SyncLabel() {
  const { offline } = useSession();
  const { unsent, stopped } = useUnsent();
  let words: string = copy.sync.synced;
  if (stopped > 0) words = copy.sync.stopped(stopped);
  else if (offline) words = copy.sync.offline(unsent);
  else if (unsent > 0) words = copy.sync.sending(unsent);
  return (
    <p className={classes(styles.sync, stopped > 0 && styles.stopped)} role="status">
      <Icon d={GLYPHS.cloud} size="sm" />
      <span>{words}</span>
    </p>
  );
}
