// A visit's photographs as the prototype draws them on the job's handoff and in the client's history: a row of tiles,
// each its angle's name at its foot, on paper so it reads over any photograph. The photographs are the API's to give,
// never kept on the phone.

import { classes } from "@maneman/ui/classes";
import { capture } from "../content.ts";
import styles from "./photo-tiles.module.css";

/** An angle's name on its tile, "Front"; an angle the app does not know, as the API wrote it. */
const angleName = (angle: string): string =>
  angle in capture.angles ? capture.angles[angle as keyof typeof capture.angles] : angle;

export function PhotoTiles(props: {
  readonly photos: readonly { readonly angle: string; readonly url: string }[];
  /** Each photograph's description, by its angle. */
  readonly alt: (angle: string) => string;
  /** The handoff's taller tiles; the history's are smaller. */
  readonly tall?: boolean;
}) {
  return (
    <ul className={classes(styles.tiles, props.tall === true && styles.tall)}>
      {props.photos.map((photo) => (
        <li key={photo.url} className={styles.tile}>
          <img className={styles.photo} src={photo.url} alt={props.alt(photo.angle)} />
          <span className={styles.angle} aria-hidden="true">
            {angleName(photo.angle)}
          </span>
        </li>
      ))}
    </ul>
  );
}
