// How a number is shown. How a typed one is read is @maneman/web-kit/mobile's, shared with the technician app.

/** "+91 98xxx x4417", as the design shows a number. */
export function masked(digits: string): string {
  return `+91 ${digits.slice(0, 2)}xxx x${digits.slice(-4)}`;
}
