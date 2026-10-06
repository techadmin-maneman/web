// What the console's settings tests share (ops-settings*, ops-prices and ops-service-area): a setting as the API
// answers it, the headers a post carries, and the audit trail each reads.

import { env } from "cloudflare:workers";

export const POST = { "Content-Type": "application/json", Origin: "https://maneman.test" };

export interface Setting {
  name: string;
  kind: "number" | "choice";
  unit: string;
  min: number;
  max: number;
  keys: string[] | "open" | null;
  value: number | Record<string, number>;
  default: number | Record<string, number>;
  set_by: string | null;
  set_at: string | null;
}

export const auditFor = (action: string) =>
  env.DB.prepare("SELECT actor, actor_kind, subject_id, detail FROM audit_log WHERE action = ?1 ORDER BY id")
    .bind(action)
    .all<{ actor: string; actor_kind: string; subject_id: string; detail: string }>();
