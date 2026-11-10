// A list's row on a phone, where the console's table would be too wide: what it is over who or where, on the left,
// and one figure or state on the right, with the rule a table row carries for how pressing it is. A tap opens what the
// table's row opens. Rows are never stacks of a column's name beside its value.
//
//   <ListRows label={copy.tasks}>
//     <ListRow title={task.kind} meta={task.client} end={task.due} endTone="warning" rule="warning" onClick={open} />
//   </ListRows>

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import { Link } from "./router.tsx";
import type { RuleTone } from "./Table.tsx";
import styles from "./list-row.module.css";

/** The figure or state's colour: muted unless it says something is due, late or wrong. */
export type EndTone = "muted" | "plain" | "attention" | "warning" | "error";

const END_TONES: Readonly<Record<EndTone, string | undefined>> = {
  muted: styles.endMuted,
  plain: styles.endPlain,
  attention: styles.endAttention,
  warning: styles.endWarning,
  error: styles.endError,
};

export function ListRows({
  label,
  inPanel = false,
  className,
  children,
}: {
  /** The list's name, read out, where no heading above it names it. */
  readonly label?: string | undefined;
  /** Inside a panel, which draws the box: the list runs to its edges, and to its foot where it ends the panel. */
  readonly inPanel?: boolean;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <ul
      className={classes(styles.list, inPanel && styles.inPanel, className)}
      aria-label={label}
      data-table={inPanel ? "" : undefined}
    >
      {children}
    </ul>
  );
}

export function ListRow({
  lead,
  mark,
  title,
  meta,
  end,
  endTone = "muted",
  rule,
  to,
  onClick,
  label,
  action,
  current = false,
}: {
  /** Before the words, in a column of its own down the list: a time, or what the row is. */
  readonly lead?: ReactNode;
  /** Before the words at its own size, as a person's initials (./Initials.tsx). */
  readonly mark?: ReactNode;
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  /** One figure or state: a time, an amount, a Badge. */
  readonly end?: ReactNode;
  readonly endTone?: EndTone;
  /** Its first edge's rule: how pressing it is, or, `done`, that its thing is done with. */
  readonly rule?: RuleTone | "done" | undefined;
  /** The page the row opens. */
  readonly to?: string | undefined;
  /** What the row opens in place, as a drawer. */
  readonly onClick?: (() => void) | undefined;
  /** Read out in place of its words, where a figure alone would not say what it counts; holds the title. */
  readonly label?: string | undefined;
  /** The row's one action, apart from what pressing the row opens: beside it at a desk, beneath it on a phone. */
  readonly action?: ReactNode;
  /** The row whose thing is open beside the list, as a chat is: raised, ruled in the ink, and said to be current. */
  readonly current?: boolean;
}) {
  const inside = (
    <>
      {lead !== undefined && <span className={styles.lead}>{lead}</span>}
      {mark}
      <span className={styles.words}>
        <span className={styles.title}>{title}</span>
        {meta !== undefined && <span className={styles.meta}>{meta}</span>}
      </span>
      {end !== undefined && <span className={classes(styles.end, END_TONES[endTone])}>{end}</span>}
    </>
  );
  const row = classes(styles.row, current && styles.current, rule !== undefined && styles[rule]);
  return (
    <li className={action === undefined ? undefined : styles.acting}>
      <RowBody row={row} to={to} onClick={onClick} label={label} current={current}>
        {inside}
      </RowBody>
      {action !== undefined && <span className={styles.action}>{action}</span>}
    </li>
  );
}

/** The row itself: the page it opens, the drawer it opens in place, or words alone. */
function RowBody({
  row,
  to,
  onClick,
  label,
  current,
  children,
}: {
  readonly row: string;
  readonly to: string | undefined;
  readonly onClick: (() => void) | undefined;
  readonly label: string | undefined;
  readonly current: boolean;
  readonly children: ReactNode;
}) {
  const now = current ? "true" : undefined;
  if (to !== undefined)
    return (
      <Link className={classes(row, styles.opens)} to={to} label={label}>
        {children}
      </Link>
    );
  if (onClick !== undefined)
    return (
      <button
        type="button"
        className={classes(row, styles.opens)}
        aria-label={label}
        aria-current={now}
        onClick={onClick}
      >
        {children}
      </button>
    );
  return (
    <div className={row} aria-current={now}>
      {children}
    </div>
  );
}

/** One row's words, as `ListRow` takes them, and the key it is drawn by. */
export type ViewRow = Parameters<typeof ListRow>[0] & { readonly key: string };

/**
 * A table's rows as a phone's list, drawn from the same rows the desk's table draws, sorted and narrowed alike: each
 * row's name over a line of what matters, one figure or state at its end, a tap opening what the table's row opens.
 */
export function ViewRows<Row>(props: {
  readonly rows: readonly Row[];
  /** The list's name, read out, where no heading above it names it. */
  readonly label?: string | undefined;
  readonly row: (each: Row) => ViewRow;
}) {
  return (
    <ListRows label={props.label} inPanel>
      {props.rows.map((each) => {
        const { key, ...row } = props.row(each);
        return <ListRow key={key} {...row} />;
      })}
    </ListRows>
  );
}
