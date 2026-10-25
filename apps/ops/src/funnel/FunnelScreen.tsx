// Growth · Funnel: over the last 30 or 90 days, the first try-ons, then the clients whose first lead came in those days
// by how far they went (a consultation booked, had, a fit), a bar each with its share of the new clients; the same by
// channel; and the Zoho Analytics dashboards beyond it (src/domain/analytics/funnel.ts).

import { BarChart } from "@maneman/ui/BarChart";
import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { TextLink } from "@maneman/ui/TextLink";
import { Toolbar } from "@maneman/ui/Toolbar";
import { useLoad } from "@maneman/ui/useLoad";
import { fullDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { useHeaderSub } from "../components/PageHead.tsx";
import { RowHead } from "../components/RowHead.tsx";
import form from "../components/forms.module.css";
import styles from "./funnel.module.css";
import { funnel as copy } from "../content/funnel.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { funnelApi, type Funnel, type FunnelDays } from "./funnel-api.ts";

const PERIODS: readonly FunnelDays[] = ["30", "90"];

function Steps({ funnel }: { funnel: Funnel }) {
  const { steps } = funnel;
  const bars = [
    { key: "tryons", label: copy.steps.tryons, value: funnel.tryons, shown: String(funnel.tryons) },
    { key: "leads", label: copy.steps.leads, value: steps.leads, shown: String(steps.leads) },
    { key: "booked", label: copy.steps.booked, value: steps.booked, shown: copy.share(steps.booked, steps.leads) },
    {
      key: "consulted",
      label: copy.steps.consulted,
      value: steps.consulted,
      shown: copy.share(steps.consulted, steps.leads),
    },
    { key: "fitted", label: copy.steps.fitted, value: steps.fitted, shown: copy.share(steps.fitted, steps.leads) },
  ];
  return (
    <Panel titleId="funnel-steps" title={copy.steps.title} padded>
      <BarChart label={copy.steps.title} bars={bars} />
    </Panel>
  );
}

function Channels({ funnel }: { funnel: Funnel }) {
  const shown = funnel.channels.filter((each) => each.leads > 0);
  return (
    <Panel titleId="funnel-channels" title={copy.channels.title}>
      {shown.length === 0 ? (
        <Note>{copy.channels.none}</Note>
      ) : (
        <TableScroll labelledBy="funnel-channels">
          <Table>
            <thead>
              <tr>
                {copy.channels.columns.map((column, at) => (
                  <th key={column} scope="col" className={at === 0 ? undefined : form.figure}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((each) => (
                <tr key={each.channel}>
                  <RowHead>{each.channel}</RowHead>
                  <td className={form.figure}>{each.leads}</td>
                  <td className={form.figure}>{copy.share(each.booked, each.leads)}</td>
                  <td className={form.figure}>{copy.share(each.consulted, each.leads)}</td>
                  <td className={form.figure}>{copy.share(each.fitted, each.leads)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}

function Dashboards() {
  return (
    <Panel titleId="funnel-dashboards" title={copy.dashboards.title} padded>
      <Note>{copy.dashboards.note}</Note>
      <ul className={styles.links}>
        {copy.dashboards.links.map((link) => (
          <li key={link.href}>
            <TextLink href={link.href} newTab>
              {link.name}
            </TextLink>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Counted({ funnel }: { funnel: Funnel }) {
  useHeaderSub(copy.counted(fullDate(funnel.from), fullDate(funnel.to)));
  return null;
}

export function FunnelScreen() {
  const [days, setDays] = useState<FunnelDays>("30");
  const read = useCallback(() => funnelApi.funnel(days), [days]);
  const [loaded, retry] = useLoad(read);
  return (
    <div className={form.screen}>
      <Toolbar label={copy.period}>
        <Field label={copy.period} labelHidden>
          {(control) => (
            <Select
              {...control}
              width="choice"
              value={days}
              onChange={(event) => {
                const chosen = PERIODS.find((each) => each === event.target.value);
                if (chosen !== undefined) setDays(chosen);
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
      </Toolbar>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <>
          <Counted funnel={loaded.value} />
          <Steps funnel={loaded.value} />
          <Channels funnel={loaded.value} />
        </>
      )}
      <Dashboards />
    </div>
  );
}
