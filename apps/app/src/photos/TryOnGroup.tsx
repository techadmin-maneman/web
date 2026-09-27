// A try-on the client made on the site: the photograph they uploaded beside
// the look made from it (ADR 0082). No board draws it, so it takes board D1's
// group, the date over the images, with two where a visit has five, and says
// beneath how long each is kept. An image already deleted stays a blank block,
// as an angle not taken does.

import { fullDate, indiaClock, longDate } from "@maneman/web-kit/dates";
import type { TryOn } from "../api.ts";
import { photos } from "../content.ts";
import { Thumb, type OpenPhoto } from "./PhotoRow.tsx";
import styles from "./photos.module.css";

const IMAGES = ["photo", "look"] as const;

/** How long each image still held is kept: the photograph for the hour, so its time; the look for days. */
function keptLine({ photo, look }: TryOn): string {
  const { tryOn } = photos;
  if (photo !== null && look !== null) return tryOn.keptBoth(indiaClock(photo.kept_until), longDate(look.kept_until));
  if (look !== null) return tryOn.keptLook(longDate(look.kept_until));
  if (photo !== null) return tryOn.keptPhoto(indiaClock(photo.kept_until));
  return "";
}

export function TryOnGroup({ tryOn, onOpen }: { tryOn: TryOn; onOpen: (photo: OpenPhoto) => void }) {
  const date = fullDate(tryOn.made_on);
  const heading = `try-on-${tryOn.id}`;
  return (
    <section aria-labelledby={heading}>
      <div className={styles.group}>
        <h2 className={styles.groupDate} id={heading}>
          {date}
        </h2>
        <p className={styles.groupWhat}>{photos.tryOn.title}</p>
      </div>
      <div className={`${styles.row} ${styles.pair}`}>
        {IMAGES.map((image) => {
          const link = tryOn[image];
          if (link === null) return <div key={image} className={styles.cell} />;
          const name = photos.tryOn.images[image];
          const opened: OpenPhoto = {
            link,
            alt: photos.tryOn.alt(name, date),
            title: photos.photoOf(name, date),
            // The file's own type gives the extension (src/routes/client-visits.ts).
            fileName: `mane-man-${tryOn.made_on}-try-on-${image}`,
          };
          return (
            <button
              key={image}
              className={styles.cell}
              type="button"
              aria-label={opened.alt}
              onClick={() => {
                onOpen(opened);
              }}
            >
              <Thumb link={link} alt="" />
            </button>
          );
        })}
      </div>
      <p className={styles.kept}>{keptLine(tryOn)}</p>
    </section>
  );
}
