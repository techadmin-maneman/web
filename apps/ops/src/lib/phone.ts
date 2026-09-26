// A mobile number as the console shows it, wherever it shows one: the queues
// and the dispatch board alike (OPS-21).

/** "+91 98100 00001", as a mobile number is read out; any other number as it is stored. */
export function phoneWords(mobile: string): string {
  const india = /^\+91(\d{5})(\d{5})$/.exec(mobile);
  return india === null ? mobile : `+91 ${india[1] ?? ""} ${india[2] ?? ""}`;
}
