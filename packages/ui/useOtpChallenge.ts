// A sign-in's one-time code, for the client and technician apps alike: the challenge the API last gave, when it gave
// it by the API's clock, how long until another code may be asked for, and one request at a time, since a second
// send bills a second code and voids the first (docs/decisions/0058-one-tap-per-intent.md).

import { useCallback, useState } from "react";
import { useOneAtATime } from "./useOneAtATime.ts";
import { useSecondsLeft } from "./useSecondsLeft.ts";

/** What every challenge says: seconds until a new code may be asked for. */
interface Resendable {
  readonly resend_in_s: number;
}

/** `now` is the API's clock (@maneman/web-kit/clock), which the countdown runs on. */
export function useOtpChallenge<Challenge extends Resendable>(now: () => number) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [busy, once] = useOneAtATime();
  const resendIn = useSecondsLeft(challenge === null ? 0 : sentAt + challenge.resend_in_s * 1000, now);

  /** A code the API has sent: its countdowns run from now, however often the code screen is left. */
  const sent = useCallback(
    (next: Challenge) => {
      setChallenge(next);
      setSentAt(now());
    },
    [now],
  );
  /** Back to the number, as before any code was asked for. */
  const forget = useCallback(() => {
    setChallenge(null);
  }, []);

  return { challenge, sentAt, resendIn, busy, once, sent, forget } as const;
}
