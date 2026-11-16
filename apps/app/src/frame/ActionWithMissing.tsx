// A form's one action with what it waits for beneath it (@maneman/ui/Missing; docs/prompts/client-redesign.md, "Copy"):
// disabled while something is missing, which its line says, or while it is busy or otherwise held.

import { Button, type ButtonSize, type ButtonVariant } from "@maneman/ui/Button";
import { describedBy, Missing } from "@maneman/ui/Missing";
import type { ReactNode } from "react";

export function ActionWithMissing(props: {
  /** The line's id, which the page or sheet holds once. */
  readonly id: string;
  /** What is missing, or null once nothing is. */
  readonly missing: string | null;
  readonly children: ReactNode;
  readonly busy?: boolean;
  /** Held for another reason than something missing: the hold run out, or offline. */
  readonly held?: boolean;
  readonly type?: "submit" | "button";
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly className?: string | undefined;
  readonly onClick?: () => void;
}) {
  const waiting = props.missing !== null;
  return (
    <>
      <Button
        variant={props.variant ?? "primary"}
        size={props.size ?? "action"}
        className={props.className}
        type={props.type ?? "button"}
        disabled={waiting || props.busy === true || props.held === true}
        aria-describedby={describedBy(props.id, waiting)}
        busy={props.busy}
        onClick={props.onClick}
      >
        {props.children}
      </Button>
      <Missing id={props.id} what={props.missing} />
    </>
  );
}
