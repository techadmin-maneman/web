// Whether the phone's work has reached us, at the head of a screen in the new look: synced, how much is still to
// upload, or offline with how much is saved on the phone.

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { classes } from "@maneman/ui/classes";
import { today as copy } from "../content.ts";
import { isSetWrite, photoSets } from "../lib/sets.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useSession } from "../session.ts";
import styles from "./light.module.css";

/**
 * How much of the phone's work has not reached us: each photo set not sent, and each other write waiting or stopped by
 * the API, superseded or refused; and how many of the writes the API stopped. A set's own write is the set, so it is
 * counted once. A write it answered as too early is neither, as the queue leaves it out (../store/replay.ts): it is
 * tried again when its time comes.
 */
export function useUnsent(): { readonly unsent: number; readonly stopped: number } {
  const waiting = useOutbox();
  const writes = waiting.events.filter((event) => event.state !== "early");
  const stopped = writes.filter((event) => event.state === "superseded" || event.state === "refused").length;
  const actions = writes.filter((event) => !isSetWrite(event)).length;
  return { unsent: actions + photoSets(waiting.frames, waiting.events).length, stopped };
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
