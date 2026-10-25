// A button that opens its form in a drawer beside the page, which closes once the form is done or put aside: a list's
// way to add to it, from the head of its panel, or to narrow it. The form is never left open under the list.
//
//   <Panel title={copy.title} actions={<DrawerButton label={copy.add}>{(close) => <XForm onSaved={close} />}</DrawerButton>}>

import { Button } from "@maneman/ui/Button";
import { Drawer } from "@maneman/ui/Drawer";
import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { InDrawer } from "./FormDrawer.tsx";
import { CLOSE } from "../content.ts";

export function DrawerButton({
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
          <Drawer titleId={id} title={title} close={CLOSE} onDismiss={close}>
            <InDrawer value>{children(close)}</InDrawer>
          </Drawer>,
          document.body,
        )}
    </>
  );
}
