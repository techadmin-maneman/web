// Whether a button that names an icon draws its icon alone, its words read aloud and shown on hover or focus
// (./ActionTips.tsx): true in the ops console, whose every action is its icon
// (docs/decisions/0316-every-console-action-an-icon.md); elsewhere a button keeps its words.

import { createContext, isValidElement, useContext, type ReactNode } from "react";
import { VisuallyHidden } from "./VisuallyHidden.tsx";

export const IconActions = createContext(false);

/** An icon a part shared with the other apps draws in the console alone: elsewhere its button keeps its words. */
export const useActionIcon = (icon: string): string | undefined => (useContext(IconActions) ? icon : undefined);

/** The words a button shows, for its hover label: its text and the text inside its elements, not what only a
 * screen reader hears. */
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return node.type === VisuallyHidden ? "" : textOf(node.props.children);
  }
  return "";
}
