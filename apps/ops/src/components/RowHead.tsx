// A table row's first cell, which names the row: a screen reader says it before each of the row's other cells.

import type { ReactNode } from "react";
import form from "./forms.module.css";

export function RowHead({ children }: { readonly children: ReactNode }) {
  return (
    <th scope="row" className={form.rowHead}>
      {children}
    </th>
  );
}
