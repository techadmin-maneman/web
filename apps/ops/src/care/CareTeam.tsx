// The Care team on the Messages page (docs/decisions/0134-care-cover.md, 0136-care-names.md): each member's name as
// clients know it, clients, weekly days off and leave, and who covers them today. A member's row opens their record
// beside the table, where a Customer Care manager changes the name and the days off where they read, adds or cancels
// leave, and moves every client to another member (docs/decisions/0212-editing-in-place.md).

import { Button, RowButton } from "@maneman/ui/Button";
import { Checkbox, DateInput, Field, Select } from "@maneman/ui/Field";
import { EditableRow } from "@maneman/ui/EditableRow";
import { Note } from "@maneman/ui/Note";
import { Table, TableScroll } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { useLiveLoad } from "@maneman/ui/useLoad";
import { useWrite } from "../lib/write.ts";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { AddForm } from "../components/AddForm.tsx";
import { ReadRow, TextRow } from "../components/RecordRows.tsx";
import { EDITING } from "../content/common.ts";
import { care } from "../content/care.ts";
import { useAccess } from "../lib/access.ts";
import { Refused } from "../components/Refusal.tsx";
import { Loading, PanelFailed } from "../states/States.tsx";
import { careApi, type CareMember } from "./care-api.ts";
import form from "../components/forms.module.css";
import styles from "./care.module.css";
import { FormDrawer } from "../components/FormDrawer.tsx";

const copy = care.team;

type Leave = CareMember["leave"][number];

const periodOf = (leave: Leave): string => copy.period(shortDate(leave.from), shortDate(leave.to));

/** Sends a change, saying why it was refused; `onDone` once it went. */
const useSend = (onDone: () => void) => useWrite<unknown>(onDone);

/** The weekdays a member is off, changed where they read. */
function DaysOff({
  member,
  mayChange,
  onSaved,
}: {
  member: CareMember;
  mayChange: boolean;
  onSaved: () => Promise<void>;
}) {
  const days = member.weekly_off.map((day) => copy.weekdays[day] ?? "").join(", ");
  return (
    <EditableRow<readonly number[]>
      label={copy.columns.daysOff}
      words={EDITING}
      mayChange={mayChange}
      value={days === "" ? copy.noDaysOff : days}
      start={() => member.weekly_off}
      save={async (picked) => {
        const answer = await careApi.setDaysOff(member.email, picked);
        if (!answer.ok) return errorText(copy.errors, answer);
        await onSaved();
        return null;
      }}
    >
      {(control, picked, pick) => (
        <span className={styles.days} id={control.id}>
          {copy.weekdays.map((name, day) => (
            <Checkbox
              key={name}
              label={name}
              checked={picked.includes(day)}
              onChange={() => {
                pick(picked.includes(day) ? picked.filter((each) => each !== day) : [...picked, day].sort());
              }}
            />
          ))}
        </span>
      )}
    </EditableRow>
  );
}

/** Leave for a member: its first day and its last. */
function AddLeave({ member, onDone }: { member: CareMember; onDone: (added: boolean) => Promise<void> }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <AddForm
      title={copy.addLeaveLabel(member.email)}
      words={copy}
      errors={copy.errors}
      boxes={["from", "to"]}
      send={() => careApi.addLeave(member.email, from, to)}
      onAdded={() => onDone(true)}
      onCancel={() => void onDone(false)}
    >
      <div className={form.fields}>
        <Field label={copy.from} className={form.field} box="from">
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
        <Field label={copy.to} className={form.field} box="to">
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
    </AddForm>
  );
}

function LeaveList(props: { leave: readonly Leave[]; mayManage: boolean; onChanged: () => void }) {
  const { busy, failure, send } = useSend(props.onChanged);
  if (props.leave.length === 0) return <>{copy.noLeave}</>;
  return (
    <>
      <ul className={styles.leave}>
        {props.leave.map((leave) => (
          <li key={leave.id}>
            {periodOf(leave)}
            {props.mayManage && (
              <RowButton
                beside
                disabled={busy}
                aria-label={copy.takeBackLabel(periodOf(leave))}
                onClick={() => void send(() => careApi.deleteLeave(leave.id))}
              >
                {copy.takeBack}
              </RowButton>
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
    <div className={styles.tools}>
      <Note>{since === null ? copy.you.off : copy.you.on(indiaClock(since))}</Note>
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
function MoveAll(props: { member: CareMember; team: readonly CareMember[]; onDone: () => Promise<void> }) {
  const others = props.team.filter((each) => each.on_team && each.email !== props.member.email);
  const [asking, setAsking] = useState(false);
  const [to, setTo] = useState(others[0]?.email ?? "");
  const { busy, failure, send } = useSend(() => {
    setAsking(false);
    void props.onDone();
  });
  if (!asking) {
    return (
      <Button
        variant="outline"
        size="small"
        narrow
        aria-label={copy.moveAllLabel(props.member.email)}
        onClick={() => {
          setAsking(true);
        }}
      >
        {copy.moveAll}
      </Button>
    );
  }
  return (
    <div className={styles.teamForm}>
      <div className={styles.closing}>
        <Field label={copy.moveAllTo}>
          {(control) => (
            <Select
              {...control}
              width="choice"
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
        <Button
          variant="outline"
          size="small"
          narrow
          onClick={() => {
            setAsking(false);
          }}
        >
          {copy.cancel}
        </Button>
      </div>
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}

function MemberRow({ member, onOpen }: { member: CareMember; onOpen: () => void }) {
  const days = member.weekly_off.map((day) => copy.weekdays[day] ?? "").join(", ");
  return (
    <tr>
      <th scope="row" className={styles.who}>
        <TextButton compact aria-label={copy.open(member.email)} onClick={onOpen}>
          {member.email}
        </TextButton>
      </th>
      <td>{member.name ?? copy.noName}</td>
      <td className={styles.figure}>{member.clients}</td>
      <td>{days === "" ? copy.noDaysOff : days}</td>
      <td>{member.leave.length === 0 ? copy.noLeave : member.leave.map(periodOf).join(", ")}</td>
      <td>{todayOf(member)}</td>
    </tr>
  );
}

/** A member's record: what they are known as, their days off and leave, and who has their clients. */
function MemberRecord(props: {
  member: CareMember;
  team: readonly CareMember[];
  mayManage: boolean;
  reread: () => Promise<void>;
}) {
  const { member, mayManage, reread } = props;
  const [adding, setAdding] = useState(false);
  const mayChange = mayManage && member.on_team;
  return (
    <>
      <div className={form.record}>
        <TextRow
          label={copy.columns.name}
          value={member.name ?? ""}
          shown={member.name ?? copy.noName}
          maxLength={40}
          mayChange={mayChange}
          save={async (typed) => {
            const answer = await careApi.setCareName(member.email, typed.trim());
            if (!answer.ok) return errorText(copy.errors, answer);
            await reread();
            return null;
          }}
        />
        <ReadRow label={copy.columns.clients} value={member.clients} />
        <DaysOff member={member} mayChange={mayChange} onSaved={reread} />
        <ReadRow
          label={copy.columns.leave}
          value={<LeaveList leave={member.leave} mayManage={mayManage} onChanged={() => void reread()} />}
        />
        <ReadRow label={copy.columns.today} value={todayOf(member)} />
      </div>
      {mayChange &&
        (adding ? (
          <AddLeave
            member={member}
            onDone={async (added) => {
              setAdding(false);
              if (added) await reread();
            }}
          />
        ) : (
          <div className={styles.addLeave}>
            <Button
              variant="outline"
              size="small"
              narrow
              aria-label={copy.addLeaveLabel(member.email)}
              onClick={() => {
                setAdding(true);
              }}
            >
              {copy.addLeave}
            </Button>
          </div>
        ))}
      {mayManage && member.clients > 0 && (
        <div className={form.recordFoot}>
          <MoveAll member={member} team={props.team} onDone={reread} />
        </div>
      )}
    </>
  );
}

/** Read again every five minutes while open, as who is on shift moves, and after every change. */
const EVERY_MS = 5 * 60_000;

export function CareTeam() {
  const load = useCallback(() => careApi.careTeam(), []);
  const { loaded, reread, retry } = useLiveLoad(load, EVERY_MS);
  const [open, setOpen] = useState<string | null>(null);
  const mayManage = useAccess().mayCall("POST /api/care-team/days-off");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { team } = loaded.value;
  if (team.length === 0) return <Note>{care.carePerson.noTeam}</Note>;
  const columns = copy.columns;
  const me = team.find((member) => member.email === loaded.value.me);
  const opened = team.find((member) => member.email === open);
  return (
    <TableScroll labelledBy="care-team">
      {me !== undefined && <ShiftSwitch me={me} onDone={() => void reread()} />}
      <Table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{columns.member}</th>
            <th scope="col">{columns.name}</th>
            <th scope="col" className={styles.figure}>
              {columns.clients}
            </th>
            <th scope="col">{columns.daysOff}</th>
            <th scope="col">{columns.leave}</th>
            <th scope="col">{columns.today}</th>
          </tr>
        </thead>
        <tbody>
          {team.map((member) => (
            <MemberRow
              key={member.email}
              member={member}
              onOpen={() => {
                setOpen(member.email);
              }}
            />
          ))}
        </tbody>
      </Table>
      {opened !== undefined && (
        <FormDrawer
          title={opened.name ?? opened.email}
          onClose={() => {
            setOpen(null);
          }}
        >
          <MemberRecord member={opened} team={team} mayManage={mayManage} reread={reread} />
        </FormDrawer>
      )}
    </TableScroll>
  );
}
