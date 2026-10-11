// The Care team on the Messages page (docs/decisions/0134-care-cover.md, 0136-care-names.md): each member's name as
// clients know it, clients, weekly days off and leave, and who covers them today. A Customer Care manager sets the
// name, the days off and the leave from the member's row.

import { Button } from "@maneman/ui/Button";
import { Checkbox, DateInput, Field, Select, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { classes } from "@maneman/ui/classes";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import type { Failure } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import type { Answer } from "../api.ts";
import { care } from "../content/care.ts";
import { useAccess } from "../lib/access.ts";
import { Refused } from "../settings/index.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { careApi, type CareMember } from "./care-api.ts";
import styles from "../components/forms.module.css";
import own from "./care.module.css";

const copy = care.team;
const COLUMNS = 7;

type Leave = CareMember["leave"][number];

const periodOf = (leave: Leave): string => copy.period(shortDate(leave.from), shortDate(leave.to));

/** Sends a change, saying why it was refused; `onDone` once it went. */
function useSend(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const send = async (call: () => Promise<Answer<unknown>>) => {
    setBusy(true);
    setFailure(null);
    const answer = await call();
    setBusy(false);
    if (answer.ok) onDone();
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return { busy, failure, send };
}

function DaysOffForm(props: { member: CareMember; onDone: () => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<readonly number[]>(props.member.weekly_off);
  const { busy, failure, send } = useSend(props.onDone);
  const toggle = (day: number) => {
    setPicked((was) => (was.includes(day) ? was.filter((each) => each !== day) : [...was, day].sort()));
  };
  return (
    <div className={own.teamForm}>
      <div className={own.days}>
        {copy.weekdays.map((name, day) => (
          <Checkbox
            key={name}
            label={name}
            checked={picked.includes(day)}
            onChange={() => {
              toggle(day);
            }}
          />
        ))}
      </div>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="small"
          disabled={busy}
          onClick={() => void send(() => careApi.setDaysOff(props.member.email, picked))}
        >
          {copy.save}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} onClick={props.onCancel}>
          {copy.cancel}
        </Button>
      </div>
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}

function LeaveForm(props: { member: CareMember; onDone: () => void; onCancel: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { busy, failure, send } = useSend(props.onDone);
  return (
    <div className={own.teamForm}>
      <div className={styles.fields}>
        <Field label={copy.from}>
          {(control) => (
            <DateInput
              {...control}
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                if (to === "") setTo(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={copy.to}>
          {(control) => (
            <DateInput
              {...control}
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="small"
          disabled={busy || from === "" || to === ""}
          onClick={() => void send(() => careApi.addLeave(props.member.email, from, to))}
        >
          {copy.add}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} onClick={props.onCancel}>
          {copy.cancel}
        </Button>
      </div>
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}

function NameForm(props: { member: CareMember; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(props.member.name ?? "");
  const { busy, failure, send } = useSend(props.onDone);
  return (
    <div className={own.teamForm}>
      <div className={styles.fields}>
        <Field label={copy.nameLabel}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={40}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="small"
          disabled={busy || name.trim() === ""}
          onClick={() => void send(() => careApi.setCareName(props.member.email, name.trim()))}
        >
          {copy.save}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} onClick={props.onCancel}>
          {copy.cancel}
        </Button>
      </div>
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}

function LeaveList(props: { leave: readonly Leave[]; mayManage: boolean; onChanged: () => void }) {
  const { busy, failure, send } = useSend(props.onChanged);
  if (props.leave.length === 0) return <>{copy.noLeave}</>;
  return (
    <>
      <ul className={own.leave}>
        {props.leave.map((leave) => (
          <li key={leave.id}>
            {periodOf(leave)}
            {props.mayManage && (
              <button
                className={styles.inline}
                type="button"
                disabled={busy}
                aria-label={copy.takeBackLabel(periodOf(leave))}
                onClick={() => void send(() => careApi.deleteLeave(leave.id))}
              >
                {copy.takeBack}
              </button>
            )}
          </li>
        ))}
      </ul>
      <Refused failed={failure} errors={copy.errors} />
    </>
  );
}

/** On shift, off it, or a day off; and who covers them while they are off. */
function stateOf(member: CareMember): string {
  if (!member.on_team) return copy.leftTeam;
  if (member.day_off) return copy.dayOff;
  return member.on_shift_since === null ? copy.offShift : copy.onShift(indiaClock(member.on_shift_since));
}

function todayOf(member: CareMember): string {
  return member.covered_by === null ? stateOf(member) : stateOf(member) + copy.coveredBy(member.covered_by);
}

/** The signed-in member going on shift, or off it. */
function ShiftSwitch(props: { me: CareMember; onDone: () => void }) {
  const { busy, failure, send } = useSend(props.onDone);
  const since = props.me.on_shift_since;
  return (
    <div className={own.tools}>
      <p className={styles.note}>{since === null ? copy.you.off : copy.you.on(indiaClock(since))}</p>
      <Button
        variant={since === null ? "primary" : "outline"}
        size="small"
        disabled={busy}
        onClick={() => void send(() => careApi.setOnShift(since === null))}
      >
        {since === null ? copy.goOn : copy.goOff}
      </Button>
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}

/** Every client of one member, moved to another on the team. */
function MoveAllForm(props: {
  member: CareMember;
  team: readonly CareMember[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const others = props.team.filter((each) => each.on_team && each.email !== props.member.email);
  const [to, setTo] = useState(others[0]?.email ?? "");
  const { busy, failure, send } = useSend(props.onDone);
  return (
    <div className={own.teamForm}>
      <div className={own.closing}>
        <Field label={copy.moveAllTo}>
          {(control) => (
            <Select
              {...control}
              className={styles.choiceBox}
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
            >
              {others.map((each) => (
                <option key={each.email} value={each.email}>
                  {each.email}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button
          variant="primary"
          size="small"
          disabled={busy || to === ""}
          onClick={() => void send(() => careApi.moveAllClients(props.member.email, to))}
        >
          {copy.move}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} onClick={props.onCancel}>
          {copy.cancel}
        </Button>
      </div>
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}

type Acting = "name" | "days" | "leave" | "move" | null;

/** A manager's ways to change a member: their name, days off and leave while on the team, and moving their clients. */
function RowActions(props: { member: CareMember; acting: Acting; onActing: (acting: Acting) => void }) {
  const { member } = props;
  const actions: readonly (readonly [Exclude<Acting, null>, string, string])[] = [
    ...(member.on_team
      ? ([
          ["name", copy.editName, copy.editNameLabel(member.email)],
          ["days", copy.editDays, copy.editDaysLabel(member.email)],
          ["leave", copy.addLeave, copy.addLeaveLabel(member.email)],
        ] as const)
      : []),
    ...(member.clients > 0 ? ([["move", copy.moveAll, copy.moveAllLabel(member.email)]] as const) : []),
  ];
  return actions.map(([acting, label, aria]) => (
    <button
      key={acting}
      className={styles.inline}
      type="button"
      aria-label={aria}
      onClick={() => {
        props.onActing(props.acting === acting ? null : acting);
      }}
    >
      {label}
    </button>
  ));
}

function MemberRows(props: {
  member: CareMember;
  team: readonly CareMember[];
  mayManage: boolean;
  onChanged: () => void;
}) {
  const { member, mayManage } = props;
  const [acting, setActing] = useState<Acting>(null);
  const done = () => {
    setActing(null);
    props.onChanged();
  };
  const cancel = () => {
    setActing(null);
  };
  const days = member.weekly_off.map((day) => copy.weekdays[day] ?? "").join(", ");
  return (
    <>
      <tr>
        <th scope="row" className={own.who}>
          {member.email}
        </th>
        <td>{member.name ?? copy.noName}</td>
        <td className={own.figure}>{member.clients}</td>
        <td>{days === "" ? copy.noDaysOff : days}</td>
        <td>
          <LeaveList leave={member.leave} mayManage={mayManage} onChanged={props.onChanged} />
        </td>
        <td>{todayOf(member)}</td>
        <td className={own.actions}>
          {mayManage && <RowActions member={member} acting={acting} onActing={setActing} />}
        </td>
      </tr>
      {acting !== null && (
        <tr className={own.acting}>
          <td colSpan={COLUMNS}>
            {acting === "name" && <NameForm member={member} onDone={done} onCancel={cancel} />}
            {acting === "days" && <DaysOffForm member={member} onDone={done} onCancel={cancel} />}
            {acting === "leave" && <LeaveForm member={member} onDone={done} onCancel={cancel} />}
            {acting === "move" && <MoveAllForm member={member} team={props.team} onDone={done} onCancel={cancel} />}
          </td>
        </tr>
      )}
    </>
  );
}

export function CareTeam() {
  const load = useCallback(() => careApi.careTeam(), []);
  const [loaded, retry] = useLoad(load);
  const mayManage = useAccess().mayCall("POST /api/care-team/days-off");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { team } = loaded.value;
  if (team.length === 0) return <p className={styles.note}>{care.carePerson.noTeam}</p>;
  const columns = copy.columns;
  const me = team.find((member) => member.email === loaded.value.me);
  return (
    <div className={own.scroll}>
      {me !== undefined && <ShiftSwitch me={me} onDone={retry} />}
      <Table className={classes(styles.table, own.table)}>
        <thead>
          <tr>
            <th scope="col">{columns.member}</th>
            <th scope="col">{columns.name}</th>
            <th scope="col" className={own.figure}>
              {columns.clients}
            </th>
            <th scope="col">{columns.daysOff}</th>
            <th scope="col">{columns.leave}</th>
            <th scope="col">{columns.today}</th>
            <th scope="col">
              <VisuallyHidden>{copy.editDays}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {team.map((member) => (
            <MemberRows key={member.email} member={member} team={team} mayManage={mayManage} onChanged={retry} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}
