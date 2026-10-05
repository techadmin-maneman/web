// A queue of things waiting on ops' decision, as board C1 draws its review
// queue and every queue after it is built (docs/fidelity-method.md): the
// panel headed by its title and how many wait, a row for each with the
// decision on that row, and a note beneath.
//
// A decided row leaves the queue at once; the count follows it, and so does
// the keyboard, to the heading, rather than to the top of the page, where a
// queue may say what the decision did. A row the
// address names -- a task on the Tasks board links to it -- is scrolled to,
// focused and marked, as the board marks a selection.

import { Panel } from "@maneman/ui/Panel";
import { useRef, useState, type ReactNode } from "react";
import { rowId, useTargetRow } from "../lib/target.ts";
import styles from "./queue.module.css";

export function DecisionQueue<T extends { readonly id: string }>({
  titleId,
  title,
  items,
  rowKind,
  empty,
  note,
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
      {waiting.length === 0 ? <p className={styles.empty}>{empty}</p> : rows}
      {note !== undefined && <p className={styles.note}>{note}</p>}
    </Panel>
  );
}
