// A piece that comes off a client at a replacement (docs/decisions/0163-pieces-scanned-from-the-kit.md): held in the
// technician's kit as returned until they hand it in, whether or not it carries one of our labels. Its unit, where it
// is one of ours, comes back into the kit with it. Once for each visit and label, however often the step lands.

/** The return of a piece that came off, and its unit's, each written once. */
export function pieceReturnStatements(
  db: D1Database,
  returned: {
    readonly jobId: string;
    readonly technicianId: string;
    readonly label: string;
    readonly reason: string;
    readonly at: string;
  },
): D1PreparedStatement[] {
  const { jobId, technicianId, label, reason, at } = returned;
  return [
    db
      .prepare(
        `INSERT INTO piece_returns (id, piece_code, appointment_id, technician_id, reason, returned_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (appointment_id, piece_code) DO NOTHING`,
      )
      .bind(crypto.randomUUID(), label, jobId, technicianId, reason, at),
    // The unit's history first, while it still reads as fitted.
    db
      .prepare(
        `INSERT INTO stock_unit_events (unit_id, at, state, place, appointment_id, actor)
         SELECT id, ?2, 'returned', ?3, ?4, ?3 FROM stock_units WHERE code = ?1 AND state = 'fitted'`,
      )
      .bind(label, at, technicianId, jobId),
    db
      .prepare(
        `UPDATE stock_units SET state = 'returned', place = ?3, appointment_id = ?4, transfer_id = NULL, moved_at = ?2
         WHERE code = ?1 AND state = 'fitted'`,
      )
      .bind(label, at, technicianId, jobId),
  ];
}
