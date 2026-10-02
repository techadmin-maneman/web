// A page opened by its address that the person's access does not reach. One not on the Staff list is told so over
// every page already, so the page says nothing more to them.

import { shell } from "../content.ts";
import { sectionOf, SECTION_NAMES, type Page } from "../route.ts";
import { Shell, useNotListed } from "./Shell.tsx";
import styles from "./shell.module.css";

export function ClosedScreen({ page }: { page: Page }) {
  const notListed = useNotListed();
  return (
    <Shell section={sectionOf(page).path} title={SECTION_NAMES[page]}>
      {!notListed && <p className={styles.closed}>{shell.closed}</p>}
    </Shell>
  );
}
