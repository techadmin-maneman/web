// Customer Care · Care numbers (docs/decisions/0144-care-numbers.md): whether the same-day promise holds, over the last
// week, month or quarter. First replies counted in Care hours, same-day closes, the backlog now, what chats were
// about, the remedies given, and the replies of each Care person.

import { Field, Select } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { classes } from "@maneman/ui/classes";
import { useLoad } from "@maneman/ui/useLoad";
import { shortDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { Shell } from "../components/Shell.tsx";
import { care } from "../content/care.ts";
import { SECTION_NAMES } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { careApi, type CareNumbers, type CarePeriod } from "./care-api.ts";
import styles from "../components/forms.module.css";
import own from "./care.module.css";

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
    <dl className={own.facts}>
      {figures.map(([label, value]) => (
        <div key={label} className={own.figureRow}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ByPerson({ numbers }: { numbers: CareNumbers }) {
  if (numbers.by_person.length === 0) return <p className={styles.note}>{copy.noPeople}</p>;
  return (
    <div className={own.scroll}>
      <Table className={classes(styles.table, own.table)}>
        <thead>
          <tr>
            <th scope="col">{copy.columns.person}</th>
            <th scope="col" className={own.figure}>
              {copy.chats}
            </th>
            <th scope="col" className={own.figure}>
              {copy.firstReply}
            </th>
            <th scope="col" className={own.figure}>
              {copy.withinTarget}
            </th>
          </tr>
        </thead>
        <tbody>
          {numbers.by_person.map((row) => (
            <tr key={row.email}>
              <th scope="row" className={own.who}>
                {row.email}
              </th>
              <td className={own.figure}>{row.chats}</td>
              <td className={own.figure}>{minutes(row.median_minutes)}</td>
              <td className={own.figure}>{percent(row.within_target)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function Lists({ numbers }: { numbers: CareNumbers }) {
  return (
    <div className={own.quick}>
      <h3 className={styles.ruleTitle}>{copy.reasons}</h3>
      {numbers.reasons.length === 0 ? (
        <p className={styles.note}>{copy.nothing}</p>
      ) : (
        <ul className={own.leave}>
          {numbers.reasons.map((row) => (
            <li key={row.reason}>{copy.counted(care.reasons[row.reason as keyof typeof care.reasons], row.chats)}</li>
          ))}
        </ul>
      )}
      <h3 className={styles.ruleTitle}>{copy.remedies}</h3>
      {numbers.remedies.length === 0 ? (
        <p className={styles.note}>{copy.nothing}</p>
      ) : (
        <ul className={own.leave}>
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
      <p className={own.quick}>{copy.span(shortDate(numbers.from), shortDate(numbers.to))}</p>
      <Figures numbers={numbers} />
      <Lists numbers={numbers} />
      <ByPerson numbers={numbers} />
    </>
  );
}

export function CareNumbersScreen() {
  const [period, setPeriod] = useState<CarePeriod>("7");
  return (
    <Shell section="/care-numbers" title={SECTION_NAMES["care-numbers"]}>
      <div className={styles.screen}>
        <Panel titleId="care-numbers" title={copy.title} className={styles.panel}>
          <div className={own.tools}>
            <Field label={copy.period}>
              {(control) => (
                <Select
                  {...control}
                  className={styles.choiceBox}
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
    </Shell>
  );
}
