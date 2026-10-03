// What ops do with a "Payment owed" task on the board itself: copy the link Razorpay made, to send by hand, and have
// Razorpay text it to the client again, or make it now where it never did. A link Razorpay refused is sent from its
// dashboard, so it offers neither.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useState } from "react";
import { api, type Task } from "../api.ts";
import { tasks } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { owedLinkOf } from "./payment-link.ts";
import styles from "./tasks.module.css";

const copy = tasks.link;

const errorLine = (code: string): string => copy.errors[code] ?? copy.errors.unknown ?? "";

export function PaymentLinkActions({ task, subject }: { task: Task; subject: string }) {
  const [done, setDone] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const mayResend = useAccess().mayCall("POST /api/payment-links/{id}/resend");
  const link = owedLinkOf(task.detail);
  if (link === null || link.state === "refused") return null;
  const { url } = link;

  const copyLink = async (address: string) => {
    setFailed(null);
    try {
      await navigator.clipboard.writeText(address);
      setDone(copy.copied);
    } catch {
      // The browser would not copy it, so the address is shown to copy by hand.
      setDone(address);
    }
  };

  const resend = () =>
    once(async () => {
      setDone("");
      setFailed(null);
      const answer = await api.resendPaymentLink(task.id);
      if (answer.ok) setDone(copy.outcomes[answer.body.outcome] ?? "");
      else setFailed(errorLine(answer.code));
    });

  return (
    <>
      <span className={styles.acts}>
        {url !== null && (
          <button type="button" className={styles.act} onClick={() => void copyLink(url)}>
            {copy.copy}
            <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
          </button>
        )}
        {mayResend && (
          <button type="button" className={styles.act} disabled={busy} onClick={() => void resend()}>
            {busy ? copy.sending : copy.resend}
            <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
          </button>
        )}
      </span>
      <span className={styles.said} role="status">
        {done}
      </span>
      {failed !== null && (
        <span className={styles.error} role="alert">
          {failed}
        </span>
      )}
    </>
  );
}
