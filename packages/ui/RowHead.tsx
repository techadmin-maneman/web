// A table row's first cell, which names the row: a screen reader says it before each of the row's other cells. A
// line beneath the name, as a client's mobile, where it has one, and a mark before both, as their initials.

import type { ReactNode } from "react";
import form from "./forms.module.css";

export function RowHead({
  meta,
  mark,
  children,
}: {
  readonly meta?: ReactNode;
  readonly mark?: ReactNode;
  readonly children: ReactNode;
}) {
  const named = (
    <>
      {children}
      {meta !== undefined && <span className={form.rowHeadMeta}>{meta}</span>}
    </>
  );
  return (
    <th scope="row" className={form.rowHead}>
      {mark === undefined ? (
        named
      ) : (
        <span className={form.rowHeadMarked}>
          {mark}
          <span>{named}</span>
        </span>
      )}
    </th>
  );
}
