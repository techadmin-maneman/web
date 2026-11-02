// The head of a console page: where it sits (Breadcrumbs), its title in the serif, a line of figures beneath the
// title or the day and place above it, a record's initials, badges and facts where the page is one, the page's actions at the right, and its tabs beneath. Every page has it, so
// every page reads alike.
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
  mark,
  beside,
  meta,
  under,
  over,
  actions,
  crumbs,
  tabs,
  className,
}: {
  readonly title: ReactNode;
  /** The heading, which takes the keyboard as another page opens. */
  readonly titleRef?: Ref<HTMLHeadingElement>;
  /** Before the title, as a client's initials. */
  readonly mark?: ReactNode;
  /** Beside the title, before its figures: a record's badges. */
  readonly beside?: ReactNode;
  /** Figures on a line beneath the title, a count or a week; never a sentence. */
  readonly meta?: ReactNode;
  /** A line beneath the title: a record's facts, side by side. */
  readonly under?: ReactNode;
  /** A small line above the title, the day and the place, where the title is a sentence on them. */
  readonly over?: ReactNode;
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
        <div className={styles.lead}>
          {mark}
          <div className={styles.heading}>
            {over !== undefined && over !== null && <span className={styles.over}>{over}</span>}
            <h1 className={typeLook("title-1", styles.title)} ref={titleRef} tabIndex={-1}>
              {title}
            </h1>
            {beside !== undefined && beside !== null && <span className={styles.beside}>{beside}</span>}
            {meta !== undefined && meta !== null && <span className={styles.meta}>{meta}</span>}
            {under !== undefined && under !== null && <span className={styles.under}>{under}</span>}
          </div>
        </div>
        {actions !== undefined && <div className={styles.actions}>{actions}</div>}
      </div>
      {tabs}
    </div>
  );
}
