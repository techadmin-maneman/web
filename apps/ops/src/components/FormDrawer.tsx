// A form in a drawer at the page's right: what a row's action opens, titled for its row, or a list's way to make
// something. It is drawn in the page's body, so a table keeps to its rows and no box stands in one.

import { Drawer } from "@maneman/ui/Drawer";
import { createContext, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CLOSE } from "../content.ts";

/** Whether a form stands in a drawer, whose title names it already: its own name is read, not shown. */
export const InDrawer = createContext(false);

export function FormDrawer({
  title,
  onClose,
  children,
}: {
  /** What it acts on: a row's name, "Rohit Malhotra", or what it makes. */
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const id = useId();
  return createPortal(
    <Drawer titleId={id} title={title} close={CLOSE} onDismiss={onClose}>
      <InDrawer value>{children}</InDrawer>
    </Drawer>,
    document.body,
  );
}
