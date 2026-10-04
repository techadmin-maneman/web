// Short forms of a person's name, for the places the designs show them.

import { withoutTestMark } from "../config/test-names.ts";

/** "Rohit Malhotra" → "Rohit": how a message and a screen greet a person. "Staging test Asha" → "Asha". */
export const firstNameOf = (name: string): string => withoutTestMark(name.trim()).split(/\s+/)[0] ?? "";

/** "Rohit Malhotra" → "RM"; one name gives one letter. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  const first = words[0] ?? "";
  const last = words.length > 1 ? (words.at(-1) ?? "") : "";
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}
