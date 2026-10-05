// Sharing an invite (boards F2 to F4): which card, the consent its own photographs need, and then the preview
// of the invite. F2 and F4 fill the screen, as drawn; F3 is a sheet over the dark ground.
//
// Choosing their own card without having agreed to the cards' lines opens those lines (F3) instead of choosing
// it. What the sheet does is ./share-flow.ts, and how each step draws it ./ShareSteps.tsx.
//
// Where the phone can share files, WhatsApp and Other apps send the card itself, as a photograph captioned with the
// invite's words; elsewhere WhatsApp's link sends the words, and the chat draws the card from the link (share.ts).
// The card is made a file before the share step shows: a share must start on the tap, with nothing left to fetch.

import { Sheet } from "@maneman/ui/Sheet";
import { useEffect, useRef } from "react";
import type { Refer } from "../api.ts";
import { focusIfLost } from "@maneman/ui/arrival";
import { useShareFlow } from "./share-flow.ts";
import { ChoiceStep, ConsentStep, ShareStep, TITLE_ID } from "./ShareSteps.tsx";
import styles from "./refer.module.css";

export function ShareSheet({ refer: opened, onClose }: { refer: Refer; onClose: (changed: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const flow = useShareFlow(opened);
  const { step } = flow;

  // Each step's heading takes the focus the last step's button took with it.
  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>(`#${TITLE_ID}`) ?? null);
  }, [step]);

  const close = () => dialog.current?.close();
  return (
    <Sheet
      ref={dialog}
      className={styles.dialog}
      labelledBy={TITLE_ID}
      busy={flow.busy}
      onClose={() => {
        onClose(flow.changed());
      }}
    >
      {step === "choice" && <ChoiceStep flow={flow} onClose={close} />}
      {(step === "consent" || step === "composing") && <ConsentStep flow={flow} onClose={close} />}
      {step === "share" && <ShareStep flow={flow} onClose={close} />}
    </Sheet>
  );
}
