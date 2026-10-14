// What a form or a row's panel does, side by side beneath it: Save and Cancel, or a decision's buttons.

import type { ReactNode } from "react";
import form from "./forms.module.css";

export function FormActions({ children }: { readonly children: ReactNode }) {
  return <div className={form.actions}>{children}</div>;
}
