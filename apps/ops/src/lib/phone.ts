// A mobile number as the console shows it, wherever it shows one: the queues
// and the dispatch board alike.

import { ERASED_MOBILE } from "../content.ts";

/** What an erasure leaves in place of the number: "erased:" and the person's ID. */
const ERASED_PREFIX = "erased:";

/** "+91 98100 00001", as a mobile number is read out; any other number as it is stored; never an erased one's mark. */
export function phoneWords(mobile: string): string {
  if (mobile.startsWith(ERASED_PREFIX)) return ERASED_MOBILE;
  const india = /^\+91(\d{5})(\d{5})$/.exec(mobile);
  return india === null ? mobile : `+91 ${india[1] ?? ""} ${india[2] ?? ""}`;
}
