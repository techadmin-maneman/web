// A page opened by its address that the person's access does not reach. One not on the Staff list is told so over
// every page already, so the page says nothing more to them.

import { shell } from "../content.ts";
import { useNotListed } from "./Shell.tsx";
import styles from "./shell.module.css";

export function ClosedScreen() {
  const notListed = useNotListed();
  return notListed ? null : <p className={styles.closed}>{shell.closed}</p>;
}
