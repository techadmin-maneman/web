// The head-shape guide over the camera for the angle to take (./CaptureScreen.tsx), drawn in its own 320 by 420 box:
// the face and its hairline, the crown from above, an ear at the centre, or the hair close.

import type { Angle } from "../api.ts";
import styles from "./capture.module.css";

/** The head from the front. */
const FACE =
  "M160 108 C202 108 226 148 226 204 C226 262 198 302 160 310 C122 302 94 262 94 204 C94 148 118 108 160 108 Z";
/** The head from the side, facing left: the brow and nose on the left, the back of the head round on the right. */
const PROFILE =
  "M170 104 C222 104 246 150 240 210 C236 262 214 300 172 310 C146 312 128 300 122 282 L116 252 L100 236 L114 222 " +
  "L108 176 C112 132 136 104 170 104 Z";

/** What each angle lines up. */
const OUTLINES: Record<Angle, { readonly head: string; readonly line: string }> = {
  front: { head: FACE, line: "M94 196 C118 168 202 168 226 196" },
  top: { head: "M160 112 A100 100 0 1 1 159.9 112 Z", line: "M96 170 C124 138 196 138 224 170" },
  left: { head: PROFILE, line: "M178 196 C192 196 192 230 178 230" },
  right: { head: PROFILE, line: "M178 196 C192 196 192 230 178 230" },
  hair: { head: "M100 150 H220 V270 H100 Z", line: "M100 210 H220" },
};

export function FramingGuide({ angle }: { angle: Angle }) {
  const outline = OUTLINES[angle];
  return (
    <svg className={styles.frame} viewBox="0 0 320 420" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {/* The right side is the left's profile turned to face the other way. */}
      <g transform={angle === "right" ? "matrix(-1 0 0 1 320 0)" : undefined}>
        <path className={styles.head} d={outline.head} strokeDasharray="8 8" />
        <path className={styles.hairline} d={outline.line} />
      </g>
      <path
        className={styles.corners}
        d="M36 44 H78 M36 44 V86 M284 44 H242 M284 44 V86 M36 376 H78 M36 376 V334 M284 376 H242 M284 376 V334"
      />
    </svg>
  );
}
