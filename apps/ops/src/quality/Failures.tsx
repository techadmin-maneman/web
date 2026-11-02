// Failure rates on the Quality page (docs/decisions/0188-failure-rates-and-value-at-risk.md): the pieces fitted in the
// last year and how many failed, grouped one way at a time.

import type { Success } from "@maneman/web-kit/api";
import { Panel } from "@maneman/ui/Panel";
import { Field, Select } from "@maneman/ui/Field";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Note } from "@maneman/ui/Note";
import { FIGURE, Table } from "@maneman/ui/Table";
import { SortHeads } from "@maneman/ui/TableTools";
import { useTableView } from "@maneman/ui/useTableView";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import type { paths } from "../api-schema.ts";
import { quality as copy } from "../content/quality.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { RowHead } from "@maneman/ui/RowHead";
import { qualityApi } from "./quality-api.ts";

type Rates = Success<paths["/api/quality/failures"]["get"]>;
type Way = "code" | "lot" | "supplier" | "technician";

const WAYS: readonly Way[] = ["code", "lot", "supplier", "technician"];
const loadRates = () => qualityApi.failures();

const groupsOf = (rates: Rates, way: Way) =>
  ({ code: rates.by_code, lot: rates.by_lot, supplier: rates.by_supplier, technician: rates.by_technician })[way];

/** The way the rates are grouped, in the panel's head beside its title. */
function WayChoice({ way, onWay }: { way: Way; onWay: (way: Way) => void }) {
  return (
    <Field label={copy.failuresBy} labelHidden>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={way}
          onChange={(event) => {
            onWay(event.target.value as Way);
          }}
        >
          {WAYS.map((each) => (
            <option key={each} value={each}>
              {copy.ways[each]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

type Group = Rates["by_code"][number];

function GroupTable({ groups, way }: { groups: readonly Group[]; way: Way }) {
  const [, fitted, failed, rate] = copy.failureColumns;
  const view = useTableView(groups, [
    { label: copy.ways[way], sort: (group: Group) => group.name },
    { label: fitted, sort: (group: Group) => group.fitted, figure: true },
    { label: failed, sort: (group: Group) => group.failed, figure: true },
    { label: rate, sort: (group: Group) => group.rate_percent ?? -1, figure: true },
  ]);
  return (
    <Table>
      <thead>
        <tr>
          <SortHeads view={view} />
        </tr>
      </thead>
      <tbody>
        {view.shown.map((group) => (
          <tr key={group.name}>
            <RowHead>{group.name}</RowHead>
            <td className={FIGURE}>{group.fitted}</td>
            <td className={FIGURE}>{group.failed}</td>
            <td className={FIGURE}>{copy.rate(group.rate_percent)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Groups({ rates, way }: { rates: Rates; way: Way }) {
  if (rates.by_code.length === 0) return <EmptyState look="panel" line={copy.noFailures} />;
  return <GroupTable key={way} groups={groupsOf(rates, way)} way={way} />;
}

export function FailuresPanel() {
  const [loaded, retry] = useLoad(loadRates);
  const [way, setWay] = useState<Way>("code");
  const any = loaded.state === "loaded" && loaded.value.by_code.length > 0;
  return (
    <Panel titleId="quality-failures" title={copy.failures} actions={any && <WayChoice way={way} onWay={setWay} />}>
      <Note>{copy.failuresPeriod}</Note>
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && <Groups rates={loaded.value} way={way} />}
    </Panel>
  );
}
