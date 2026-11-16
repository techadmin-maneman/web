// A rating of one to five stars (design/client-redesign, a past visit's "How was this visit?"): five buttons drawn as
// stars, each a 44 px target, filled up to the one chosen, and a tap gives that many. Buttons, not radios: the arrow
// keys move between radios and choose as they go, which here would give a rating no one meant. Once given, the stars
// are shown and not chosen again.

import { CLIENT_ICONS } from "@maneman/brand/icons";
import { classes } from "./classes.ts";
import { Icon } from "./Icon.tsx";
import styles from "./star-rating.module.css";

const STARS = [1, 2, 3, 4, 5] as const;

export function StarRating(props: {
  /** The group's name, read out: "Rate this visit". */
  readonly label: string;
  /** Each star as read out: "4 of 5". */
  readonly starLabel: (stars: number) => string;
  /** The stars given; null before any. */
  readonly value: number | null;
  /** Left out once the rating is given: the stars are then shown, not chosen. */
  readonly onRate?: (stars: number) => void;
  readonly disabled?: boolean;
  readonly className?: string | undefined;
}) {
  const given = props.value ?? 0;
  const { onRate } = props;
  if (onRate === undefined) {
    return (
      <p className={classes(styles.stars, props.className)} role="img" aria-label={props.starLabel(given)}>
        {STARS.map((stars) => (
          <span key={stars} className={classes(styles.star, stars <= given && styles.on)}>
            <Icon d={CLIENT_ICONS.star} size="md" />
          </span>
        ))}
      </p>
    );
  }
  return (
    <div className={classes(styles.stars, props.className)} role="group" aria-label={props.label}>
      {STARS.map((stars) => (
        <button
          key={stars}
          type="button"
          className={classes(styles.star, styles.choose)}
          disabled={props.disabled}
          aria-label={props.starLabel(stars)}
          onClick={() => {
            onRate(stars);
          }}
        >
          <Icon d={CLIENT_ICONS.star} size="md" />
        </button>
      ))}
    </div>
  );
}
