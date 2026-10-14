// A write as every screen sends one: one at a time (docs/decisions/0058-one-tap-per-intent.md), its answer's body
// handed on, and its refusal kept for the screen to say through Refusal, which reads the page again when what the
// write acted on had changed.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import type { Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { Answer } from "../api.ts";

export function useWrite<Body>(onDone: (body: Body) => void): {
  readonly busy: boolean;
  readonly failure: Failure | null;
  /** Whether the write went through; a second press while one is on its way sends nothing, and answers false. */
  readonly send: (call: () => Promise<Answer<Body>>) => Promise<boolean>;
} {
  const [busy, once] = useOneAtATime();
  const [failure, setFailure] = useState<Failure | null>(null);
  const send = async (call: () => Promise<Answer<Body>>): Promise<boolean> => {
    let sent = false;
    await once(async () => {
      setFailure(null);
      const answer = await call();
      if (!answer.ok) {
        setFailure({ code: answer.code, fields: answer.fields });
        return;
      }
      onDone(answer.body);
      sent = true;
    });
    return sent;
  };
  return { busy, failure, send };
}
