// The console's frame (design/phase2/Ops Console, boards A1 and B1): the
// navigation column on ink down the left, a header naming the section with who
// is signed in at its right, and the section's panels. The sections are
// apps/ops/src/route.ts's, in its order.

import { Mark } from "@maneman/ui/Mark";
import type { ReactNode } from "react";
import { shell } from "../content.ts";
import { useLapsed } from "../lib/session.ts";
import { followsHere, go, SECTION_NAMES, SECTIONS, type SectionPath } from "../route.ts";
import { Account } from "./Account.tsx";
import styles from "./shell.module.css";

/** A link within the console: the path changes without a reload, unless the click asks for a new tab. */
export function OpsLink({
  to,
  className,
  current,
  children,
}: {
  to: string;
  className?: string;
  current?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={to}
      aria-current={current === true ? "page" : undefined}
      onClick={(event) => {
        if (!followsHere(event)) return;
        event.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}

/** Said once, over whichever screen is open, when Access stops letting the console's calls through. */
function Lapsed() {
  return (
    <div className={styles.lapsed} role="alert">
      <p className={styles.lapsedLine}>{shell.lapsed}</p>
      <button
        className={styles.reload}
        type="button"
        onClick={() => {
          window.location.reload();
        }}
      >
        {shell.reload}
      </button>
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
              <OpsLink className={styles.section} to={each.path} current={each.path === section}>
                {SECTION_NAMES[each.page]}
              </OpsLink>
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
