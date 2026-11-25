// The Funnel page's steps from lead to fitted (docs/decisions/0324-the-weekly-dashboard.md): for each channel and the
// total, the clients fitted, the close rate over consultations done, the no-show rate, the middle first reply, the
// period's new clients fitted since and what each cost, the tiers fitted and why leads were lost.

import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { RowHead } from "@maneman/ui/RowHead";
import { FIGURE, Table, TableScroll } from "@maneman/ui/Table";
import { quantity } from "@maneman/web-kit/figures";
import { roundRupees } from "@maneman/web-kit/money";
import { channelNamed } from "@rules/policy/channels.ts";
import { hoursAndMinutes } from "../content/common.ts";
import { funnel } from "../content/funnel.ts";
import type { Acquisition } from "./funnel-api.ts";

const copy = funnel.toFitted;

type Row = Acquisition["totals"];

/** A tier's code as words: "premium" is Premium. */
export const tierWords = (tier: string): string => {
  const words = tier.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

/** The no-shows over the consultations done or missed. */
export const noShowShare = (row: Row): string => copy.share(row.steps.no_shows, row.consults_done + row.steps.no_shows);

function StepCells({ row }: { row: Row }) {
  const { steps } = row;
  return (
    <>
      <td className={FIGURE}>{quantity(steps.fitted)}</td>
      <td className={FIGURE}>{copy.share(steps.fitted, row.consults_done)}</td>
      <td className={FIGURE}>{noShowShare(row)}</td>
      <td className={FIGURE}>{steps.first_reply_minutes === null ? "" : hoursAndMinutes(steps.first_reply_minutes)}</td>
      <td className={FIGURE}>{quantity(steps.leads_fitted)}</td>
      <td className={FIGURE}>{steps.leads_fitted === 0 ? "" : roundRupees(row.spend / steps.leads_fitted)}</td>
      <td>{copy.counts(steps.tiers.map((each) => ({ name: tierWords(each.tier), clients: each.clients })))}</td>
      <td>{copy.counts(steps.lost.map((each) => ({ name: each.reason, clients: each.clients })))}</td>
    </>
  );
}

export function ToFitted({ figures }: { figures: Acquisition }) {
  return (
    <Panel titleId="funnel-to-fitted" title={copy.title}>
      {figures.rows.length === 0 ? (
        <EmptyState look="panel" line={copy.none} />
      ) : (
        <TableScroll labelledBy="funnel-to-fitted">
          <Table>
            <thead>
              <tr>
                {copy.columns.map((head, index) => (
                  <th key={head} scope="col" className={index === 0 || index > 6 ? undefined : FIGURE}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {figures.rows.map((row) => (
                <tr key={row.channel}>
                  <RowHead>{channelNamed(row.channel)}</RowHead>
                  <StepCells row={row} />
                </tr>
              ))}
              <tr>
                <RowHead>{funnel.channels.total}</RowHead>
                <StepCells row={figures.totals} />
              </tr>
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}
