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
import form from "../components/forms.module.css";
import shared from "./care.module.css";
import styles from "./care-numbers-screen.module.css";

const copy = care.numbers;
const PERIODS: readonly CarePeriod[] = ["7", "30", "90"];

const isPeriod = (value: string): value is CarePeriod => PERIODS.some((period) => period === value);

/** "86%", or a dash with nothing to count. */
const percent = (share: number | null): string =>
  share === null ? copy.nothing : `${String(Math.round(share * 100))}%`;
const minutes = (value: number | null): string => (value === null ? copy.nothing : copy.minutes(value));

function Figures({ numbers }: { numbers: CareNumbers }) {
  const figures: readonly (readonly [string, string])[] = [
    [copy.chats, String(numbers.replies.chats)],
    [copy.firstReply, minutes(numbers.replies.median_minutes)],
    [copy.withinTarget, percent(numbers.replies.within_target)],
    [copy.sameDay, percent(numbers.same_day)],
    [copy.waitingOnUs, String(numbers.backlog.waiting_on_us)],
    [copy.overdue, String(numbers.backlog.overdue)],
    [copy.waitingOnClient, String(numbers.backlog.waiting_on_client)],
  ];
  return (
    <dl className={shared.facts}>
      {figures.map(([label, value]) => (
        <div key={label} className={styles.figureRow}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ByPerson({ numbers }: { numbers: CareNumbers }) {
  if (numbers.by_person.length === 0) return <Note>{copy.noPeople}</Note>;
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

function Lists({ numbers }: { numbers: CareNumbers }) {
  return (
    <div className={shared.quick}>
      <h3 className={form.ruleTitle}>{copy.reasons}</h3>
      {numbers.reasons.length === 0 ? (
        <Note>{copy.nothing}</Note>
      ) : (
        <ul className={shared.leave}>
          {numbers.reasons.map((row) => (
            <li key={row.reason}>{copy.counted(care.reasons[row.reason as keyof typeof care.reasons], row.chats)}</li>
          ))}
        </ul>
      )}
      <h3 className={form.ruleTitle}>{copy.remedies}</h3>
      {numbers.remedies.length === 0 ? (
        <Note>{copy.nothing}</Note>
      ) : (
        <ul className={shared.leave}>
          {numbers.remedies.map((row) => (
            <li key={row.reason}>
              {copy.remedied(
                care.remedy.reasons[row.reason as keyof typeof care.remedy.reasons],
                row.remedies,
                row.visits,
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Numbers({ period }: { period: CarePeriod }) {
  const load = useCallback(() => careApi.careNumbers(period), [period]);
  const [loaded, retry] = useLoad(load);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const numbers = loaded.value;
  return (
    <>
      <p className={shared.quick}>{copy.span(shortDate(numbers.from), shortDate(numbers.to))}</p>
      <Figures numbers={numbers} />
      <Lists numbers={numbers} />
      <ByPerson numbers={numbers} />
    </>
  );
}

export function CareNumbersScreen() {
  const [period, setPeriod] = useState<CarePeriod>("7");
  return (
    <div className={form.screen}>
      <Panel titleId="care-numbers" title={copy.title} padded>
        <div className={shared.tools}>
          <Field label={copy.period}>
            {(control) => (
              <Select
                {...control}
                width="choice"
                value={period}
                onChange={(event) => {
                  if (isPeriod(event.target.value)) setPeriod(event.target.value);
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
        </div>
        <Numbers key={period} period={period} />
      </Panel>
    </div>
  );
}
