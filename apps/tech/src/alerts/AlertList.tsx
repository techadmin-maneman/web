// The Alerts screen's two parts (docs/prompts/tech-redesign.md, "Alerts"): the inbox, newest first, each alert a row
// that opens its job; and Send me, a switch for each kind of alert, all on until the technician turns one off.

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { SectionHead } from "@maneman/ui/SectionHead";
import { Switch } from "@maneman/ui/Switch";
import { alerts as copy } from "../content.ts";
import type { AlertLine } from "./lines.ts";
import styles from "./alerts.module.css";

export type AlertKind = keyof typeof copy.kinds;
const ALERT_KINDS = Object.keys(copy.kinds) as readonly AlertKind[];

export function AlertList({ lines }: { readonly lines: readonly AlertLine[] }) {
  if (lines.length === 0) return <p className={styles.none}>{copy.none}</p>;
  return (
    <ListRows className={styles.rows} label={copy.title}>
      {lines.map((line) => (
        <ListRow
          key={line.id}
          lead={line.when}
          title={line.title}
          meta={line.body}
          to={line.to ?? undefined}
          end={line.to === null ? undefined : <Icon d={GLYPHS.chevron} size="sm" />}
        />
      ))}
    </ListRows>
  );
}

/** A kind's line beneath its name: the minutes and the hour ops set, where it takes them. */
function subOf(kind: AlertKind, notice: { readonly leaveMinutes: number; readonly dayAheadHour: number }): string {
  if (kind === "time_to_leave") return copy.leaveSub(notice.leaveMinutes);
  if (kind === "day_ahead") return copy.dayAheadSub(notice.dayAheadHour);
  return copy.kinds[kind].sub;
}

export function SendMe(props: {
  readonly on: Readonly<Record<AlertKind, boolean>>;
  readonly notice: { readonly leaveMinutes: number; readonly dayAheadHour: number };
  readonly onToggle: (kind: AlertKind) => void;
  /** A switch whose change did not reach us, said under the list. */
  readonly failed: boolean;
}) {
  return (
    <>
      <SectionHead title={copy.sendMe} className={styles.section} />
      <ListRows className={styles.rows} label={copy.sendMe}>
        {ALERT_KINDS.map((kind) => (
          <ListRow
            key={kind}
            title={<span id={`alert-kind-${kind}`}>{copy.kinds[kind].label}</span>}
            meta={subOf(kind, props.notice)}
            end={
              <Switch
                checked={props.on[kind]}
                labelledBy={`alert-kind-${kind}`}
                onToggle={() => {
                  props.onToggle(kind);
                }}
              />
            }
          />
        ))}
      </ListRows>
      {props.failed && (
        <p className={styles.failed} role="alert">
          {copy.settingFailed}
        </p>
      )}
    </>
  );
}
