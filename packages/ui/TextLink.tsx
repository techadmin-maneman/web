// Words that go somewhere, in a sentence's own look: underlined, in the text's ink. A link that leaves the app (a
// document, WhatsApp, a call) is a `TextLink`; one within it is the router's `Link`, given `textLinkLook()`.

import type { AnchorHTMLAttributes, Ref } from "react";
import { classes } from "./classes.ts";
import styles from "./text-link.module.css";

export const textLinkLook = (className?: string): string => classes(styles.link, className);

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "target" | "rel"> & {
  readonly className?: string;
  /** Opened beside the app, as a document or a payment page is. */
  readonly newTab?: boolean;
  readonly ref?: Ref<HTMLAnchorElement>;
};

export function TextLink({ className, newTab = false, children, ...rest }: Props) {
  const beside = newTab ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noopener" };
  return (
    <a {...rest} {...beside} className={textLinkLook(className)}>
      {children}
    </a>
  );
}
