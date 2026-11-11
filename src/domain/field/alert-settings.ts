// The kinds of alert a technician has on (docs/decisions/0250-guides-and-alerts.md): every kind, but those they turned
// off in Alerts. The cron asks before it writes one (./alert-sends.ts), and the triggers ask for a job's changes.

import type { AlertSetting } from "../../policy/tech-alerts.ts";

/** Which kinds the technician has on: all, but those turned off. */
export async function alertSettingsOf(db: D1Database, technicianId: string): Promise<Record<AlertSetting, boolean>> {
  const { results } = await db
    .prepare("SELECT kind FROM tech_alert_kinds_off WHERE technician_id = ?1")
    .bind(technicianId)
    .all<{ kind: AlertSetting }>();
  const off = new Set(results.map((row) => row.kind));
  return {
    time_to_leave: !off.has("time_to_leave"),
    day_ahead: !off.has("day_ahead"),
    job_changes: !off.has("job_changes"),
    running_over: !off.has("running_over"),
  };
}

export async function setAlertSetting(
  db: D1Database,
  technicianId: string,
  { kind, on, now }: { readonly kind: AlertSetting; readonly on: boolean; readonly now: Date },
): Promise<void> {
  const statement = on
    ? db.prepare("DELETE FROM tech_alert_kinds_off WHERE technician_id = ?1 AND kind = ?2").bind(technicianId, kind)
    : db
        .prepare("INSERT OR IGNORE INTO tech_alert_kinds_off (technician_id, kind, set_at) VALUES (?1, ?2, ?3)")
        .bind(technicianId, kind, now.toISOString());
  await statement.run();
}
