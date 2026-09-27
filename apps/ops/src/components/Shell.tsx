// The console's frame (design/phase2/Ops Console, boards A1 and B1): the
// navigation column on ink down the left, a header naming the section with who
// is signed in at its right, and the section's panels. The sections are
// apps/ops/src/route.ts's, in its order.

import { Button } from "@maneman/ui/Button";
import { Mark } from "@maneman/ui/Mark";
import { Link } from "@maneman/ui/router";
import type { ReactNode } from "react";
import { shell } from "../content.ts";
import { useLapsed } from "../lib/session.ts";
import { SECTION_NAMES, SECTIONS, type SectionPath } from "../route.ts";
import { Account } from "./Account.tsx";
import styles from "./shell.module.css";

/** A link within the console: the shared one, which leaves a click asking for a new tab to the browser. */
export { Link as OpsLink } from "@maneman/ui/router";

/** Said once, over whichever screen is open, when Access stops letting the console's calls through. */
function Lapsed() {
  return (
    <div className={styles.lapsed} role="alert">
      <p className={styles.lapsedLine}>{shell.lapsed}</p>
      <Button
        variant="primary"
        size="small"
        onClick={() => {
          window.location.reload();
        }}
      >
        {shell.reload}
      </Button>
    </div>
  );
}

interface Props {
  /** The section shown, marked in the navigation. */
  readonly section: SectionPath;
  readonly title: string;
  /** Beside the title, as the design puts the week's dates beside "Dispatch". */
  readonly sub?: string;
  /** The dispatch board fills the frame to its edges, where every other section is padded. */
  readonly flush?: boolean;
  readonly children: ReactNode;
}

export function Shell({ section, title, sub, flush, children }: Props) {
  const lapsed = useLapsed();
  return (
    <div className={styles.console}>
      <nav className={styles.nav} aria-label={shell.title}>
        <div className={styles.brand}>
          <Mark className={styles.mark} />
          <span className={styles.brandName}>{shell.title}</span>
        </div>
        <ul className={styles.sections}>
          {SECTIONS.map((each) => (
            <li key={each.page}>
              <Link className={styles.section} to={each.path} current={each.path === section}>
                {SECTION_NAMES[each.page]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.body}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <h1 className={styles.title}>{title}</h1>
            {sub !== undefined && <span className={styles.sub}>{sub}</span>}
          </div>
          <Account />
        </header>
        {lapsed && <Lapsed />}
        <main className={flush === true ? styles.flushPage : styles.page}>{children}</main>
      </div>
    </div>
  );
}
