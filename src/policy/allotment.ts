// Who takes a start, of the technicians who can (docs/decisions/0289-who-takes-a-visit.md): the one it costs least.
// The cost is the driving the visit adds to their day, in minutes, and each of these counted as minutes of driving:
// going past their radius into the overflow ring, a fit whose piece is not in their kit, and a fuller week than the
// least booked of them has. Ops set every figure in Settings.

export const ALLOTMENT_KEYS = ["overflow", "overflow_cost", "stockroom_cost", "no_piece_cost", "share_cost"] as const;
export type Allotment = Readonly<Record<(typeof ALLOTMENT_KEYS)[number], number>>;

/**
 * The ring half as far again as the radius; half an hour for going into it; half an hour for a piece to fetch from
 * the city's stockroom, an hour and a half for one nobody in the city holds; ten minutes for each hour more booked
 * that week than the least booked of them.
 */
export const ALLOTMENT: Allotment = {
  overflow: 150,
  overflow_cost: 30,
  stockroom_cost: 30,
  no_piece_cost: 90,
  share_cost: 10,
};

/** Where a fit's piece is for a technician: in their own kit, in their city's stockroom, or nowhere in it. */
export type Piece = "kit" | "stockroom" | "none";

export interface Taking {
  /** The driving the visit adds to their day, in minutes. */
  readonly addedDrive: number;
  /** Whether the visit is past their radius, in the overflow ring. */
  readonly overflow: boolean;
  /** Where its piece is for them; null for a visit with no piece to match, or a fit whose spec is not known yet. */
  readonly piece: Piece | null;
  /** Minutes booked on their week around the visit's day. */
  readonly weekMinutes: number;
}

function pieceCost(piece: Piece | null, allotment: Allotment): number {
  if (piece === "stockroom") return allotment.stockroom_cost;
  if (piece === "none") return allotment.no_piece_cost;
  return 0;
}

/** What a technician taking a visit costs, in minutes of driving; `leastWeek` is the least booked week among them. */
export function costOf(taking: Taking, leastWeek: number, allotment: Allotment): number {
  const fuller = Math.max(0, taking.weekMinutes - leastWeek) / 60;
  return (
    taking.addedDrive +
    (taking.overflow ? allotment.overflow_cost : 0) +
    pieceCost(taking.piece, allotment) +
    Math.round(fuller * allotment.share_cost)
  );
}
