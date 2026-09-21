// Indian mobile numbers as the forms show them: ten digits after a fixed
// +91, grouped five and five as the visitor types ("98100 00000").

export function mobileDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

export function formatMobile(value: string): string {
  const digits = mobileDigits(value);
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

export function isCompleteMobile(value: string): boolean {
  return mobileDigits(value).length === 10;
}
