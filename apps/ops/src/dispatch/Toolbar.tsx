// Beneath the board's head (./DispatchScreen.tsx): the visits by kind, a chip each with its look, the key to a visit
// nobody is on, and a search for one row among many at its end. The chips and the search narrow what is drawn only:
// each day's figures stay the day's own.

import { KindSwatch, TimelineLegend } from "@maneman/ui/DayTimeline";
import { SearchInput } from "@maneman/ui/SearchInput";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { Toolbar as SharedToolbar } from "@maneman/ui/Toolbar";
import { dispatch, tasks } from "../content.ts";
import { useIsPhone } from "../lib/media.ts";
import { BOARD_KINDS, TIMELINE_KINDS, type BoardKind } from "./kinds.ts";
import styles from "./toolbar.module.css";

interface Props {
  /** Whether the day is shown, whose visits a nobody's key is to. */
  readonly day: boolean;
  readonly find: string;
  readonly onFind: (text: string) => void;
  /** The kind of visit shown, or all. */
  readonly kind: BoardKind;
  readonly onKind: (kind: BoardKind) => void;
}

export function Toolbar({ day, find, onFind, kind, onKind }: Props) {
  const copy = dispatch.tools;
  // A phone has neither: one technician's visits, a list, need no key, and the chips find the technician.
  if (useIsPhone()) return null;
  return (
    <SharedToolbar
      label={copy.label}
      className={styles.tools}
      end={<SearchInput label={copy.find} value={find} onChange={onFind} />}
    >
      <div className={styles.kinds} role="radiogroup" aria-label={dispatch.kinds.label}>
        {BOARD_KINDS.map((each) => (
          <ToggleButton
            key={each}
            asRadio
            filled
            pressed={kind === each}
            onClick={() => {
              onKind(each);
            }}
          >
            <span className={styles.kind}>
              {each !== "all" && <KindSwatch kind={TIMELINE_KINDS[each]} />}
              {dispatch.kinds[each]}
            </span>
          </ToggleButton>
        ))}
      </div>
      {day && <TimelineLegend label={copy.key} kinds={[]} nobody={tasks.groups.unassigned_visit} />}
    </SharedToolbar>
  );
}
