// Which technicians may take a new booking, by the mobile number they sign in with. A technician signs in with the
// number FSM holds on his user, so one whose number cannot be read, or whose number another technician already signs
// in on, never receives a code, and a visit booked to him would reach no phone.

export const RULES = [
  "A technician with no mobile number the mirror can read is kept out of new bookings until FSM holds one.",
  "Where two active technicians hold one number, the one who signs in on it stays bookable and the other is kept out of new bookings until FSM is corrected.",
  "Ops are alerted once for each technician kept out, by his FSM ID.",
] as const;

export type NumberProblem =
  | { readonly kind: "unreadable" }
  /** `signsIn` is the FSM ID of the technician who signs in on the number. */
  | { readonly kind: "shared"; readonly signsIn: string };

/** An active technician, as the sign-in sees him. */
export interface RosterEntry {
  readonly id: string;
  readonly fsmId: string;
  readonly mobileE164: string | null;
}

/**
 * What keeps each technician out of new bookings, by his ID; one left out of the answer is bookable. The roster comes
 * in the order the sign-in prefers technicians (findFieldTechnician), so of two on one number the first signs in.
 */
export function numberProblems(roster: readonly RosterEntry[]): Map<string, NumberProblem> {
  const problems = new Map<string, NumberProblem>();
  const signsInOn = new Map<string, string>();
  for (const technician of roster) {
    if (technician.mobileE164 === null) {
      problems.set(technician.id, { kind: "unreadable" });
      continue;
    }
    const holder = signsInOn.get(technician.mobileE164);
    if (holder !== undefined) {
      problems.set(technician.id, { kind: "shared", signsIn: holder });
      continue;
    }
    signsInOn.set(technician.mobileE164, technician.fsmId);
  }
  return problems;
}
