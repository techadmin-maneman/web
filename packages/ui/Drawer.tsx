// The ops console's drawer: a Dialog fixed under the header at the page's right, its title in the serif over a rule,
// what the head holds beside it, and the body beneath. A drawer that is one form has the form as its body. Every
// drawer closes the same way: the cross at the head's right, which stays in view as the body scrolls, or Escape.

import { ICONS } from "@maneman/brand/icons";
import type { ComponentProps, ReactNode } from "react";
import { Dialog } from "./Dialog.tsx";
import { IconButton } from "./IconButton.tsx";
import styles from "./drawer.module.css";
import { typeLook } from "./type.ts";

/** The drawer's frame alone, for a panel that opens where a drawer does but draws its own inside. */
export const drawerFrame = styles.drawer;

export function Drawer(props: {
  readonly titleId: string;
  readonly title: ReactNode;
  /** A line beneath the title: when the visit is, and with whom. */
  readonly sub?: ReactNode;
  /** What the head holds at its right, before the cross: a badge. */
  readonly aside?: ReactNode;
  /** What the cross is read as, the app's word for Close; null while the drawer must stay open, as a send runs. */
  readonly close: string | null;
  readonly onDismiss: () => void;
  /** Where the body is one form, what its submit does. */
  readonly onSubmit?: ComponentProps<"form">["onSubmit"];
  readonly children: ReactNode;
}) {
  const title = (
    <h2 className={typeLook("title-3", styles.title)} id={props.titleId}>
      {props.title}
    </h2>
  );
  return (
    <Dialog
      className={styles.drawer}
      labelledBy={props.titleId}
      canClose={props.close !== null}
      onDismiss={props.onDismiss}
    >
      <div className={styles.head}>
        {props.sub === undefined ? (
          title
        ) : (
          <div>
            {title}
            <p className={styles.sub}>{props.sub}</p>
          </div>
        )}
        <div className={styles.aside}>
          {props.aside}
          {props.close !== null && (
            <IconButton d={ICONS.cross} size="md" label={props.close} onClick={props.onDismiss} />
          )}
        </div>
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
