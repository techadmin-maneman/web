// Who could take a visit nobody is on (./TrayDrawer.tsx): the technicians free at the time it was asked for, the
// nearest first, then those free closest to it, three at most, each a choice; Assign puts it on the one chosen as
// placing it on the board does, through the move's own sheet. The rooms are the board's own (GET /api/dispatch/room).

import { Button } from "@maneman/ui/Button";
import { ChoiceCard } from "@maneman/ui/ChoiceCard";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate } from "@maneman/web-kit/dates";
import { distance } from "@maneman/web-kit/figures";
import { useCallback, useState } from "react";
import type { BoardRow, Unassigned } from "../api.ts";
import { dispatch } from "../content.ts";
import { dispatchApi } from "./dispatch-api.ts";
import type { Target } from "./job.ts";
import styles from "./dispatch.module.css";

/** As many as one look takes in. */
const SHOWN = 3;

interface Suggestion {
  readonly technician: BoardRow;
  readonly start: { readonly window: Target["window"]; readonly starts_at: string };
  readonly km: number | null;
  /** How far the start is from the time asked for, in minutes. */
  readonly off: number;
}

type Room = { readonly technician_id: string; readonly date: string; readonly km: number | null } & {
  readonly starts: readonly Suggestion["start"][];
};

/** The technicians free that day, those free at the time asked first, then the closest start, then the nearest. */
function ranked(rooms: readonly Room[], each: Unassigned, technicians: readonly BoardRow[]): Suggestion[] {
  const date = each.date ?? indiaDate(each.starts_at);
  const asked = Date.parse(each.starts_at);
  return rooms
    .filter((room) => room.date === date)
    .flatMap((room) => {
      const technician = technicians.find((row) => row.technician_id === room.technician_id);
      const offOf = (start: Suggestion["start"]) => Math.abs(Date.parse(start.starts_at) - asked) / 60_000;
      const [start] = [...room.starts].sort((one, other) => offOf(one) - offOf(other));
      return technician === undefined || start === undefined
        ? []
        : [{ technician, start, km: room.km, off: offOf(start) }];
    })
    .sort((one, other) => one.off - other.off || (one.km ?? Infinity) - (other.km ?? Infinity))
    .slice(0, SHOWN);
}

export function Suggestions(props: {
  readonly each: Unassigned;
  readonly technicians: readonly BoardRow[];
  readonly onAssign: (to: Target) => void;
}) {
  const { each } = props;
  const copy = dispatch.drawer.suggest;
  const date = each.date ?? indiaDate(each.starts_at);
  const read = useCallback(() => dispatchApi.room(each.appointment_id, date), [each.appointment_id, date]);
  const [loaded] = useLoad(read);
  const [chosen, setChosen] = useState<string | null>(null);
  if (loaded.state !== "loaded") return null;
  const suggestions = ranked(loaded.value.rooms, each, props.technicians);
  const picked = suggestions.find((each) => each.technician.technician_id === chosen) ?? suggestions[0];
  return (
    <Panel titleId="suggest-title" title={copy.title}>
      <div className={styles.suggest}>
        {picked === undefined ? (
          <InlineMessage tone="note">{copy.none}</InlineMessage>
        ) : (
          <>
            {suggestions.map((suggestion) => (
              <ChoiceCard
                key={suggestion.technician.technician_id}
                name="suggest"
                checked={suggestion === picked}
                onChange={() => {
                  setChosen(suggestion.technician.technician_id);
                }}
              >
                {[
                  suggestion.technician.name,
                  copy.free(indiaClock(suggestion.start.starts_at)),
                  ...(suggestion.km === null ? [] : [copy.away(distance(suggestion.km * 1000))]),
                ].join(" · ")}
              </ChoiceCard>
            ))}
            <Button
              variant="primary"
              size="small"
              onClick={() => {
                props.onAssign({
                  technician: picked.technician,
                  date,
                  window: picked.start.window,
                  start: picked.start.starts_at,
                });
              }}
            >
              {copy.assign(picked.technician.name)}
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}
