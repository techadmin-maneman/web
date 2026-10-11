// One change on the Technician pay page: sent, then the page follows the pay the API answers with.

import type { Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { Answer, TechnicianPay } from "../api.ts";

export function usePaySend(onChanged: (pay: TechnicianPay) => void) {
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  /** Whether the change went through. */
  const send = async (call: () => Promise<Answer<TechnicianPay>>): Promise<boolean> => {
    setSending(true);
    setFailure(null);
    const answer = await call();
    setSending(false);
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return false;
    }
    onChanged(answer.body);
    return true;
  };
  const clear = () => {
    setFailure(null);
  };
  return { sending, failure, send, clear };
}
