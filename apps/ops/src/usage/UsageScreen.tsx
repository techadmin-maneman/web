// Operations · Usage (docs/decisions/0186-usage-and-shrinkage.md): over the last weeks, each technician's consumables
// against what their visits were expected to use, each opened to its items; and each place's losses, the flagged first.

import type { Success } from "@maneman/web-kit/api";
import { Panel } from "@maneman/ui/Panel";
import { TextButton } from "@maneman/ui/TextLink";
import { useHeaderSub } from "../frame/PageHead.tsx";
import { Note } from "@maneman/ui/Note";
import { FIGURE, Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { quantity } from "@maneman/web-kit/figures";
import { BarChart } from "@maneman/ui/BarChart";
import { roundRupees } from "@maneman/web-kit/money";
import { useState } from "react";
import type { paths } from "../api-schema.ts";
import form from "@maneman/ui/forms.module.css";
import { usage as copy } from "../content/usage.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { RowHead } from "@maneman/ui/RowHead";
import { usageApi } from "./usage-api.ts";

type Usage = Success<paths["/api/stock/usage"]["get"]>;
type Technician = Usage["technicians"][number];

const loadUsage = () => usageApi.usage();

function Head({ columns }: { columns: readonly string[] }) {
  return (
    <thead>
      <tr>
        {columns.map((column, index) => (
          <th key={column} scope="col" className={index === 0 ? undefined : FIGURE}>
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function Items({ technician }: { technician: Technician }) {
  return (
    <Table controls>
      <Head columns={copy.itemColumns} />
      <tbody>
        {technician.items.map((item) => (
          <tr key={item.consumable_code}>
            <RowHead>{item.name}</RowHead>
            <td className={FIGURE}>{quantity(item.expected)}</td>
            <td className={FIGURE}>{quantity(item.used)}</td>
            <td className={FIGURE}>{copy.over(item.over_percent)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Each technician's use over what their visits expected, the furthest over first. */
function OverChart({ usage }: { usage: Usage }) {
  const bars = usage.technicians
    .filter((technician) => technician.over_percent !== null)
    .sort((one, other) => (other.over_percent ?? 0) - (one.over_percent ?? 0))
    .map((technician) => ({
      key: technician.technician_id,
      label: technician.name,
      value: technician.over_percent ?? 0,
      shown: copy.over(technician.over_percent),
    }));
  return bars.length === 0 ? null : <BarChart label={copy.chart} bars={bars} />;
}

function Technicians({ usage }: { usage: Usage }) {
  const [open, setOpen] = useState<string | null>(null);
  const opened = usage.technicians.find((technician) => technician.technician_id === open);
  return (
    <Panel titleId="usage-technicians" title={copy.technicians}>
      {usage.technicians.length === 0 ? (
        <Note>{copy.noTechnicians}</Note>
      ) : (
        <>
          <OverChart usage={usage} />
          <Table controls>
            <Head columns={copy.technicianColumns} />
            <tbody>
              {usage.technicians.map((technician) => (
                <tr key={technician.technician_id}>
                  <RowHead>
                    <TextButton
                      compact
                      aria-label={copy.items(technician.name)}
                      onClick={() => {
                        setOpen(technician.technician_id);
                      }}
                    >
                      {technician.name}
                    </TextButton>
                    {technician.flagged && <Note>{copy.flagged}</Note>}
                  </RowHead>
                  <td className={FIGURE}>{technician.visits}</td>
                  <td className={FIGURE}>{roundRupees(technician.expected_value)}</td>
                  <td className={FIGURE}>{roundRupees(technician.used_value)}</td>
                  <td className={FIGURE}>{copy.over(technician.over_percent)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      {opened !== undefined && (
        <div className={form.group}>
          <h3 className={form.ruleTitle}>{copy.items(opened.name)}</h3>
          <Items technician={opened} />
        </div>
      )}
    </Panel>
  );
}

function Places({ usage }: { usage: Usage }) {
  return (
    <Panel titleId="usage-places" title={copy.places}>
      {usage.places.length === 0 ? (
        <Note>{copy.noPlaces}</Note>
      ) : (
        <Table controls>
          <Head columns={copy.placeColumns} />
          <tbody>
            {usage.places.map((place) => (
              <tr key={place.place_id}>
                <RowHead>
                  {place.place}
                  {place.flagged && <Note>{copy.flagged}</Note>}
                </RowHead>
                <td className={FIGURE}>{roundRupees(place.left_value)}</td>
                <td className={FIGURE}>{roundRupees(place.lost_value)}</td>
                <td className={FIGURE}>{copy.percent(place.shrinkage_percent)}</td>
                <td className={FIGURE}>{place.write_offs}</td>
                <td className={FIGURE}>{copy.percent(place.count_accuracy_percent)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

export function UsageScreen() {
  const [loaded, retry] = useLoad(loadUsage);
  useHeaderSub(loaded.state === "loaded" ? copy.since(loaded.value.since) : undefined);
  return (
    <>
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <div className={form.screen}>
          <Technicians usage={loaded.value} />
          <Places usage={loaded.value} />
        </div>
      )}
    </>
  );
}
