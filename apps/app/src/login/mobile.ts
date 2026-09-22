/** The ten digits of an Indian mobile number, as typed with or without +91, 0 or spaces; null if it is not one. */
export function mobileDigits(typed: string): string | null {
  const digits = typed.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** "+91 98xxx x4417", as the design shows a number. */
export function masked(digits: string): string {
  return `+91 ${digits.slice(0, 2)}xxx x${digits.slice(-4)}`;
}
