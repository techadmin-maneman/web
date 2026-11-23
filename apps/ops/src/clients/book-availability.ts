// The fortnight's windows Book a visit draws (./BookVisit.tsx), read again as what is booked changes, and the starts
// a booking was refused at in the panel, which it offers no more.

import { useLoad } from "@maneman/ui/useLoad";
import { useCallback, useEffect, useState } from "react";
import { type VisitAvailability, type VisitType } from "../api.ts";
import { clientsApi } from "./clients-api.ts";
import { type Choice, kindOf } from "./book-slot.ts";

/** How long a read runs before the panel dims and says it is finding times: a quick one changes nothing drawn. */
const SAY_AFTER_MS = 300;

/**
 * Where the read for what is being booked stands, while the last answer stays drawn. `finding`: the answer drawn is
 * for other choices, whose times must not be taken for these. `drawnKind`: the kind it was read for, whose services
 * it lists. `tier`: the service asked for while its read runs, drawn as chosen meanwhile. `slow`: the read has run
 * long enough to be seen, and said.
 */
export interface Reading {
  readonly finding: boolean;
  readonly drawnKind: VisitType;
  readonly tier: string | undefined;
  readonly slow: boolean;
}

/**
 * The days without each start a booking was refused at in this panel: offered on the plan's
 * estimate of the drives, then found by the drives themselves not to fit, it would only be refused again.
 */
function withoutRefused(offered: VisitAvailability, refused: ReadonlySet<string>): VisitAvailability {
  if (refused.size === 0) return offered;
  return {
    ...offered,
    days: offered.days.map((day) => ({
      ...day,
      starts: day.starts.filter((start) => !refused.has(start.starts_at)),
    })),
  };
}

/** Whether `on` has held, for the same `asked`, as long as SAY_AFTER_MS. */
function useHeld(on: boolean, asked: string): boolean {
  const [heldFor, setHeldFor] = useState<string | null>(null);
  if (!on && heldFor !== null) setHeldFor(null);
  useEffect(() => {
    if (!on) return;
    const wait = setTimeout(() => {
      setHeldFor(asked);
    }, SAY_AFTER_MS);
    return () => {
      clearTimeout(wait);
    };
  }, [on, asked]);
  return on && heldFor === asked;
}

/**
 * The fortnight's windows for what is being booked, read again as any of it changes. While a read runs the last
 * answer stays drawn, so nothing jumps; each answer is marked with what it was asked for. `refuse` shuts a start
 * the booking was refused at, offered no more, and reads the days afresh, the panel drawn as it was meanwhile.
 */
export function useAvailability(clientId: string, choice: Choice, tier: string | undefined, from: string | undefined) {
  const [round, setRound] = useState(0);
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());
  const kind = kindOf(choice);
  const asked = `${kind}|${tier ?? ""}|${from ?? ""}|${String(round)}`;
  const load = useCallback(
    () =>
      clientsApi
        .visitAvailability({
          client: clientId,
          kind,
          ...(tier === undefined ? {} : { tier }),
          ...(from === undefined ? {} : { from }),
        })
        .then((answer) => (answer.ok ? { ...answer, body: { ...answer.body, asked, askedKind: kind } } : answer)),
    [clientId, kind, tier, from, asked],
  );
  const [loaded, retry] = useLoad(load);
  const finding = loaded.state === "loaded" && loaded.value.asked !== asked;
  const reading: Reading = {
    finding,
    drawnKind: loaded.state === "loaded" ? loaded.value.askedKind : kind,
    tier: finding ? tier : undefined,
    slow: useHeld(finding, asked),
  };
  const refuse = (startsAt: string) => {
    setRefused((was) => new Set([...was, startsAt]));
    setRound((was) => was + 1);
  };
  const shown = loaded.state === "loaded" ? { ...loaded, value: withoutRefused(loaded.value, refused) } : loaded;
  return { loaded: shown, retry, refuse, reading };
}
