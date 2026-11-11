// A button that acts only once held (docs/prompts/tech-redesign.md, "Safety"): pressed and held for --duration-hold,
// with a fill crossing it as it is held, and nothing done when let go sooner. A finger, a mouse or Space and Enter hold
// it alike. The SOS is the one now; its words, and the line saying how to hold it, are the screen's.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { classes } from "./classes.ts";
import { cssToken } from "./cssToken.ts";
import styles from "./hold-button.module.css";

/**
 * How long it is held before it acts, as tokens.css has it, in milliseconds whether the built stylesheet says "3000ms"
 * or "3s"; three seconds where the page has no stylesheet.
 */
export function holdMs(token: string = cssToken("--duration-hold")): number {
  const held = parseFloat(token);
  if (!Number.isFinite(held) || held <= 0) return 3000;
  return token.trim().endsWith("ms") ? held : held * 1000;
}

export function HoldButton({
  children,
  sub,
  holdingSub,
  describedBy,
  className,
  onHeld,
}: {
  readonly children: ReactNode;
  /** A quieter line beneath its words: what holding it does. */
  readonly sub?: ReactNode;
  /** The line beneath while it is held, which says so where the fill is not drawn, as under reduced motion. */
  readonly holdingSub?: ReactNode;
  /** The id of the line saying how to hold it. */
  readonly describedBy?: string | undefined;
  readonly className?: string | undefined;
  readonly onHeld: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const letGo = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const hold = () => {
    if (timer.current !== null) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onHeld();
    }, holdMs());
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const line = holding ? (holdingSub ?? sub) : sub;
  return (
    <button
      type="button"
      className={classes(styles.hold, className)}
      data-holding={holding ? "" : undefined}
      aria-describedby={describedBy}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        hold();
      }}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      onLostPointerCapture={letGo}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          hold();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") letGo();
      }}
      onBlur={letGo}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      <span className={styles.fill} aria-hidden="true" />
      <span className={styles.words}>
        <span>{children}</span>
        {line !== undefined && <span className={styles.sub}>{line}</span>}
      </span>
    </button>
  );
}
