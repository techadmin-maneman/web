// The Alerts screen's two parts (docs/prompts/tech-redesign.md, "Alerts"): the inbox, newest first, each alert a row
// that opens its job; and Send me, a switch for each kind of alert, all on until the technician turns one off.

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { SectionHead } from "@maneman/ui/SectionHead";
import { Switch } from "@maneman/ui/Switch";
import { alerts as copy } from "../content.ts";
import styles from "./alerts.module.css";

/** One alert in the inbox, as its row says it. */
export interface AlertLine {
  readonly id: string;
  /** "9:02 am", "Yesterday, 8 pm" */
  readonly when: string;
  readonly title: string;
  readonly body: string;
  /** The page it opens: its job, its day, or nowhere when the job is no longer the technician's. */
  readonly to: string | null;
}

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

export function SendMe(props: {
  readonly on: Readonly<Record<AlertKind, boolean>>;
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
            meta={copy.kinds[kind].sub}
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
