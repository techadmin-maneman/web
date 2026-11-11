// A step half done, kept on the phone as it is made, so closing the app or a reload loses none of it; gone once the
// step is sent (./Profile.tsx, ./Checklist.tsx).

import { useEffect, useState } from "react";
import { deviceRecord, remove } from "../store/db.ts";
import type { DeviceRecord } from "../store/records.ts";

type DraftKey = "profile_draft" | "checklist_draft" | "options_draft";

type Kept = Extract<DeviceRecord, { readonly key: DraftKey }>;

export type Draft<K extends DraftKey> = Extract<Kept, { readonly key: K }>;

/** Lets go of this job's draft of a step, and never another job's: the phone keeps one of each kind. */
export async function forgetDraft(key: DraftKey, jobId: string): Promise<void> {
  const kept = await deviceRecord<DraftKey>(key);
  if (kept?.job_id === jobId) await remove("device", key);
}

/** This job's draft of a step, kept on the phone; null for none, and while it is still being read. */
export function useDraft<K extends DraftKey>(
  key: K,
  jobId: string,
): { readonly read: boolean; readonly draft: Draft<K> | null } {
  const [kept, setKept] = useState<{ read: boolean; draft: Draft<K> | null }>({ read: false, draft: null });
  useEffect(() => {
    let current = true;
    const settle = (draft: Kept | null) => {
      if (current) setKept({ read: true, draft: draft?.job_id === jobId ? (draft as Draft<K>) : null });
    };
    deviceRecord<DraftKey>(key).then(settle, () => {
      settle(null);
    });
    return () => {
      current = false;
    };
  }, [key, jobId]);
  return kept;
}
