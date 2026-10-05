// A client's try-on, kept (docs/decisions/0084-a-clients-try-on-is-kept.md): the before photograph always, and the look
// until the first fit is photographed (ADR 0025, item 65), and which of a person's try-ons is kept. The small copy of
// the photograph comes up with the photograph (src/routes/public/tryon-upload.ts); the sweeper keeps a try-on, and lets
// its look go once the first fit is photographed (src/domain/kept-try-ons.ts); the app shows it
// (src/domain/client-try-ons.ts).
//
// A client is someone who has booked a visit, of any kind. Their try-on is kept only if its photograph was agreed to
// under a notice that says so, and only if its look is still held when they are a client: before then the try-on
// keeps the published notices' rules. A client keeps one try-on, the oldest, so what R2 holds for good grows with the
// clients and not with the try-ons each makes (scripts/lib/free-tier-budget.ts).

/** Where a kept try-on lives, as the prompt gives the bucket for clients' photographs: what is kept stays until deleted. */
// Its rules, as the brief states them:
// - Stored in a new bucket per environment, mm-{env}-client-photos, with no lifecycle rule.

/** The photo notices that tell the visitor a client's try-on is kept. */
export const KEEPING_NOTICES: readonly string[] = ["photo-v2", "photo-v3", "photo-v4"];

export interface HeldTryOn {
  readonly id: string;
  readonly createdAt: string;
  readonly photoConsentVersion: string;
  /** When it was kept; null until the sweeper keeps it. */
  readonly keptAt: string | null;
  /** Until when its look is held by the retention rule; null when it has none. */
  readonly lookHeldUntil: string | null;
}

/**
 * The person's try-on that is kept, as of `at`: the one already kept, or once they have booked, the oldest whose
 * look is still held and whose photograph was agreed to under a keeping notice. Null for none.
 */
export function keptTryOn(tryOns: readonly HeldTryOn[], booked: boolean, at: string): string | null {
  const kept = tryOns.find((tryOn) => tryOn.keptAt !== null);
  if (kept !== undefined) return kept.id;
  if (!booked) return null;

  const keepable = tryOns
    .filter((tryOn) => KEEPING_NOTICES.includes(tryOn.photoConsentVersion))
    .filter((tryOn) => tryOn.lookHeldUntil !== null && tryOn.lookHeldUntil >= at)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return keepable[0]?.id ?? null;
}
