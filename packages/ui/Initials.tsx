// A person's initials in a square, before their name where a page is theirs: "RM" for Rohit Malhotra. It says
// nothing the name beside it does not, so a screen reader passes over it.

import styles from "./initials.module.css";

/** The first letters of the first two words of a name, or the first two letters of a name of one word. */
export function initialsOf(name: string): string {
  const [first = "", second = ""] = name.trim().split(/\s+/);
  return (second === "" ? first.slice(0, 2) : `${first.slice(0, 1)}${second.slice(0, 1)}`).toUpperCase();
}

export function Initials({ name }: { readonly name: string }) {
  return (
    <span className={styles.initials} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}
