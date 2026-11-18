// A visit's photographs as the client is shown them: each angle in the design's order, with links that last 15 minutes,
// for the signed-in client alone (src/routes/client/photos.ts serves them).

import { MINUTE_MS } from "../../lib/durations.ts";
import { signToken, type SigningSecret } from "../../lib/signed-token.ts";
import { ANGLES, type Angle, type Phase } from "../field/visit-photos.ts";

/** A photograph's link lasts this long; the app asks again for a fresh one. */
export const PHOTO_LINK_MS = 15 * MINUTE_MS;

interface PhotoLink {
  readonly angle: Angle;
  /** A link to the photograph that lasts 15 minutes, for the signed-in client only. */
  readonly url: string;
  /** A link to its small copy for the rows, likewise; null for a photograph with none, which the row shows itself. */
  readonly thumbnail_url: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface PhotoSet {
  readonly before: PhotoLink[];
  readonly after: PhotoLink[];
}

interface PhotoRow {
  id: string;
  appointment_id: string;
  phase: Phase;
  angle: Angle;
  width: number | null;
  height: number | null;
  thumbnail_key: string | null;
}

/** The photographs of these visits, each angle in the design's order, with fresh links. */
export async function photoSets(
  db: D1Database,
  appointmentIds: readonly string[],
  signingKey: SigningSecret,
  now: Date,
): Promise<Map<string, PhotoSet>> {
  const sets = new Map<string, PhotoSet>();
  if (appointmentIds.length === 0) return sets;
  const placeholders = appointmentIds.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT p.id, s.appointment_id, s.phase, p.angle, p.width, p.height, p.thumbnail_key
       FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id WHERE s.appointment_id IN (${placeholders})`,
    )
    .bind(...appointmentIds)
    .all<PhotoRow>();
  const expiresAt = new Date(now.getTime() + PHOTO_LINK_MS);
  for (const row of results.sort((a, b) => ANGLES.indexOf(a.angle) - ANGLES.indexOf(b.angle))) {
    const set = sets.get(row.appointment_id) ?? { before: [], after: [] };
    set[row.phase].push({
      angle: row.angle,
      url: `/api/photos/file/${await signToken(signingKey, "photo", row.id, expiresAt)}`,
      thumbnail_url:
        row.thumbnail_key === null
          ? null
          : `/api/photos/small/${await signToken(signingKey, "photo_small", row.id, expiresAt)}`,
      width: row.width,
      height: row.height,
    });
    sets.set(row.appointment_id, set);
  }
  return sets;
}
