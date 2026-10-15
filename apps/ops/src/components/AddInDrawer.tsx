// A way to add to a list: its button, in the head of the list's panel, opens the form in a drawer beside the page,
// and the drawer closes once the form is done or put aside. The form is never left open under the list.
//
//   <Panel title={copy.title} actions={<AddInDrawer label={copy.add}>{(close) => <XForm onSaved={close} />}</AddInDrawer>}>

import { Button } from "@maneman/ui/Button";
import { Drawer } from "@maneman/ui/Drawer";
import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { InDrawer } from "./FormDrawer.tsx";

export function AddInDrawer({
  label,
  title = label,
  primary = false,
  children,
}: {
  /** The button's words: "Add a supplier". */
  readonly label: string;
  /** Filled, as the page's one main action is. */
  readonly primary?: boolean;
  /** The drawer's title, the button's words unless it says otherwise. */
  readonly title?: string;
  readonly children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus());
  };
  return (
    <>
      <Button
        variant={primary ? "primary" : "outline"}
        size="small"
        ref={button}
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </Button>
      {open &&
        createPortal(
          <Drawer titleId={id} title={title} canClose onDismiss={close}>
            <InDrawer value>{children(close)}</InDrawer>
          </Drawer>,
          document.body,
        )}
    </>
  );
}
