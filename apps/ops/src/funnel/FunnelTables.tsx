// The Funnel page's tables (docs/decisions/0288-attribution-and-conversions.md): each channel's spend and what it
// brought, with what each step cost and the first fits' return on spend; each cohort fitted in the period by what it
// paid within 30, 90 and 180 days; and what the clients consulted told ops beside the channel the rule gives them.

import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { RowHead } from "@maneman/ui/RowHead";
import { FIGURE, Table, TableScroll } from "@maneman/ui/Table";
import { quantity } from "@maneman/web-kit/figures";
import { rupees } from "@maneman/web-kit/money";
import { channelNamed } from "@rules/policy/channels.ts";
import { HEARD_FROM } from "@rules/policy/heard-from.ts";
import { funnel as copy } from "../content/funnel.ts";
import type { Acquisition, ChannelCode } from "./funnel-api.ts";

type Figures = Acquisition["totals"];

/** What each of something cost: the spend over the count, or nothing where there was neither. */
const costOf = (spend: number, count: number) => (count === 0 ? "" : rupees(Math.round(spend / count)));

function FigureCells({ row }: { row: Figures }) {
  return (
    <>
      <td className={FIGURE}>{rupees(row.spend)}</td>
      <td className={FIGURE}>{quantity(row.leads)}</td>
      <td className={FIGURE}>{costOf(row.spend, row.leads)}</td>
      <td className={FIGURE}>{quantity(row.consults_booked)}</td>
      <td className={FIGURE}>{quantity(row.consults_done)}</td>
      <td className={FIGURE}>{costOf(row.spend, row.consults_done)}</td>
      <td className={FIGURE}>{quantity(row.first_fits)}</td>
      <td className={FIGURE}>{costOf(row.spend, row.first_fits)}</td>
      <td className={FIGURE}>{rupees(row.first_fit_revenue)}</td>
      <td className={FIGURE}>{row.spend === 0 ? "" : copy.roas(row.first_fit_revenue, row.spend)}</td>
    </>
  );
}

export function ChannelFigures({ figures }: { figures: Acquisition }) {
  return (
    <Panel titleId="funnel-channels" title={copy.channels.title}>
      {figures.rows.length === 0 ? (
        <EmptyState look="panel" line={copy.channels.none} />
      ) : (
        <TableScroll labelledBy="funnel-channels">
          <Table>
            <thead>
              <tr>
                {copy.channels.columns.map((head, index) => (
                  <th key={head} scope="col" className={index === 0 ? undefined : FIGURE}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {figures.rows.map((row) => (
                <tr key={row.channel}>
                  <RowHead>{channelNamed(row.channel)}</RowHead>
                  <FigureCells row={row} />
                </tr>
              ))}
              {/* The total as a row of its own, so a phone draws it as a card with each figure named, as the rest. */}
              <tr>
                <RowHead>{copy.channels.total}</RowHead>
                <FigureCells row={figures.totals} />
              </tr>
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}

export function Cohorts({ figures }: { figures: Acquisition }) {
  const { cohort_complete: complete } = figures;
  const shown = (amount: number, whole: boolean) => (whole ? rupees(amount) : copy.cohorts.soFar(rupees(amount)));
  return (
    <Panel titleId="funnel-cohorts" title={copy.cohorts.title}>
      {figures.cohorts.length === 0 ? (
        <EmptyState look="panel" line={copy.cohorts.none} />
      ) : (
        <TableScroll labelledBy="funnel-cohorts">
          <Table>
            <thead>
              <tr>
                {copy.cohorts.columns.map((head, index) => (
                  <th key={head} scope="col" className={index === 0 ? undefined : FIGURE}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {figures.cohorts.map((row) => (
                <tr key={row.channel}>
                  <RowHead>{channelNamed(row.channel)}</RowHead>
                  <td className={FIGURE}>{quantity(row.clients)}</td>
                  <td className={FIGURE}>{shown(row.d30, complete.d30)}</td>
                  <td className={FIGURE}>{shown(row.d90, complete.d90)}</td>
                  <td className={FIGURE}>{shown(row.d180, complete.d180)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}

const heardWords = (code: string) => HEARD_FROM.find((each) => each.code === code)?.label ?? copy.heard.notAsked;

export function Heard({ figures }: { figures: Acquisition }) {
  const channels = [...new Set(figures.heard.map((row) => row.channel))];
  const answers = [...new Set(figures.heard.map((row) => row.heard_from))];
  const count = (answer: string, channel: ChannelCode) =>
    figures.heard.find((row) => row.heard_from === answer && row.channel === channel)?.clients ?? 0;
  return (
    <Panel titleId="funnel-heard" title={copy.heard.title}>
      {figures.heard.length === 0 ? (
        <EmptyState look="panel" line={copy.heard.none} />
      ) : (
        <TableScroll labelledBy="funnel-heard">
          <Table>
            <thead>
              <tr>
                <th scope="col">{copy.heard.told}</th>
                {channels.map((channel) => (
                  <th key={channel} scope="col" className={FIGURE}>
                    {channelNamed(channel)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {answers.map((answer) => (
                <tr key={answer}>
                  <RowHead>{heardWords(answer)}</RowHead>
                  {channels.map((channel) => (
                    <td key={channel} className={FIGURE}>
                      {quantity(count(answer, channel))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}
