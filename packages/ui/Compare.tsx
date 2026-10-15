// A before and an after, one over the other, with a divider between them that a finger, a pointer or the arrow keys
// move: the site's teaser and the client app's compare alike. A native range laid unseen over the stage does the
// work, so a drag anywhere moves it and a screen reader hears a slider. The caller draws the two layers and clips the
// before one with COMPARE_BEFORE; the divider's place reaches CSS as --at through the CSSOM, which the policy allows
// where it refuses a style attribute.

import { ICONS } from "@maneman/brand/icons";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { classes } from "./classes.ts";
import { RangeInput } from "./Field.tsx";
import { Icon } from "./Icon.tsx";
import styles from "./compare.module.css";

/** The class a caller gives its before layer, which shows it only to the divider's left. */
export const COMPARE_BEFORE = styles.before;

export function Compare(props: {
  /** The two layers, and anything the surface lays over them: the labels in the corners, a tag. */
  readonly children: ReactNode;
  /** The slider's name: "Compare before and after". */
  readonly label: string;
  /** What a screen reader hears at a place: "46% before, 54% after". */
  readonly valueText: (at: number) => string;
  /** Where the divider starts, in per cent; the stylesheet draws the same place before the page runs. */
  readonly start?: number;
  /** The stage's size and place on its screen. */
  readonly className?: string | undefined;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(props.start ?? 50);

  useLayoutEffect(() => {
    stage.current?.style.setProperty("--at", `${String(at)}%`);
  }, [at]);

  return (
    <div ref={stage} className={classes(styles.stage, props.className)}>
      {props.children}
      <div className={styles.divider} />
      <div className={styles.handle}>
        <Icon d={ICONS.handleLeft} size="xs" />
        <Icon d={ICONS.handleRight} size="xs" />
      </div>
      <RangeInput
        over
        min={0}
        max={100}
        value={at}
        aria-label={props.label}
        aria-valuetext={props.valueText(at)}
        onInput={(event) => {
          setAt(Number(event.currentTarget.value));
        }}
        onChange={(event) => {
          setAt(Number(event.currentTarget.value));
        }}
      />
    </div>
  );
}
