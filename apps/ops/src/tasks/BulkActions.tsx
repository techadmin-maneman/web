// Many tasks changed at once on the Tasks board (./TasksScreen.tsx): taken, assigned to someone, or closed with one
// reason where every one chosen is of one group that closes. Each change is the API's own, task by task, as one row's
// is, so each keeps its own audit entry; those that could not be changed are counted, not hidden
// (docs/decisions/0282-tasks-chosen-together.md).

import { Button } from "@maneman/ui/Button";
import { Field, Select, TextArea } from "@maneman/ui/Field";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { SelectionBar } from "@maneman/ui/SelectionBar";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { useState } from "react";
import { tasks } from "../content.ts";
import { staffName } from "../lib/who.ts";
import { closableAs, closeWords } from "./TaskActions.tsx";
import type { Acting } from "./TaskDetail.tsx";
import type { Row } from "./task-views.ts";
import { tasksApi } from "./tasks-api.ts";

const copy = tasks.bulk;

interface Chosen {
  readonly row: Row;
  readonly acting: Acting;
}

/** Each chosen task changed in turn: true for each the API took. */
async function eachOf(chosen: readonly Chosen[], change: (one: Chosen) => Promise<boolean>): Promise<number> {
  let done = 0;
  for (const one of chosen) {
    if (await change(one)) done += 1;
  }
  return done;
}

/** One reason for every task chosen, where all are of one group that closes. */
function CloseAll({
  chosen,
  busy,
  onClose,
}: {
  chosen: readonly Chosen[];
  busy: boolean;
  onClose: (why: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [first] = chosen;
  const group = first === undefined ? null : closableAs(first.row.group);
  const one = chosen.every(({ row, acting }) => acting.closable && row.group === first?.row.group);
  if (group === null || !one) return null;
  return (
    <>
      <Field label={closeWords(group).label}>
        {(control) => (
          <TextArea
            {...control}
            rows={1}
            maxLength={REASON_MAX_CHARS}
            value={reason}
            disabled={busy}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      <Button
        variant="outline"
        size="small"
        busy={busy}
        disabled={reason.trim() === ""}
        onClick={() => {
          onClose(reason.trim());
        }}
      >
        {copy.close(chosen.length)}
      </Button>
    </>
  );
}

/** Someone to give every task chosen to, of those who have used the console lately. */
function AssignAll(props: {
  staff: readonly string[];
  me: string | null;
  count: number;
  busy: boolean;
  onAssign: (email: string) => void;
}) {
  const { staff, me, busy } = props;
  const [assignee, setAssignee] = useState(staff[0] ?? "");
  return (
    <>
      <Field label={copy.assignTo}>
        {(control) => (
          <Select
            {...control}
            compact
            value={assignee}
            disabled={busy}
            onChange={(event) => {
              setAssignee(event.currentTarget.value);
            }}
          >
            {staff.map((email) => (
              <option key={email} value={email}>
                {email === me ? tasks.owner.you(staffName(email)) : staffName(email)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button
        variant="outline"
        size="small"
        busy={busy}
        disabled={assignee === ""}
        onClick={() => {
          props.onAssign(assignee);
        }}
      >
        {copy.assign(props.count)}
      </Button>
    </>
  );
}

export function BulkActions({
  rows,
  actingOn,
  onClear,
}: {
  readonly rows: readonly Row[];
  readonly actingOn: (row: Row) => Acting;
  readonly onClear: () => void;
}) {
  const [busy, once] = useOneAtATime();
  const [said, setSaid] = useState<string | null>(null);
  const chosen = rows.map((row) => ({ row, acting: actingOn(row) }));
  const { me = null, staff = [] } = chosen[0]?.acting ?? {};
  const ownable = chosen.filter(({ acting }) => acting.mayOwn);
  const takeable = ownable.filter(({ acting }) => me !== null && staff.includes(me) && acting.owner !== me);

  const run = (those: readonly Chosen[], change: (one: Chosen) => Promise<boolean>) =>
    once(async () => {
      const done = await eachOf(those, change);
      setSaid(copy.done(done, those.length - done));
      onClear();
    });
  const ownedBy =
    (owner: string) =>
    async ({ row, acting }: Chosen) => {
      const answer = await tasksApi.setTaskOwner(row.group, row.task.id, owner);
      if (answer.ok) acting.onOwner(answer.body.owner);
      return answer.ok;
    };
  const closedFor =
    (why: string) =>
    async ({ row, acting }: Chosen) => {
      const group = closableAs(row.group);
      if (group === null) return false;
      const answer = await tasksApi.closeTask(group, row.task.id, why);
      if (answer.ok) acting.onClosed();
      return answer.ok;
    };

  return (
    <>
      {rows.length > 0 && (
        <SelectionBar count={rows.length} onClear={onClear}>
          {takeable.length > 0 && me !== null && (
            <Button variant="outline" size="small" busy={busy} onClick={() => void run(takeable, ownedBy(me))}>
              {copy.take(takeable.length)}
            </Button>
          )}
          {ownable.length > 0 && staff.length > 0 && (
            <AssignAll
              staff={staff}
              me={me}
              count={ownable.length}
              busy={busy}
              onAssign={(email) => void run(ownable, ownedBy(email))}
            />
          )}
          <CloseAll chosen={chosen} busy={busy} onClose={(why) => void run(chosen, closedFor(why))} />
        </SelectionBar>
      )}
      {said !== null && rows.length === 0 && <InlineMessage tone="saved">{said}</InlineMessage>}
    </>
  );
}
