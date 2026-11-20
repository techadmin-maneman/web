// Growth · Funnel (docs/decisions/0288-attribution-and-conversions.md): for a week or a month, from our own rows alone,
// the try-ons and how far the new clients went, then by channel what was spent and what it brought, the cohorts'
// revenue after their first fit, and what clients told ops; by the client's channel or their last touch's, for every
// channel or one. The Zoho Analytics dashboards beyond it (src/domain/analytics/acquisition.ts).

import { BarChart } from "@maneman/ui/BarChart";
import { quantity } from "@maneman/web-kit/figures";
import { plainDate } from "@maneman/web-kit/plain-date";
import { todayInIndia } from "@maneman/web-kit/dates";
import { apiNow } from "@maneman/web-kit/clock";
import { DateInput, Field } from "@maneman/ui/Field";
import { SelectField } from "@maneman/ui/FieldRows";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { TextLink } from "@maneman/ui/TextLink";
import { Toolbar } from "@maneman/ui/Toolbar";
import { useLoad } from "@maneman/ui/useLoad";
import { CHANNEL_CODES, CHANNELS } from "@rules/policy/channels.ts";
import { useCallback, useState } from "react";
import { useHeaderSub } from "../frame/PageHead.tsx";
import form from "@maneman/ui/forms.module.css";
import styles from "./funnel.module.css";
import { funnel as copy } from "../content/funnel.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { ChannelFigures, Cohorts, Heard } from "./FunnelTables.tsx";
import { funnelApi, type Acquisition, type ChannelBy, type ChannelCode, type Period } from "./funnel-api.ts";

function Steps({ figures }: { figures: Acquisition }) {
  const { totals } = figures;
  const bars = [
    { key: "tryons", label: copy.steps.tryons, value: figures.tryons, shown: quantity(figures.tryons) },
    { key: "leads", label: copy.steps.leads, value: totals.leads, shown: quantity(totals.leads) },
    {
      key: "booked",
      label: copy.steps.booked,
      value: totals.consults_booked,
      shown: copy.share(totals.consults_booked, totals.leads),
    },
    {
      key: "consulted",
      label: copy.steps.consulted,
      value: totals.consults_done,
      shown: copy.share(totals.consults_done, totals.leads),
    },
    {
      key: "fitted",
      label: copy.steps.fitted,
      value: totals.first_fits,
      shown: copy.share(totals.first_fits, totals.leads),
    },
  ];
  return (
    <Panel titleId="funnel-steps" title={copy.steps.title}>
      <BarChart label={copy.steps.title} bars={bars} />
    </Panel>
  );
}

function Dashboards() {
  return (
    <Panel titleId="funnel-dashboards" title={copy.dashboards.title}>
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

function Counted({ figures }: { figures: Acquisition }) {
  useHeaderSub(copy.counted(plainDate(figures.from), plainDate(figures.to)));
  return null;
}

interface Asked {
  readonly period: Period;
  readonly starting: string;
  readonly by: ChannelBy;
  readonly channel: ChannelCode | null;
}

/** The value chosen, where it is one of `values`. */
const oneOf = <T extends string>(values: readonly T[], chosen: string): T | undefined =>
  values.find((value) => value === chosen);

function Asking({ asked, onAsk }: { asked: Asked; onAsk: (asked: Asked) => void }) {
  return (
    <Toolbar label={copy.period}>
      <SelectField
        label={copy.period}
        value={asked.period}
        choices={[
          ["week", copy.periods.week],
          ["month", copy.periods.month],
        ]}
        onChange={(chosen) => {
          const period = oneOf(["week", "month"] as const, chosen);
          if (period !== undefined) onAsk({ ...asked, period });
        }}
      />
      <Field label={copy.starting}>
        {(control) => (
          <DateInput
            {...control}
            value={asked.starting}
            onChange={(event) => {
              if (event.target.value !== "") onAsk({ ...asked, starting: event.target.value });
            }}
          />
        )}
      </Field>
      <SelectField
        label={copy.by}
        value={asked.by}
        choices={[
          ["first", copy.bys.first],
          ["last", copy.bys.last],
        ]}
        onChange={(chosen) => {
          const by = oneOf(["first", "last"] as const, chosen);
          if (by !== undefined) onAsk({ ...asked, by });
        }}
      />
      <SelectField
        label={copy.channel}
        value={asked.channel ?? "all"}
        choices={[["all", copy.allChannels], ...CHANNELS.map((each) => [each.code, each.channel] as const)]}
        onChange={(chosen) => {
          onAsk({ ...asked, channel: oneOf(CHANNEL_CODES, chosen) ?? null });
        }}
      />
    </Toolbar>
  );
}

export function FunnelScreen() {
  const [asked, setAsked] = useState<Asked>({
    period: "week",
    starting: todayInIndia(apiNow()),
    by: "first",
    channel: null,
  });
  const read = useCallback(() => funnelApi.acquisition(asked), [asked]);
  const [loaded, retry] = useLoad(read);
  return (
    <div className={form.screen}>
      <Asking asked={asked} onAsk={setAsked} />
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <>
          <Counted figures={loaded.value} />
          <Steps figures={loaded.value} />
          <ChannelFigures figures={loaded.value} />
          <Cohorts figures={loaded.value} />
          <Heard figures={loaded.value} />
        </>
      )}
      <Dashboards />
    </div>
  );
}
