// The ops console's drawer: a Dialog fixed under the header at the page's right, its title in the serif over a rule,
// what the head holds beside it, and the body beneath. A drawer that is one form has the form as its body.

import type { ComponentProps, ReactNode } from "react";
import { Dialog } from "./Dialog.tsx";
import styles from "./drawer.module.css";

/** The drawer's frame alone, for a panel that opens where a drawer does but draws its own inside. */
export const drawerFrame = styles.drawer;

export function Drawer(props: {
  readonly titleId: string;
  readonly title: ReactNode;
  /** A line beneath the title: when the visit is, and with whom. */
  readonly sub?: ReactNode;
  /** What the head holds at its right: Close, or a badge. */
  readonly aside?: ReactNode;
  readonly canClose: boolean;
  readonly onDismiss: () => void;
  /** Where the body is one form, what its submit does. */
  readonly onSubmit?: ComponentProps<"form">["onSubmit"];
  readonly children: ReactNode;
}) {
  const title = (
    <h2 className={styles.title} id={props.titleId}>
      {props.title}
    </h2>
  );
  return (
    <Dialog className={styles.drawer} labelledBy={props.titleId} canClose={props.canClose} onDismiss={props.onDismiss}>
      <div className={styles.head}>
        {props.sub === undefined ? (
          title
        ) : (
          <div>
            {title}
            <p className={styles.sub}>{props.sub}</p>
          </div>
        )}
        {props.aside}
      </div>
      {props.onSubmit === undefined ? (
        <div className={styles.body}>{props.children}</div>
      ) : (
        <form className={styles.body} onSubmit={props.onSubmit}>
          {props.children}
        </form>
      )}
    </Dialog>
  );
}
