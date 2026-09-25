// A number of outside calls to be shared, such as one cron run's. The free
// plan allows 50 subrequests an invocation, and a run past them fails part-way
// (docs/decisions/0009-stay-inside-cloudflare-free-tier.md). Each pass asks for
// what one record may cost before it starts on it, and stops when it is
// refused: the records it leaves are the next run's first.

export interface CallBudget {
  /** Takes `calls` from what is left and says true; or takes nothing and says false, if too few are left. */
  spend(calls: number): boolean;
  left(): number;
  /** Whether a pass was refused, and so left work for the next run. */
  ranOut(): boolean;
}

export function createCallBudget(calls: number): CallBudget {
  let left = calls;
  let refused = false;
  return {
    spend(wanted) {
      if (wanted > left) {
        refused = true;
        return false;
      }
      left -= wanted;
      return true;
    },
    left: () => left,
    ranOut: () => refused,
  };
}
