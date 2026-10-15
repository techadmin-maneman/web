// Customer Care · Care numbers (docs/decisions/0144-care-numbers.md): whether the same-day promise holds, over the last
// week, month or quarter. First replies counted in Care hours, same-day closes, the backlog now, what chats were
// about, the remedies given, and the replies of each Care person.

import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { shortDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { care } from "../content/care.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { careApi, type CareNumbers, type CarePeriod } from "./care-api.ts";
import shared from "./care.module.css";
import { Columns, Stack } from "@maneman/ui/Layout";
import { StatTile } from "@maneman/ui/StatTile";
import { useHeaderSub } from "../components/Shell.tsx";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Toolbar } from "@maneman/ui/Toolbar";

const copy = care.numbers;
const PERIODS: readonly CarePeriod[] = ["7", "30", "90"];

const isPeriod = (value: string): value is CarePeriod => PERIODS.some((period) => period === value);

/** "86%", or a dash with nothing to count. */
const percent = (share: number | null): string =>
  share === null ? copy.nothing : `${String(Math.round(share * 100))}%`;
const minutes = (value: number | null): string => (value === null ? copy.nothing : copy.minutes(value));

function Figures({ numbers }: { numbers: CareNumbers }) {
  const overdue = numbers.backlog.overdue;
  return (
    <Columns>
      <StatTile label={copy.chats} value={numbers.replies.chats} />
      <StatTile label={copy.firstReply} value={minutes(numbers.replies.median_minutes)} />
      <StatTile label={copy.withinTarget} value={percent(numbers.replies.within_target)} />
      <StatTile label={copy.sameDay} value={percent(numbers.same_day)} />
      <StatTile label={copy.waitingOnUs} value={numbers.backlog.waiting_on_us} />
      <StatTile label={copy.overdue} value={overdue} tone={overdue > 0 ? "warning" : "plain"} />
      <StatTile label={copy.waitingOnClient} value={numbers.backlog.waiting_on_client} />
    </Columns>
  );
}

/** One of the counts by reason, a line each, or a dash with none. */
function Counted({ titleId, title, lines }: { titleId: string; title: string; lines: readonly string[] }) {
  return (
    <Panel titleId={titleId} title={title} padded>
      {lines.length === 0 ? (
        <Note>{copy.nothing}</Note>
      ) : (
        <ul className={shared.leave}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Lists({ numbers }: { numbers: CareNumbers }) {
  const reasons = numbers.reasons.map((row) =>
    copy.counted(care.reasons[row.reason as keyof typeof care.reasons], row.chats),
  );
  const remedies = numbers.remedies.map((row) =>
    copy.remedied(care.remedy.reasons[row.reason as keyof typeof care.remedy.reasons], row.remedies, row.visits),
  );
  return (
    <>
      <Counted titleId="care-reasons" title={copy.reasons} lines={reasons} />
      <Counted titleId="care-remedies" title={copy.remedies} lines={remedies} />
    </>
  );
}

function ByPerson({ numbers }: { numbers: CareNumbers }) {
  return (
    <Panel titleId="care-people" title={copy.byPerson}>
      {numbers.by_person.length === 0 ? (
        <EmptyState look="panel" line={copy.noPeople} />
      ) : (
        <PeopleTable numbers={numbers} />
      )}
    </Panel>
  );
}

function PeopleTable({ numbers }: { numbers: CareNumbers }) {
  return (
    <div className={shared.scroll}>
      <Table controls className={shared.table}>
        <thead>
          <tr>
            <th scope="col">{copy.columns.person}</th>
            <th scope="col" className={shared.figure}>
              {copy.chats}
            </th>
            <th scope="col" className={shared.figure}>
              {copy.firstReply}
            </th>
            <th scope="col" className={shared.figure}>
              {copy.withinTarget}
            </th>
          </tr>
        </thead>
        <tbody>
          {numbers.by_person.map((row) => (
            <tr key={row.email}>
              <th scope="row" className={shared.who}>
                {row.email}
              </th>
              <td className={shared.figure}>{row.chats}</td>
              <td className={shared.figure}>{minutes(row.median_minutes)}</td>
              <td className={shared.figure}>{percent(row.within_target)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/** The days the figures count, beside the page's title. */
function Span({ from, to }: { from: string; to: string }) {
  useHeaderSub(copy.span(shortDate(from), shortDate(to)));
  return null;
}

function Numbers({ period }: { period: CarePeriod }) {
  const load = useCallback(() => careApi.careNumbers(period), [period]);
  const [loaded, retry] = useLoad(load);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const numbers = loaded.value;
  return (
    <>
      <Span from={numbers.from} to={numbers.to} />
      <Figures numbers={numbers} />
      <Lists numbers={numbers} />
      <ByPerson numbers={numbers} />
    </>
  );
}

/** Over how long the figures count: the last week, 30 days or 90. */
function PeriodChoice({ period, onPeriod }: { period: CarePeriod; onPeriod: (period: CarePeriod) => void }) {
  return (
    <Field label={copy.period} labelHidden>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={period}
          onChange={(event) => {
            if (isPeriod(event.target.value)) onPeriod(event.target.value);
          }}
        >
          {PERIODS.map((each) => (
            <option key={each} value={each}>
              {copy.periods[each]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function CareNumbersScreen() {
  const [period, setPeriod] = useState<CarePeriod>("7");
  return (
    <Stack>
      <Toolbar label={copy.period}>
        <PeriodChoice period={period} onPeriod={setPeriod} />
      </Toolbar>
      <Numbers key={period} period={period} />
    </Stack>
  );
}
