// Whether the phone's work has reached us, at the head of a screen in the new look: synced, how much is still to
// upload, or offline with how much is saved on the phone.

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { today as copy } from "../content.ts";
import { photoSets } from "../lib/sets.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useSession } from "../session.ts";
import styles from "./light.module.css";

/** How much of the phone's work has not reached us: each write still waiting, and each photo set not sent. */
export function useUnsent(): number {
  const waiting = useOutbox();
  const writes = waiting.events.filter((event) => event.state === "waiting").length;
  return writes + photoSets(waiting.frames, waiting.events).length;
}

export function SyncLabel() {
  const { offline } = useSession();
  const unsent = useUnsent();
  let words: string = copy.sync.synced;
  if (offline) words = copy.sync.offline(unsent);
  else if (unsent > 0) words = copy.sync.sending(unsent);
  return (
    <p className={styles.sync} role="status">
      <Icon d={GLYPHS.cloud} size="sm" />
      <span>{words}</span>
    </p>
  );
}
