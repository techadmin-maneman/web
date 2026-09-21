// Timings and attempt limits for the render and messaging consumers. They live
// here, not in the consumers, so test/node/free-tier-budget.test.ts can prove
// the worst case fits Cloudflare's free tier (docs/decisions/0009).

/**
 * Polls every 5 s for the first 30 s after submitting, every 10 s to 3
 * minutes, then once a minute. Pro took 17-49 s and Premium 80-91 s when the
 * harness measured them (API notes, 7.6), but a Premium render on staging took
 * 6 minutes and was billed all the same (docs/decisions/0015-render-pipeline.md).
 */
export const POLL_DELAY_SECONDS = { early: 5, late: 10, slow: 60 } as const;
export const POLL_SLOWDOWN_AFTER_MS = 30_000;
export const POLL_SLOW_AFTER_MS = 180_000;
/** A render still running this long after submitting is given up. */
export const RENDER_GIVE_UP_MS = 15 * 60 * 1000;
/** A submit that failed on the network or a 5xx is tried again, this many times in all. */
export const SUBMIT_ATTEMPTS = 3;
/** A stalled download is tried again soon by the queue, this many times, then by the sweeper. */
export const DOWNLOAD_QUEUE_RETRIES = 3;
/** AILabTools deletes results after 24 hours (API notes, section 1). */
export const RESULT_URL_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** A result message: the first try plus three retries. */
export const MAX_SEND_ATTEMPTS = 4;
