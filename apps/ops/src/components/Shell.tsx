// The console's frame (design/phase2/Ops Console, boards A1 and B1): the
// navigation column on ink down the left, a header naming the section, and the
// section's panels. The design lists eight sections; this lists the two the
// backend has routes for (docs/fidelity-method.md).

import { MARK } from "@maneman/brand/marks";
import type { ReactNode } from "react";
import { shell } from "../content.ts";
import { go } from "../route.ts";
import styles from "./shell.module.css";

/** A link within the console: the path changes without a reload. */
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
        event.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}

interface Props {
  /** The section shown, marked in the navigation and named in the header. */
  readonly section: string;
  readonly title: string;
  /** Beside the title, as the design puts the week's dates beside "Dispatch". */
  readonly sub?: string;
  readonly children: ReactNode;
}

export function Shell({ section, title, sub, children }: Props) {
  return (
    <div className={styles.console}>
      <nav className={styles.nav} aria-label={shell.title}>
        <div className={styles.brand}>
          <svg className={styles.mark} viewBox={MARK.viewBox} aria-hidden="true" focusable="false">
            <path fillRule="evenodd" d={MARK.d} />
          </svg>
          <span className={styles.brandName}>{shell.title}</span>
        </div>
        <ul className={styles.sections}>
          {shell.sections.map((each) => (
            <li key={each.page}>
              <OpsLink className={styles.section} to={each.page} current={each.page === section}>
                {each.label}
              </OpsLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.body}>
        <header className={styles.header}>
          <h1 className={styles.title}>{title}</h1>
          {sub !== undefined && <span className={styles.sub}>{sub}</span>}
        </header>
        <main className={styles.page}>{children}</main>
      </div>
    </div>
  );
}
