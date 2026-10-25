// Settings › Areas' writes (./Served.tsx): each change is sent as it is made, a row's from its drawer, the chosen rows'
// from their bar and a file's once its changes are read. One that would message people waiting, or that the bar
// asks about, waits on ops's yes (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { useState, type Dispatch, type SetStateAction } from "react";
import type { AreaChange, ServedPincode } from "../api.ts";
import { afterSave, launchesIn } from "./served-draft.ts";
import { areasApi } from "./areas-api.ts";

export type Saving =
  | { readonly step: "idle" | "saving" }
  | { readonly step: "saved"; readonly changed: number; readonly alerted: number }
  | { readonly step: "failed"; readonly code: string };

/** Changes waiting on ops's yes: the launch check where they would message people, else the bar's own question. */
export interface Asking {
  readonly changes: readonly AreaChange[];
  readonly launching: readonly ServedPincode[];
  readonly question: string | null;
}

export function useAreaSaves(
  pincodes: readonly ServedPincode[],
  setPincodes: Dispatch<SetStateAction<readonly ServedPincode[]>>,
  onSaved: () => void,
) {
  const [saving, setSaving] = useState<Saving>({ step: "idle" });
  const [asking, setAsking] = useState<Asking | null>(null);

  const send = async (changes: readonly AreaChange[]) => {
    setSaving({ step: "saving" });
    const answer = await areasApi.setServiceArea(changes);
    setAsking(null);
    if (!answer.ok) {
      setSaving({ step: "failed", code: answer.code });
      return;
    }
    setPincodes((held) => afterSave(held, changes));
    setSaving({ step: "saved", changed: answer.body.changed, alerted: answer.body.alerted });
    onSaved();
  };

  /** Sends the changes at once, unless they would message people waiting or come with a question to ask first. */
  const commit = (changes: readonly AreaChange[], question: string | null = null) => {
    if (changes.length === 0) return;
    const launching = launchesIn(pincodes, changes);
    if (launching.length > 0 || question !== null) setAsking({ changes, launching, question });
    else void send(changes);
  };

  return {
    saving,
    asking,
    send,
    commit,
    cancel: () => {
      setAsking(null);
    },
  };
}
