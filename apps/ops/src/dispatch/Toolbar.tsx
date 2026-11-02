// Beneath the board's head (./DispatchScreen.tsx): the key to the day's visits, and a search for one row among many at
// its end, which the design does not draw. The search narrows the rows only: each day's figures stay the day's own.

import { SearchInput } from "@maneman/ui/SearchInput";
import { TimelineLegend } from "@maneman/ui/DayTimeline";
import { Toolbar as SharedToolbar } from "@maneman/ui/Toolbar";
import { dispatch, tasks } from "../content.ts";
import { useIsPhone } from "../lib/media.ts";
import styles from "./toolbar.module.css";

const KINDS = [
  { kind: "consultation", name: dispatch.typeNames.consultation },
  { kind: "service", name: dispatch.typeNames.service },
  { kind: "replacement", name: dispatch.typeNames.replacement },
  { kind: "fit", name: dispatch.typeNames.first_fit },
] as const;

interface Props {
  /** Whether the day is shown, which the key is to; the week has its own beneath it. */
  readonly day: boolean;
  readonly find: string;
  readonly onFind: (text: string) => void;
}

export function Toolbar({ day, find, onFind }: Props) {
  const copy = dispatch.tools;
  // A phone has neither: one technician's visits, a list, need no key, and the chips find the technician.
  if (useIsPhone()) return null;
  return (
    <SharedToolbar
      label={copy.label}
      className={styles.tools}
      end={<SearchInput label={copy.find} value={find} onChange={onFind} />}
    >
      {day && <TimelineLegend label={copy.key} kinds={KINDS} nobody={tasks.groups.unassigned_visit} />}
    </SharedToolbar>
  );
}
