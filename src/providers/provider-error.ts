// A vendor's failed answer, in terms the domain reads without knowing the
// vendor: the HTTP status and the vendor's own code. Each adapter raises its
// own subclass (ZohoError for Zoho), and the stubs raise this one, so a pass
// asks `isRefusal` rather than naming a vendor.

export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The vendor refused: a 4xx, which asking again at once will not change. */
export const isRefusal = (error: unknown): error is ProviderError =>
  error instanceof ProviderError && error.status >= 400 && error.status < 500;
