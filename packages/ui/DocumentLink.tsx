// A document to open, as an invoice or a receipt: its name on a row of the paper's lighter shade, an arrow at the end.
// `DocumentLink` opens it beside the app; `DocumentButton` asks for it where it is not yet made.

import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { classes } from "./classes.ts";
import styles from "./document-link.module.css";

export function DocumentLink({
  className,
  children,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel">) {
  return (
    <a {...rest} className={classes(styles.document, className)} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function DocumentButton({ className, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  return <button {...rest} type="button" className={classes(styles.document, className)} />;
}
