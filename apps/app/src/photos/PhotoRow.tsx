// A visit's photographs, five angles in a row at the same crop and without
// captions. Each fades in as it arrives, over the loading
// block, with no spinner; an angle not taken stays a blank block.
//
// A row shows each photograph's small copy, which the technician's phone made
// at capture, and the whole photograph once it is opened. A photograph with no
// small copy shows itself, about 65 px wide
// (docs/decisions/0093-the-storage-meter.md). Each is fetched only as it nears
// the screen, and says its size, so the page does not move as it arrives.

import { classes } from "@maneman/ui/classes";
import { fullDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import type { Angle, PhotoSet } from "../api.ts";
import { photos } from "../content.ts";
import styles from "./photos.module.css";

export const ANGLES: readonly Angle[] = ["front", "top", "left", "right", "hair"];

/** What a thumbnail shows: a visit's photograph, or a try-on's image, whose size is not known. */
export interface ImageLink {
  readonly url: string;
  readonly width?: number | null;
  readonly height?: number | null;
}

/** A photograph opened from a row, as the sheet shows it. */
export interface OpenPhoto {
  readonly link: ImageLink;
  /** What it shows, for a screen reader: "Front, after the visit, 22 Aug 2027". */
  readonly alt: string;
  /** Photos' line above Download: "Front · 22 Aug 2027". */
  readonly title: string;
  /** The name it is saved under. */
  readonly fileName: string;
}

/** The set a row shows: after the visit, or before it when no after was taken. */
export const shownPhase = (set: PhotoSet) => (set.after.length > 0 ? "after" : "before");

/** `eager` for the one photograph opened large, which is wanted now; a row's wait until they near the screen. */
export function Thumb(props: { link: ImageLink; alt: string; className?: string; eager?: boolean }) {
  const { link, alt, className } = props;
  const [arrived, setArrived] = useState(false);
  return (
    <img
      className={classes(styles.thumb, arrived && styles.arrived, className)}
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
        const thumbnail: ImageLink = { ...link, url: link.thumbnail_url ?? link.url };
        const alt = photos.alt(photos.angles[angle], phase, fullDate(date));
        const opened: OpenPhoto = {
          link,
          alt,
          title: photos.photoOf(photos.angles[angle], fullDate(date)),
          fileName: `mane-man-${date}-${phase}-${angle}.jpg`,
        };
        return (
          <button
            key={angle}
            className={styles.cell}
            type="button"
            aria-label={alt}
            onClick={() => {
              onOpen(opened);
            }}
          >
            <Thumb link={thumbnail} alt="" />
          </button>
        );
      })}
    </div>
  );
}
