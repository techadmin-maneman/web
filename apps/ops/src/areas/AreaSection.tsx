// One of Areas' sections, a panel of its own under its name, as every Settings page sets one subject a panel: its fields
// a group named by the panel's title, read out once.

import { Fieldset } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import type { ReactNode } from "react";
import styles from "./areas.module.css";

export function AreaSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Panel titleId={id} title={title}>
      <Fieldset className={styles.section} legend={title} legendLook="hidden">
        {children}
      </Fieldset>
    </Panel>
  );
}
