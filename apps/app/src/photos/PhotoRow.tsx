// A visit's photographs, five angles in a row at the same crop and without
// captions (boards C9 and D1). Each fades in as it arrives, over the loading
// block, with no spinner (board D3); an angle not taken stays a blank block.
//
// A thumbnail is the whole photograph, about 65 px wide on the screen: there is
// no smaller copy to ask for. So each is fetched only as it nears the screen,
// and says its size, so the page does not move as it arrives.

import { fullDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import type { Angle, PhotoLink, PhotoSet } from "../api.ts";
import { photos } from "../content.ts";
import styles from "./photos.module.css";

export const ANGLES: readonly Angle[] = ["front", "top", "left", "right", "hair"];

/** A photograph opened from a row, for the sheet. */
export interface OpenPhoto {
  readonly link: PhotoLink;
  readonly phase: "before" | "after";
  /** The visit's date, YYYY-MM-DD. */
  readonly date: string;
}

/** The set a row shows: after the visit, or before it when no after was taken. */
export const shownPhase = (set: PhotoSet) => (set.after.length > 0 ? "after" : "before");

/** `eager` for the one photograph opened large, which is wanted now; a row's wait until they near the screen. */
export function Thumb(props: { link: PhotoLink; alt: string; className?: string; eager?: boolean }) {
  const { link, alt, className } = props;
  const [arrived, setArrived] = useState(false);
  return (
    <img
      className={`${styles.thumb} ${arrived ? styles.arrived : ""} ${className ?? ""}`}
      src={link.url}
      alt={alt}
      width={link.width ?? undefined}
      height={link.height ?? undefined}
      loading={props.eager === true ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => {
        setArrived(true);
      }}
    />
  );
}

export function PhotoRow({ set, date, onOpen }: { set: PhotoSet; date: string; onOpen: (photo: OpenPhoto) => void }) {
  const phase = shownPhase(set);
  return (
    <div className={styles.row}>
      {ANGLES.map((angle) => {
        const link = set[phase].find((each) => each.angle === angle);
        if (link === undefined) return <div key={angle} className={styles.cell} />;
        return (
          <button
            key={angle}
            className={styles.cell}
            type="button"
            aria-label={photos.alt(photos.angles[angle], phase, fullDate(date))}
            onClick={() => {
              onOpen({ link, phase, date });
            }}
          >
            <Thumb link={link} alt="" />
          </button>
        );
      })}
    </div>
  );
}
