// What an action holds: in the ops console, where every action is its icon (./icon-actions.ts), the icon alone, its
// words kept as its name for a screen reader; elsewhere, or with no icon, its words.

import { useContext, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { IconActions, textOf } from "./icon-actions.ts";
import { VisuallyHidden } from "./VisuallyHidden.tsx";

export function ActionContent({ icon, children }: { readonly icon: string | undefined; readonly children: ReactNode }) {
  const iconOnly = useContext(IconActions);
  if (icon === undefined || !iconOnly) return <>{children}</>;
  return (
    <>
      <Icon d={icon} size="sm" />
      <VisuallyHidden>{children}</VisuallyHidden>
    </>
  );
}

/** The words shown above an action drawn as its icon (./ActionTips.tsx): its own name where it has one, else its words. */
export function useTipOf(icon: string | undefined, name: string | undefined, children: ReactNode): string | undefined {
  const iconOnly = useContext(IconActions);
  return iconOnly && icon !== undefined ? (name ?? textOf(children)) : undefined;
}
