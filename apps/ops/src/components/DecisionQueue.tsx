// A queue of things waiting on ops' decision, as the Referrals design draws its review queue (docs/fidelity-method.md):
// a panel saying how many wait, a row each with its decision. A decided row leaves at once and the keyboard goes to the
// heading; a row the address names, as a task links to it, is scrolled to, focused and marked.

import { EmptyState } from "@maneman/ui/EmptyState";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { useRef, useState, type ReactNode } from "react";
import { firstShown } from "../content.ts";
import { rowId, useTargetRow } from "../lib/target.ts";
import styles from "./queue.module.css";

export function DecisionQueue<T extends { readonly id: string }>({
  titleId,
  title,
  items,
  rowKind,
  empty,
  note,
  more = false,
  done = null,
  children,
}: {
  readonly titleId: string;
  readonly title: string;
  readonly items: readonly T[];
  /** The kind in each row's id, which a task's link names: "grievance" makes a row "grievance-…". */
  readonly rowKind: string;
  /** Said when nothing waits. */
  readonly empty: string;
  readonly note?: ReactNode;
  /** Whether more wait than the list holds: said beneath the rows. */
  readonly more?: boolean;
  /** What the last decision did, said above the rows once it is made. */
  readonly done?: string | null;
  /** A row's content and its decision; `decided` takes the row out of the queue. */
  readonly children: (item: T, decided: () => void) => ReactNode;
}) {
  const [decided, setDecided] = useState<readonly string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const target = useTargetRow(true);
  const waiting = items.filter((item) => !decided.includes(item.id));

  const rows = (
    <ul className={styles.rows}>
      {waiting.map((item) => {
        const id = rowId(rowKind, item.id);
        const leave = () => {
          setDecided((already) => [...already, item.id]);
          heading.current?.focus();
        };
        return (
          <li key={item.id} id={id} tabIndex={-1} className={target === id ? styles.targeted : styles.row}>
            {children(item, leave)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <Panel titleId={titleId} title={title} count={waiting.length} headingRef={heading}>
      {done !== null && (
        <p className={styles.done} role="status">
          {done}
        </p>
      )}
      {waiting.length === 0 ? <EmptyState look="panel" line={empty} /> : rows}
      {more && (
        <InlineMessage tone="note" className={styles.first}>
          {firstShown(items.length)}
        </InlineMessage>
      )}
      {note !== undefined && <p className={styles.note}>{note}</p>}
    </Panel>
  );
}
