// Many tasks changed at once on the Tasks board (./TasksScreen.tsx): taken, assigned to someone, or closed with one
// reason where every one chosen is of one group whose row closes with a reason alone. Each change is the API's own,
// task by task, as one row's is, so each keeps its own audit entry; those not changed are counted and said why, and
// stay chosen to try again, or, where a task had changed meanwhile, the page is read again and the frame says it
// (docs/decisions/0282-tasks-chosen-together.md).

import { Button } from "@maneman/ui/Button";
import { Field, Select, TextArea } from "@maneman/ui/Field";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { describedBy, Missing } from "@maneman/ui/Missing";
import { useRefreshPage } from "@maneman/ui/refresh";
import { SelectionBar } from "@maneman/ui/SelectionBar";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { isChanged, LATEST } from "@maneman/ui/words";
import { errorText } from "@maneman/web-kit/refusal";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { useEffect, useState } from "react";
import { tasks } from "../content.ts";
import { staffName } from "../lib/who.ts";
import { closableAs, closeWords } from "./TaskActions.tsx";
import type { Acting } from "./TaskDetail.tsx";
import { keyOf } from "./TaskTable.tsx";
import type { Row } from "./task-views.ts";
import { tasksApi } from "./tasks-api.ts";

const copy = tasks.bulk;

interface Chosen {
  readonly row: Row;
  readonly acting: Acting;
}

/** What one change came to: done, or refused with the API's code. */
type Answered = { readonly ok: true } | { readonly ok: false; readonly code: string };

/**
 * Groups whose row closes with more than a reason, or none, so never together: a guarantee claim asks whether the hair
 * system was at fault (docs/decisions/0273-why-a-hair-system-failed.md), and an erasure finished in the CRM closes with no words.
 */
const CLOSED_ALONE: ReadonlySet<string> = new Set(["fit_guarantee_claim", "erasure_follow_up"]);

/** Each chosen task changed in turn, and what each came to. */
async function eachOf(chosen: readonly Chosen[], change: (one: Chosen) => Promise<Answered>): Promise<Answered[]> {
  const answers: Answered[] = [];
  for (const one of chosen) answers.push(await change(one));
  return answers;
}

/** A run's words: how many done, and for those not, why, as the row's own refusal says it; a changed task first. */
interface Said {
  readonly text: string;
  readonly why: string | null;
  /** The rows chosen it left, by key: the words go once the choice is another. */
  readonly after: string;
}

function saidOf(answers: readonly Answered[], closing: boolean, after: string): Said {
  const done = answers.filter((answer) => answer.ok).length;
  const refusals = answers.flatMap((answer) => (answer.ok ? [] : [answer]));
  const refused = refusals.find((answer) => answer.code === "not_found") ?? refusals[0];
  if (refused === undefined) return { text: copy.done(done), why: null, after };
  const why = errorText(closing ? tasks.close.errors : tasks.owner.errors, refused);
  return { text: copy.partly(done, refusals.length, why), why, after };
}

const signatureOf = (chosen: readonly Chosen[]) => chosen.map(({ row }) => keyOf(row)).join(",");

/**
 * The last run's words, kept while the rows chosen are those it left. Where a task had changed meanwhile, the page is
 * read again, as a row's own refusal reads it, and the frame says the run's words above it, the counts with them.
 */
function useSaid(signature: string) {
  const [said, setSaid] = useState<Said | null>(null);
  const refresh = useRefreshPage();
  useEffect(() => {
    if (said !== null && said.after !== signature) setSaid(null);
  }, [said, signature]);
  const say = (next: Said) => {
    if (next.why !== null && isChanged(next.why)) refresh(`${next.text} ${LATEST}`);
    else setSaid(next);
  };
  return [said, say] as const;
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
  if (group === null || !one || CLOSED_ALONE.has(group)) return null;
  const waiting = reason.trim() === "";
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
        disabled={waiting}
        aria-describedby={describedBy("close-chosen-why", waiting)}
        onClick={() => {
          onClose(reason.trim());
        }}
      >
        {copy.close(chosen.length)}
      </Button>
      <Missing id="close-chosen-why" what={waiting ? copy.whyFirst : null} />
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
  onKeep,
}: {
  readonly rows: readonly Row[];
  readonly actingOn: (row: Row) => Acting;
  readonly onClear: () => void;
  /** Only the tasks named left chosen. */
  readonly onKeep: (keys: readonly string[]) => void;
}) {
  const [busy, once] = useOneAtATime();
  const chosen = rows.map((row) => ({ row, acting: actingOn(row) }));
  const [said, setSaid] = useSaid(signatureOf(chosen));
  const { me = null, staff = [] } = chosen[0]?.acting ?? {};
  const ownable = chosen.filter(({ acting }) => acting.mayOwn);
  const takeable = ownable.filter(({ acting }) => me !== null && staff.includes(me) && acting.owner !== me);

  const run = (those: readonly Chosen[], change: (one: Chosen) => Promise<Answered>, closing = false) =>
    once(async () => {
      const answers = await eachOf(those, change);
      if (answers.every((answer) => answer.ok)) {
        setSaid(saidOf(answers, closing, ""));
        onClear();
        return;
      }
      // Only those refused stay chosen, to try again: one done is not sent twice, and one that left the view under
      // Unassigned or Mine takes nothing of the words with it.
      const refused = those.flatMap((one, at) => (answers[at]?.ok === true ? [] : [keyOf(one.row)]));
      onKeep(refused);
      setSaid(saidOf(answers, closing, refused.join(",")));
    });
  const ownedBy =
    (owner: string) =>
    async ({ row, acting }: Chosen) => {
      const answer = await tasksApi.setTaskOwner(row.group, row.task.id, owner);
      if (!answer.ok) return answer;
      acting.onOwner(answer.body.owner);
      return { ok: true } as const;
    };
  const closedFor =
    (why: string) =>
    async ({ row, acting }: Chosen) => {
      const group = closableAs(row.group);
      if (group === null) return { ok: false, code: "invalid_request" } as const;
      const answer = await tasksApi.closeTask(group, row.task.id, why);
      if (!answer.ok) return answer;
      acting.onClosed();
      return { ok: true } as const;
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
          <CloseAll chosen={chosen} busy={busy} onClose={(why) => void run(chosen, closedFor(why), true)} />
        </SelectionBar>
      )}
      {said !== null && <InlineMessage tone={said.why === null ? "saved" : "error"}>{said.text}</InlineMessage>}
    </>
  );
}
