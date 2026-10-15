// A button that opens a small panel beside it (WAI-ARIA's disclosure pattern): the account's menu, a row's further
// actions. Escape, a press outside it, or choosing inside it closes it, and the keyboard goes back to the button.
//
//   <Popover label={copy.account} button={initials}>
//     {(close) => <PopoverItem onClick={() => { close(); signOut(); }}>{copy.signOut}</PopoverItem>}
//   </Popover>

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./popover.module.css";

export function Popover({
  label,
  button,
  align = "end",
  className,
  children,
}: {
  /** The button's name, read out: "Account", "More for Rohit Malhotra". */
  readonly label: string;
  /** What the button shows: initials, an icon. */
  readonly button: ReactNode;
  /** Which edge of the button the panel lines up with. */
  readonly align?: "start" | "end";
  readonly className?: string | undefined;
  readonly children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className={classes(styles.root, className)} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((now) => !now);
        }}
      >
        {button}
      </button>
      <div id={id} className={classes(styles.panel, styles[align])} hidden={!open}>
        {open && children(close)}
      </div>
    </div>
  );
}

/** A line of words in the panel that does nothing: who is signed in. */
export function PopoverNote({ children }: { readonly children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

/** A few controls in the panel under their name, as the theme's three are. */
export function PopoverGroup({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const id = useId();
  return (
    <div className={styles.group} role="group" aria-labelledby={id}>
      <span className={styles.groupLabel} id={id}>
        {label}
      </span>
      <div className={styles.groupControls}>{children}</div>
    </div>
  );
}

/** One action in the panel, a row of its width. */
export function PopoverItem({
  onClick,
  tone = "plain",
  children,
}: {
  readonly onClick: () => void;
  readonly tone?: "plain" | "danger";
  readonly children: ReactNode;
}) {
  return (
    <button type="button" className={classes(styles.item, tone === "danger" && styles.danger)} onClick={onClick}>
      {children}
    </button>
  );
}

/** A way out of the console from the panel, as Access's sign-out is: a full page load, not a move within it. */
export function PopoverLink({
  href,
  onClick,
  children,
}: {
  readonly href: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}) {
  return (
    <a className={styles.item} href={href} onClick={onClick}>
      {children}
    </a>
  );
}
