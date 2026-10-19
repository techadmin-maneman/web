// The before/after teaser: the shared compare (@maneman/ui/Compare), the two images from the Astro page, each with its
// label in its corner, inside its own layer, so the divider wipes a label away with its picture and the label fades as
// the picture narrows. The stylesheet draws the divider at 46% before the page runs, so the first paint matches.

import { capsLook } from "@maneman/ui/Caps";
import { classes } from "@maneman/ui/classes";
import { Compare, COMPARE_BEFORE } from "@maneman/ui/Compare";
import type { ComponentChildren } from "preact";
import { fill } from "../lib/text.ts";
import styles from "./BeforeAfter.module.css";

interface Props {
  /** The two images, named slots from the Astro page. */
  before?: ComponentChildren;
  after?: ComponentChildren;
  /** Where the handle starts, as the stylesheet draws it before the page runs. */
  start: 46;
  beforeLabel: string;
  afterLabel: string;
  sliderLabel: string;
  /** What a screen reader hears as the handle moves: "{before}% before, {after}% after". */
  sliderValue: string;
  /** The design's "Placeholder" tag, when this pair is placeholder material. */
  tag?: string | undefined;
  /** A frame of its own size, where the pair is not the teaser's band. */
  className?: string | undefined;
  /** Whether the divider leans once when first in sight; the shared compare's own default is yes. */
  lean?: boolean | undefined;
}

export default function BeforeAfter(props: Props) {
  return (
    <Compare
      className={classes(styles.teaser, props.className)}
      start={props.start}
      lean={props.lean ?? true}
      label={props.sliderLabel}
      valueText={(at) => fill(props.sliderValue, { before: String(at), after: String(100 - at) })}
    >
      <div class={styles.layer}>
        {props.after}
        <span class={capsLook(`label ${styles.corner} ${styles.right}`)}>{props.afterLabel}</span>
      </div>
      <div class={classes(styles.layer, COMPARE_BEFORE)}>
        {props.before}
        <span class={capsLook(`label ${styles.corner} ${styles.left}`)}>{props.beforeLabel}</span>
      </div>
      {props.tag !== undefined && <span class={capsLook(`label ${styles.tag}`)}>{props.tag}</span>}
    </Compare>
  );
}
