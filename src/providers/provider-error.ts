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

  constructor(status: number, code: string, message: string, refusal = refusesTheRecord(status)) {
    super(message);
    this.status = status;
    this.code = code;
    this.refusal = refusal;
  }
}

/** The vendor refused the record: a pass leaves it for a person rather than asking again. */
export const isRefusal = (error: unknown): error is ProviderError => error instanceof ProviderError && error.refusal;
