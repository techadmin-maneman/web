// Ratings (docs/decisions/0260-ratings.md): one to five stars for a visit done, given once; under four, Care call the
// client; and the technician's average over the last 90 days on Me.

/** The fewest stars and the most. */
export const STARS_MIN = 1;
export const STARS_MAX = 5;

/** A rating below this opens a Care task. */
export const LOW_RATING_BELOW = 4;

/** The days a technician's ratings are averaged over. */
export const RATING_DAYS = 90;

/** Whether a rating opens a Care task. */
export const isLowRating = (stars: number): boolean => stars < LOW_RATING_BELOW;
