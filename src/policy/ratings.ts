// Ratings (docs/decisions/0260-ratings.md): one to five stars for a visit done, given once, within days of it; under a
// number of stars, Care call the client; and the technician's average over the last days on Me, shown once enough
// clients have rated them that one client's stars cannot be read off it. Each figure is ops' setting `ratings`.

/** The fewest stars and the most. */
export const STARS_MIN = 1;
export const STARS_MAX = 5;

export const RATING_KEYS = ["low_below", "average_days", "shown_from", "rate_within_days"] as const;
export type Ratings = Readonly<Record<(typeof RATING_KEYS)[number], number>>;

/** Until ops set others: under 4 stars Care call; 90 days' average, from 5 ratings; a visit rated within 30 days. */
export const RATINGS: Ratings = { low_below: 4, average_days: 90, shown_from: 5, rate_within_days: 30 };

/** Whether a rating opens a Care task, by the setting in force when it is given. */
export const isLowRating = (stars: number, ratings: Ratings): boolean => stars < ratings.low_below;
