// Launching a pincode: the day it is served from, which a held referral invite's twelve months and the launch alerts
// count from. Both of the console's ways to launch one, the Waiting tab and the Served tab, keep to these.

/** Whether a launch day is refused: a pincode is served from today or a day already past, never from one to come. */
export const isLaunchInFuture = (launchOn: string, today: string): boolean => launchOn > today;

/**
 * The launch date a pincode holds once launched, as India's date. One that begins serving is dated from the launch day.
 * One served already keeps the date it holds, since telling those still waiting is not a new launch.
 */
export function launchDateAfter(held: { served: boolean; launchOn: string | null }, launchDay: string): string {
  if (held.served && held.launchOn !== null) return held.launchOn;
  return launchDay;
}
