// The head of a console page: where it sits (Breadcrumbs), its title in the serif, a line of figures beside the
// title, the page's actions at the right, and its tabs beneath. Every page has it, so every page reads alike.
//
//   <PageHeader title={copy.title} meta={copy.count(rows.length)} actions={<Button …>{copy.add}</Button>} />

import { createContext, type ReactNode, type Ref } from "react";
import { classes } from "./classes.ts";
import styles from "./page-header.module.css";
import { typeLook } from "./type.ts";

/** The page's title, as its head shows it, for a panel beneath to know it is titled the same (./Panel.tsx). */
export const PageTitle = createContext<ReactNode>(null);

export function PageHeader({
  title,
  titleRef,
  meta,
  actions,
  crumbs,
  tabs,
  className,
}: {
  readonly title: ReactNode;
  /** The heading, which takes the keyboard as another page opens. */
  readonly titleRef?: Ref<HTMLHeadingElement>;
  /** Figures beside the title, a count or a week; never a sentence. */
  readonly meta?: ReactNode;
  /** The page's own actions, at the right. */
  readonly actions?: ReactNode;
  /** Where the page sits, above the title. */
  readonly crumbs?: ReactNode;
  /** The page's tabs, beneath. */
  readonly tabs?: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <div className={classes(styles.header, className)}>
      {crumbs}
      <div className={styles.row}>
        <div className={styles.heading}>
          <h1 className={typeLook("title-2", styles.title)} ref={titleRef} tabIndex={-1}>
            {title}
          </h1>
          {meta !== undefined && meta !== null && <span className={styles.meta}>{meta}</span>}
        </div>
        {actions !== undefined && <div className={styles.actions}>{actions}</div>}
      </div>
      {tabs}
    </div>
  );
}
