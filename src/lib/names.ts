// Short forms of a person's name, for the places the designs show them.

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
