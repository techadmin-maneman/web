// The moments the phone sends what it holds without being asked: signal coming back, and the app coming to the front.

import { useEffect, useRef } from "react";
import { replay } from "../store/outbox.ts";

export function useReplayTriggers(online: boolean, check: () => Promise<void>): void {
  // Back on signal: ask the API again, which also replays everything the outbox
  // is holding. Only the return matters, so the check does not run in a circle
  // when the API is reachable and unhappy.
  const lostSignal = useRef(false);
  useEffect(() => {
    if (!online) {
      lostSignal.current = true;
      return;
    }
    if (!lostSignal.current) return;
    lostSignal.current = false;
    void check();
  }, [online, check]);

  /*
   * Every time the app comes to the front, the outbox is sent. iOS does not
   * fire `online` reliably, and a phone that found signal in a pocket has no
   * other moment to notice: the less time a job spends only on the phone, the
   * less of it an eviction can take (apps/tech/src/store/persist.ts).
   */
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === "visible") void replay();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
    };
  }, []);
}
