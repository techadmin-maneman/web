// A number of outside calls to be shared, such as one cron run's, so a run keeps under a vendor's own limit: Zoho Books
// allows the organisation 100 calls a minute. Each pass asks for what one record may cost before it starts on it, and
// stops when it is refused: the records it leaves are the next run's first.
//
// Calls to Cloudflare's own services, D1, R2, KV and Queues, are a separate
// allowance of 1,000 an invocation, which this does not count: each job keeps
// its own under it by the size of its batches (docs/decisions/0093).

export interface CallBudget {
  /** Takes `calls` from what is left and says true; or takes nothing and says false, if too few are left. */
  spend(calls: number): boolean;
  left(): number;
  /** Whether a pass was refused, and so left work for the next run. */
  ranOut(): boolean;
}

/** A time after which no call is granted, read from the given clock in milliseconds. */
interface CallDeadline {
  readonly until: number;
  readonly now: () => number;
}

export function createCallBudget(calls: number, deadline?: CallDeadline): CallBudget {
  let left = calls;
  let refused = false;
  const pastDeadline = () => deadline !== undefined && deadline.now() >= deadline.until;
  return {
    spend(wanted) {
      if (wanted > left || pastDeadline()) {
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
