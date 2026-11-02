// A table row's first cell, which names the row: a screen reader says it before each of the row's other cells. A
// line beneath the name, as a client's mobile, where it has one.

import type { ReactNode } from "react";
import form from "./forms.module.css";

export function RowHead({ meta, children }: { readonly meta?: ReactNode; readonly children: ReactNode }) {
  return (
    <th scope="row" className={form.rowHead}>
      {children}
      {meta !== undefined && <span className={form.rowHeadMeta}>{meta}</span>}
    </th>
  );
}
