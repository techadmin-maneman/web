/** An element's class names in one string, leaving out any not given: classes(styles.row, chosen && styles.chosen). */
export function classes(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter((name) => typeof name === "string" && name !== "").join(" ");
}
