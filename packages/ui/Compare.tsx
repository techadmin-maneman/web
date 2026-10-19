// A before and an after, one over the other, with a divider between them that a finger, a pointer or the arrow keys
// move: the site's teaser and the client app's compare alike. A native range laid unseen over the stage does the
// work, so a tap or a drag anywhere moves it and a screen reader hears a slider. The caller draws the two layers,
// clips the before one with COMPARE_BEFORE, and puts each layer's own label inside it, so the divider wipes a label
// away with its picture. The divider's place reaches CSS as --at, and as the bare number --at-n for a label to fade
// by, through the CSSOM, which the policy allows where it refuses a style attribute. The first time the stage is
// mostly in sight the divider leans a little and comes back, so it reads as something to move.

import { ICONS } from "@maneman/brand/icons";
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { classes } from "./classes.ts";
import { RangeInput } from "./Field.tsx";
import { Icon } from "./Icon.tsx";
import styles from "./compare.module.css";

/** The class a caller gives its before layer, which shows it only to the divider's left. */
export const COMPARE_BEFORE = styles.before;

/** How far the first lean goes, in per cent, and how long the lean and the return take together. */
const LEAN = 8;
const LEAN_MS = 1100;

function place(stage: HTMLElement, at: number): void {
  stage.style.setProperty("--at", `${String(at)}%`);
  stage.style.setProperty("--at-n", String(at));
}

/** The lean, once, when the stage first comes into sight, unless motion is asked to stay still or it was moved. */
function useLean(
  stage: RefObject<HTMLDivElement | null>,
  start: number,
  moved: RefObject<boolean>,
  wanted: boolean,
): void {
  useEffect(() => {
    const element = stage.current;
    if (!wanted || element === null || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const lean = () => {
      const began = performance.now();
      const step = (now: number) => {
        if (moved.current) return;
        const done = Math.min(1, (now - began) / LEAN_MS);
        place(element, start + LEAN * Math.sin(Math.PI * done));
        if (done < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    const seen = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        seen.disconnect();
        lean();
      },
      { threshold: 0.6 },
    );
    seen.observe(element);
    return () => {
      seen.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [stage, start, moved, wanted]);
}

export function Compare(props: {
  /** The two layers, each with its own label, and anything the surface lays over them: a tag. */
  readonly children: ReactNode;
  /** The slider's name: "Compare before and after". */
  readonly label: string;
  /** What a screen reader hears at a place: "46% before, 54% after". */
  readonly valueText: (at: number) => string;
  /** Where the divider starts, in per cent; the stylesheet draws the same place before the page runs. */
  readonly start?: number;
  /** The stage's size and place on its screen. */
  readonly className?: string | undefined;
  /** Whether the divider leans once when the stage first comes into sight. */
  readonly lean?: boolean | undefined;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const start = props.start ?? 50;
  const [at, setAt] = useState(start);

  useLayoutEffect(() => {
    if (stage.current !== null) place(stage.current, at);
  }, [at]);
  useLean(stage, start, moved, props.lean ?? true);

  const move = (value: number) => {
    moved.current = true;
    setAt(value);
  };

  return (
    <div ref={stage} className={classes(styles.stage, props.className)}>
      {props.children}
      <div className={styles.divider} />
      <div className={styles.handle}>
        <Icon d={ICONS.handleLeft} size="sm" />
        <Icon d={ICONS.handleRight} size="sm" />
      </div>
      <RangeInput
        over
        min={0}
        max={100}
        value={at}
        aria-label={props.label}
        aria-valuetext={props.valueText(at)}
        onInput={(event) => {
          move(Number(event.currentTarget.value));
        }}
        onChange={(event) => {
          move(Number(event.currentTarget.value));
        }}
      />
    </div>
  );
}
