// Money › Charges, its rulings of today: each case charged or waived, the latest first, a row each as the redesign
// draws them, so a case ops have just charged or waived can still be seen.

import { EmptyState } from "@maneman/ui/EmptyState";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { RowHead } from "@maneman/ui/RowHead";
import { PanelFailed, PanelLoading } from "@maneman/ui/States";
import { Table, TableScroll } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { type DecidedNoShow } from "../api.ts";
import { firstShown, noShows } from "../content.ts";
import styles from "./no-shows.module.css";
import { paymentsApi } from "./payments-api.ts";

const copy = noShows.queue;

/** What a ruling did: a charge, with what it kept, or a waiver. */
function rulingOf(each: DecidedNoShow): string {
  const decided = noShows.decided;
  if (each.decision === "waived") return decided.waived;
  if (each.charge === null) return decided.chargedUnrecorded;
  if (each.charge.kept > 0) return decided.charged(rupees(each.charge.kept));
  return each.charge.credit_spent ? decided.chargedCredit : decided.chargedNothing;
}

/** The cases ruled on today, the latest first, so a case ops have just charged or waived can still be seen. */
export function DecidedToday() {
  const [loaded, retry] = useLoad(paymentsApi.decidedNoShows);
  const decided = noShows.decided;
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const { cases, more } = loaded.value;
  const [client, visit, ruling, at] = decided.columns;
  return (
    <Panel titleId="decided-today" title={decided.title}>
      {cases.length === 0 ? (
        <EmptyState look="panel" line={decided.empty} />
      ) : (
        <TableScroll labelledBy="decided-today">
          <Table>
            <thead>
              <tr>
                <th scope="col">{client}</th>
                <th scope="col">{visit}</th>
                <th scope="col">{ruling}</th>
                <th scope="col">{at}</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((each) => (
                <tr key={each.id}>
                  <RowHead>{each.person?.name ?? copy.erased}</RowHead>
                  <td>{each.visit_date === null ? copy.undated : shortDate(each.visit_date)}</td>
                  <td>{rulingOf(each)}</td>
                  <td>{indiaClock(each.decided_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
      {more && (
        <InlineMessage tone="note" className={styles.first}>
          {firstShown(cases.length)}
        </InlineMessage>
      )}
    </Panel>
  );
}
