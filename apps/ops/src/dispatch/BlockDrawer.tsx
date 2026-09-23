// Board A3: the drawer one block on the board opens, narrowed to what a block
// carries. `GET /api/dispatch` answers with the visit, its window, its size in
// slots, its state and the sector; it names no client record, so the board's
// tier, access note, payment, visit count and its two buttons are not here
// (docs/fidelity-method.md).
//
// The drawer is also the keyboard way into a move: the design moves a block by
// dragging it, and everything the drag does can be done from here.

import { shortDate } from "@maneman/web-kit/dates";
import { useEffect, useRef } from "react";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import { nameOf, type BlockJob } from "./job.ts";

interface Props {
  readonly job: BlockJob;
  readonly onMove: () => void;
  readonly onClose: () => void;
}

export function BlockDrawer({ job, onMove, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const copy = dispatch.drawer;
  const { block } = job;

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const typeName = block.type === null ? dispatch.unknown : (dispatch.typeNames[block.type] ?? dispatch.unknown);
  const rows = [
    { key: copy.rows.type, value: copy.type(typeName, block.slots) },
    { key: copy.rows.area, value: block.sector ?? dispatch.unknown },
    { key: copy.rows.state, value: copy.states[block.status] ?? block.status },
  ];

  return (
    <div
      className={styles.panel}
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      tabIndex={-1}
    >
      <div className={styles.drawerHead}>
        <h2 className={styles.drawerTitle} id="drawer-title">
          {nameOf(job)}
        </h2>
        <p className={styles.drawerWhen}>
          {copy.when(shortDate(job.date), dispatch.windowHours[block.window] ?? dispatch.unknown, job.technician.name)}
        </p>
      </div>
      <div className={styles.drawerBody}>
        <dl className={styles.rows}>
          {rows.map((row) => (
            <div className={styles.row} key={row.key}>
              <dt>{row.key}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className={styles.drawerActions}>
          <button className={styles.quiet} type="button" onClick={onMove}>
            {copy.move}
          </button>
          <button className={styles.quiet} type="button" onClick={onClose}>
            {copy.close}
          </button>
        </div>
      </div>
    </div>
  );
}
