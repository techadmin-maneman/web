// The one panel that marks a pincode live, from either tab of Areas (board C3): who it messages, what they get, and
// the press that sends it. Nothing is sent before that press
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Button } from "@maneman/ui/Button";
import { useEffect, useRef, type ReactNode } from "react";
import { areas, BOOKING_URL } from "../content.ts";
import styles from "./areas.module.css";

const copy = areas.launch;
const bookingUrl = BOOKING_URL[import.meta.env.MM_ENV] ?? BOOKING_URL.production ?? "";

interface Props {
  /** The panel's head, which names it. */
  readonly label: string;
  /** How many people it messages. */
  readonly alerts: number;
  /** The area the message names; null for a message about several pincodes, each named its own. */
  readonly area: string | null;
  /** One line a pincode, where it marks several live. */
  readonly lines?: readonly string[];
  /** What the press says; null where there is nobody to message and nothing to mark live. */
  readonly sendLabel: string | null;
  /** Whether the press may go ahead: a box the panel holds may still be empty. */
  readonly ready?: boolean;
  readonly sending: boolean;
  /** What the press did, once it is done. */
  readonly done: string | null;
  readonly error: string | null;
  readonly note: string;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  /** What stands between the title and the message: a pincode's figures, its launch date. */
  readonly children?: ReactNode;
}

export function LaunchPanel(props: Props) {
  const { label, alerts, area, lines, sendLabel, ready = true, sending, done, error, note, onSend, onCancel } = props;
  const panel = useRef<HTMLElement>(null);
  // It opens beneath a list, so it is brought into view and read from its head (FEO-15).
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <section className={styles.launch} aria-labelledby="launch" ref={panel} tabIndex={-1}>
      <p className={styles.launchLabel} id="launch">
        {label}
      </p>
      <p className={styles.launchTitle}>{copy.title(alerts)}</p>
      {lines !== undefined && (
        <ul className={styles.lines}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {props.children}
      <p className={styles.message}>{copy.message(area ?? copy.eachArea, bookingUrl)}</p>
      {done !== null && (
        <p className={styles.done} role="status">
          {done}
        </p>
      )}
      {done === null && (
        <div className={styles.actions}>
          {sendLabel !== null && (
            <Button variant="primary" size="small" disabled={sending || !ready} onClick={onSend}>
              {sending ? copy.sending : sendLabel}
            </Button>
          )}
          <Button variant="outline" size="small" disabled={sending} onClick={onCancel}>
            {copy.cancel}
          </Button>
        </div>
      )}
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.note}>{note}</p>
    </section>
  );
}
