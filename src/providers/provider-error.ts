// A vendor's failed answer, in terms the domain reads without knowing the
// vendor: the HTTP status, the vendor's own code, and whether the vendor
// refused what was asked. Each adapter raises its own subclass (ZohoError for
// Zoho), and the stubs raise this one, so a pass asks `isRefusal` rather than
// naming a vendor.

/**
 * A 4xx is the vendor refusing the record, and asking again at once will not
 * change it. Two are not: 401 is our access to the vendor and 429 our pace, and
 * both say nothing about the record.
 */
const refusesTheRecord = (status: number): boolean => status >= 400 && status < 500 && status !== 401 && status !== 429;

export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;
  /** The vendor refused the record itself; false for a failure of ours, such as a token it would not give. */
  readonly refusal: boolean;
  /** What the vendor said, in its own words and without its status or code: what an alert to ops quotes. */
  readonly said: string;

  constructor(
    status: number,
    code: string,
    message: string,
    { refusal = refusesTheRecord(status), said = message }: { refusal?: boolean; said?: string } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.refusal = refusal;
    this.said = said;
  }
}

/** The vendor refused the record: a pass leaves it for a person rather than asking again. */
export const isRefusal = (error: unknown): error is ProviderError => error instanceof ProviderError && error.refusal;

/**
 * The payment provider gave no answer it could be held to, a timeout or its own failure, so a refund may or may not
 * have been made. Asking again under the same receipt is safe: a second refund under it is refused.
 */
export class PaymentUnanswered extends Error {
  constructor(step: string, cause: unknown) {
    super(`the payment provider did not answer the ${step}`, { cause });
    this.name = "PaymentUnanswered";
  }
}
