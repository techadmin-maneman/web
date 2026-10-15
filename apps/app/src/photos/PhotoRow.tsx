// A visit's photographs, five angles in a row at the same crop and without
// captions. Each fades in as it arrives, over the loading
// block, with no spinner; an angle not taken stays a blank block.
//
// A row shows each photograph's small copy, which the technician's phone made
// at capture, and the whole photograph once it is opened. A photograph with no
// small copy shows itself, about 65 px wide
// (docs/decisions/0093-the-storage-meter.md). Each is fetched only as it nears
// the screen, and says its size, so the page does not move as it arrives.

import { Tile } from "@maneman/ui/Tile";
import { classes } from "@maneman/ui/classes";
import { fullDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import type { Angle, PhotoSet } from "../api.ts";
import { photos } from "../content.ts";
import type { Relink } from "./relink.ts";
import shared from "./photos.module.css";
import styles from "./photo-row.module.css";

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
export function Thumb(props: {
  link: ImageLink;
  alt: string;
  className?: string;
  eager?: boolean;
  onFailed?: () => void;
}) {
  const { link, alt, className } = props;
  const [arrived, setArrived] = useState(false);
  return (
    <img
      className={classes(shared.thumb, arrived && styles.arrived, className)}
      src={link.url}
      alt={alt}
      width={link.width ?? undefined}
      height={link.height ?? undefined}
      loading={props.eager === true ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => {
        setArrived(true);
      }}
      onError={props.onFailed}
    />
  );
}

/** One photograph in a row: opened large on a tap, or, once its link will not load, a tap that reads fresh links. */
export function PhotoCell(props: {
  thumbnail: ImageLink;
  opened: OpenPhoto;
  onOpen: (photo: OpenPhoto) => void;
  relink: Relink;
}) {
  const { thumbnail, opened, relink } = props;
  // The link that would not load, as the page read it: links read again are new, and are tried as they come.
  const [lost, setLost] = useState<ImageLink | null>(null);
  const failed = lost === opened.link;
  return (
    <Tile
      className={shared.cell}
      aria-label={failed ? photos.notLoaded(opened.alt) : opened.alt}
      onClick={() => {
        if (failed) relink.reload();
        else props.onOpen(opened);
      }}
    >
      {failed ? (
        <span className={styles.reload}>{photos.reload}</span>
      ) : (
        <Thumb
          link={thumbnail}
          alt=""
          onFailed={() => {
            setLost(opened.link);
            relink.failed();
          }}
        />
      )}
    </Tile>
  );
}

export function PhotoRow(props: { set: PhotoSet; date: string; onOpen: (photo: OpenPhoto) => void; relink: Relink }) {
  const { set, date } = props;
  const phase = shownPhase(set);
  return (
    <div className={shared.row}>
      {ANGLES.map((angle) => {
        const link = set[phase].find((each) => each.angle === angle);
        if (link === undefined) return <div key={angle} className={shared.cell} />;
        const thumbnail: ImageLink = { ...link, url: link.thumbnail_url ?? link.url };
        const alt = photos.alt(photos.angles[angle], phase, fullDate(date));
        const opened: OpenPhoto = {
          link,
          alt,
          title: photos.photoOf(photos.angles[angle], fullDate(date)),
          fileName: `mane-man-${date}-${phase}-${angle}.jpg`,
        };
        return (
          <PhotoCell key={angle} thumbnail={thumbnail} opened={opened} onOpen={props.onOpen} relink={props.relink} />
        );
      })}
    </div>
  );
}
